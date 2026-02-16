import type { Request, Response, NextFunction } from 'express';
import { readFileSync } from 'fs';
import { parse as parseYaml } from 'yaml';
import type {
  Policy,
  SessionFeatures,
  DetectorResult,
  DetectorAction,
  RequestLog,
} from '@bot-arena/types';
import type { SessionStore } from './middleware/logger.js';

export interface DetectorStore {
  results: Map<string, DetectorResult[]>;
  policy: Policy;
  getSessionResults(sessionId: string): DetectorResult[];
  getAllResults(): DetectorResult[];
  clear(): void;
  reloadPolicy(): void;
}

function loadPolicy(policyPath: string): Policy {
  try {
    const content = readFileSync(policyPath, 'utf-8');
    return parseYaml(content) as Policy;
  } catch {
    // Default policy if file not found
    return {
      features: {
        reqs_per_min: { weight: 1.5, threshold: 20 },
        unique_queries_per_hour: { weight: 2.0, threshold: 30 },
        pagination_ratio: { weight: 1.2, threshold: 0.6 },
        session_depth: { weight: 1.0, threshold: 5 },
        dwell_time_avg: { weight: 1.8, threshold: 2000 },
        timing_variance: { weight: 3.0, threshold: 0.4 },
        asset_warmup_missing: { weight: 3.0 },
      },
      actions: {
        allow: { max_score: 3 },
        throttle: { max_score: 5 },
        challenge: { max_score: 8 },
        block: { max_score: 999 },
      },
      constraints: {
        max_false_positive_rate: 0.01,
      },
    };
  }
}

function extractFeatures(sessionId: string, logs: RequestLog[]): SessionFeatures {
  if (logs.length === 0) {
    return {
      sessionId,
      reqs_per_min: 0,
      unique_queries_per_hour: 0,
      pagination_ratio: 0,
      session_depth: 0,
      dwell_time_avg: 0,
      timing_variance: 0,
      asset_warmup_missing: false,
    };
  }

  const now = Date.now();
  const oneMinuteAgo = now - 60_000;
  const oneHourAgo = now - 3600_000;

  // Requests per minute
  const recentLogs = logs.filter((l) => l.timestamp >= oneMinuteAgo);
  const reqs_per_min = recentLogs.length;

  // Unique queries per hour
  const hourLogs = logs.filter((l) => l.timestamp >= oneHourAgo);
  const uniqueQueries = new Set(
    hourLogs.filter((l) => l.query.q).map((l) => l.query.q)
  );
  const unique_queries_per_hour = uniqueQueries.size;

  // Pagination ratio (pages viewed / unique pages)
  const pageRequests = logs.filter((l) => !l.isAssetRequest);
  const uniquePages = new Set(pageRequests.map((l) => l.path));
  const pagination_ratio =
    uniquePages.size > 0 ? pageRequests.length / uniquePages.size : 0;

  // Session depth (max pagination depth)
  const pageNumbers = logs
    .filter((l) => l.query.page)
    .map((l) => parseInt(l.query.page) || 1);
  const session_depth = pageNumbers.length > 0 ? Math.max(...pageNumbers) : 1;

  // Dwell time average (time between requests)
  let dwell_time_avg = 0;
  if (logs.length >= 2) {
    const sortedLogs = [...logs].sort((a, b) => a.timestamp - b.timestamp);
    let totalDwell = 0;
    for (let i = 1; i < sortedLogs.length; i++) {
      totalDwell += sortedLogs[i].timestamp - sortedLogs[i - 1].timestamp;
    }
    dwell_time_avg = totalDwell / (sortedLogs.length - 1);
  }

  // Timing variance (coefficient of variation of dwell times)
  let timing_variance = 0;
  if (logs.length >= 3) {
    const sortedLogs = [...logs].sort((a, b) => a.timestamp - b.timestamp);
    const dwellTimes: number[] = [];
    for (let i = 1; i < sortedLogs.length; i++) {
      dwellTimes.push(sortedLogs[i].timestamp - sortedLogs[i - 1].timestamp);
    }

    const mean = dwellTimes.reduce((a, b) => a + b, 0) / dwellTimes.length;
    if (mean > 0) {
      const variance = dwellTimes.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / dwellTimes.length;
      const stdDev = Math.sqrt(variance);
      timing_variance = stdDev / mean;
    }
  }

  // Asset warmup missing (no CSS/JS/images loaded)
  const assetLogs = logs.filter((l) => l.isAssetRequest);
  const asset_warmup_missing = assetLogs.length === 0 && logs.length > 2;

  return {
    sessionId,
    reqs_per_min,
    unique_queries_per_hour,
    pagination_ratio,
    session_depth,
    dwell_time_avg,
    timing_variance,
    asset_warmup_missing,
  };
}

function calculateScore(features: SessionFeatures, policy: Policy): { score: number; triggered: string[] } {
  let score = 0;
  const triggered: string[] = [];

  const { reqs_per_min, unique_queries_per_hour, pagination_ratio, session_depth, dwell_time_avg, asset_warmup_missing } = features;
  const pf = policy.features;

  if (reqs_per_min > pf.reqs_per_min.threshold) {
    score += pf.reqs_per_min.weight;
    triggered.push('reqs_per_min');
  }

  if (unique_queries_per_hour > pf.unique_queries_per_hour.threshold) {
    score += pf.unique_queries_per_hour.weight;
    triggered.push('unique_queries_per_hour');
  }

  if (pagination_ratio > pf.pagination_ratio.threshold) {
    score += pf.pagination_ratio.weight;
    triggered.push('pagination_ratio');
  }

  if (session_depth > pf.session_depth.threshold) {
    score += pf.session_depth.weight;
    triggered.push('session_depth');
  }

  // Low dwell time is suspicious (bots are fast)
  if (dwell_time_avg > 0 && dwell_time_avg < pf.dwell_time_avg.threshold) {
    score += pf.dwell_time_avg.weight;
    triggered.push('dwell_time_avg');
  }

  // Low timing variance is suspicious (bots have consistent timing)
  if (features.timing_variance > 0 && features.timing_variance < pf.timing_variance.threshold) {
    score += pf.timing_variance.weight;
    triggered.push('timing_variance');
  }

  if (asset_warmup_missing) {
    score += pf.asset_warmup_missing.weight;
    triggered.push('asset_warmup_missing');
  }

  return { score, triggered };
}

function determineAction(score: number, policy: Policy): DetectorAction {
  if (score <= policy.actions.allow.max_score) return 'allow';
  if (score <= policy.actions.throttle.max_score) return 'throttle';
  if (score <= policy.actions.challenge.max_score) return 'challenge';
  return 'block';
}

export function createDetectorMiddleware(
  policyPath: string,
  sessionStore: SessionStore
): { middleware: (req: Request, res: Response, next: NextFunction) => void; store: DetectorStore } {
  let policy = loadPolicy(policyPath);
  const results = new Map<string, DetectorResult[]>();

  const store: DetectorStore = {
    results,
    policy,
    getSessionResults(sessionId: string): DetectorResult[] {
      return results.get(sessionId) || [];
    },
    getAllResults(): DetectorResult[] {
      const allResults: DetectorResult[] = [];
      for (const sessionResults of results.values()) {
        allResults.push(...sessionResults);
      }
      return allResults;
    },
    clear(): void {
      results.clear();
    },
    reloadPolicy(): void {
      policy = loadPolicy(policyPath);
      store.policy = policy;
    },
  };

  const middleware = (req: Request, res: Response, next: NextFunction) => {
    const sessionId = (req.headers['x-session-id'] as string) || 'unknown';

    // Skip detection for admin endpoints and assets
    if (req.path.startsWith('/admin') || req.path.startsWith('/assets') || req.path === '/health') {
      next();
      return;
    }

    const logs = sessionStore.getSessionLogs(sessionId);
    const features = extractFeatures(sessionId, logs);
    const { score, triggered } = calculateScore(features, policy);
    const action = determineAction(score, policy);

    const result: DetectorResult = {
      sessionId,
      score,
      action,
      features,
      triggeredFeatures: triggered,
    };

    if (!results.has(sessionId)) {
      results.set(sessionId, []);
    }
    results.get(sessionId)!.push(result);

    // Attach result to request for downstream handlers
    (req as Request & { detectorResult?: DetectorResult }).detectorResult = result;

    // Take action
    if (action === 'block') {
      res.status(403).json({ error: 'Access denied', reason: 'bot_detected' });
      return;
    }

    if (action === 'throttle') {
      // Add delay for throttled requests
      setTimeout(() => next(), 2000);
      return;
    }

    if (action === 'challenge') {
      // For now, just add a header - in real system this would be a captcha
      res.setHeader('X-Challenge-Required', 'true');
    }

    next();
  };

  return { middleware, store };
}

// Export for testing
export { extractFeatures, calculateScore, determineAction, loadPolicy };
