import { readFileSync, writeFileSync } from 'fs';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import type {
  AttackProfile,
  Policy,
  TrafficProfile,
  SessionResult,
  RoundMetrics,
  ProfileMetrics,
} from '@bot-arena/types';
import { createTargetApp, type TargetAppInstance } from '@bot-arena/target-app';
import { runParallelTraffic, loadProfile } from '@bot-arena/traffic';

export interface PolicyValidationResult {
  valid: boolean;
  errors: string[];
}

export function validatePolicy(policy: Policy): PolicyValidationResult {
  const errors: string[] = [];
  const { allow, throttle, challenge, block } = policy.actions;

  if (!(allow.max_score < throttle.max_score)) {
    errors.push(`allow (${allow.max_score}) must be < throttle (${throttle.max_score})`);
  }
  if (!(throttle.max_score < challenge.max_score)) {
    errors.push(`throttle (${throttle.max_score}) must be < challenge (${challenge.max_score})`);
  }
  if (!(challenge.max_score < block.max_score)) {
    errors.push(`challenge (${challenge.max_score}) must be < block (${block.max_score})`);
  }

  return { valid: errors.length === 0, errors };
}

export interface TournamentConfig {
  attackProfilePath: string;
  policyPath: string;
  profilePaths: string[];
  sessionsPerProfile?: number;
  port?: number;
  fast?: boolean;
  onProgress?: (message: string) => void;
}

export interface TournamentResult {
  metrics: RoundMetrics;
  sessionResults: SessionResult[];
}

export function loadAttackProfile(path: string): AttackProfile {
  const content = readFileSync(path, 'utf-8');
  return JSON.parse(content) as AttackProfile;
}

export function loadPolicy(path: string): Policy {
  const content = readFileSync(path, 'utf-8');
  return parseYaml(content) as Policy;
}

export function saveAttackProfile(path: string, profile: AttackProfile): void {
  writeFileSync(path, JSON.stringify(profile, null, 2));
}

export function savePolicy(path: string, policy: Policy): void {
  writeFileSync(path, stringifyYaml(policy));
}

export async function runTournament(
  config: TournamentConfig,
  fightNumber: number,
  roundNumber: number
): Promise<TournamentResult> {
  const {
    attackProfilePath,
    policyPath,
    profilePaths,
    sessionsPerProfile = 3,
    port = 3000,
    fast = false,
    onProgress,
  } = config;

  // Load configs
  const attackProfile = loadAttackProfile(attackProfilePath);
  const policy = loadPolicy(policyPath);
  const profiles = profilePaths.map((p) => loadProfile(p));

  // Validate policy
  const validation = validatePolicy(policy);
  if (!validation.valid) {
    throw new Error(`Invalid policy configuration:\n  - ${validation.errors.join('\n  - ')}`);
  }

  // Start target app
  let targetApp: TargetAppInstance | null = null;
  let closeServer: (() => Promise<void>) | null = null;

  try {
    targetApp = createTargetApp({ port, policyPath });
    const { close } = await targetApp.start();
    closeServer = close;

    const baseUrl = `http://localhost:${port}`;

    // Reset state
    await fetch(`${baseUrl}/admin/reset`, { method: 'POST' });

    // Run traffic
    onProgress?.('Running traffic simulations...');
    const sessionResults = await runParallelTraffic({
      baseUrl,
      profiles,
      attackProfile,
      sessionsPerProfile,
      headless: true,
      fast,
      onProgress,
    });

    // Calculate metrics
    const metrics = calculateMetrics(sessionResults, fightNumber, roundNumber);

    return { metrics, sessionResults };
  } finally {
    if (closeServer) {
      await closeServer();
    }
  }
}

function calculateMetrics(sessionResults: SessionResult[], fightNumber: number, roundNumber: number): RoundMetrics {
  const profileGroups = new Map<string, SessionResult[]>();

  for (const result of sessionResults) {
    const key = result.profileType;
    if (!profileGroups.has(key)) {
      profileGroups.set(key, []);
    }
    profileGroups.get(key)!.push(result);
  }

  const profileMetrics: ProfileMetrics[] = [];
  let humanSuccessCount = 0;
  let humanTotalCount = 0;
  let humanBlockedCount = 0;
  let botTotalExtractions = 0;
  let botTotalRequests = 0;

  for (const [profileType, results] of profileGroups) {
    const isBot = results[0].isBot;

    const totalRequests = results.reduce((sum, r) => sum + r.pagesRequested, 0);
    const successfulExtractions = results.reduce((sum, r) => sum + r.pagesExtracted, 0);
    const blockedRequests = results.filter((r) => r.wasBlocked).length;
    const throttledRequests = results.filter((r) => r.wasThrottled).length;
    const challengedRequests = results.filter((r) => r.wasChallenged).length;
    const avgScore =
      results.flatMap((r) => r.detectorResults.map((d) => d.score)).reduce((a, b) => a + b, 0) /
      Math.max(1, results.flatMap((r) => r.detectorResults).length);
    const avgDwellTime =
      results.reduce((sum, r) => sum + r.durationMs / Math.max(1, r.pagesRequested), 0) /
      Math.max(1, results.length);

    profileMetrics.push({
      profileType: profileType as ProfileMetrics['profileType'],
      isBot,
      sessions: results.length,
      totalRequests,
      successfulExtractions,
      blockedRequests,
      throttledRequests,
      challengedRequests,
      extractionRate: totalRequests > 0 ? successfulExtractions / totalRequests : 0,
      avgScore,
      avgDwellTime,
    });

    if (!isBot) {
      humanTotalCount += results.length;
      humanSuccessCount += results.filter((r) => !r.wasBlocked).length;
      humanBlockedCount += results.filter((r) => r.wasBlocked).length;
    } else {
      botTotalExtractions += successfulExtractions;
      botTotalRequests += totalRequests;
    }
  }

  const humanSuccessRate = humanTotalCount > 0 ? humanSuccessCount / humanTotalCount : 1;
  const falsePositiveRate = humanTotalCount > 0 ? humanBlockedCount / humanTotalCount : 0;
  const botExtractionRate = botTotalRequests > 0 ? botTotalExtractions / botTotalRequests : 0;
  const botSuppressionRate = 1 - botExtractionRate;

  return {
    fightNumber,
    roundNumber,
    timestamp: new Date().toISOString(),
    profiles: profileMetrics,
    humanSuccessRate,
    falsePositiveRate,
    botSuppressionRate,
    botExtractionRate,
  };
}
