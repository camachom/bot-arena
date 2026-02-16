import { chromium, type Browser } from 'playwright';
import { v4 as uuidv4 } from 'uuid';
import type { TrafficProfile, SessionResult, DetectorResult, AttackProfile, MouseMovement } from '@bot-arena/types';
import { normalRandom, sleep, pickRandom, refineQuery, sampleQueries, randomJitter } from './utils.js';

type MouseStyle = 'linear' | 'curved' | 'human_like';

// Generate bot-like mouse movements - linear paths with low entropy
function generateBotMouseMovements(count: number = 10): MouseMovement[] {
  const movements: MouseMovement[] = [];

  // Bots move in straight lines to targets
  const startX = 100;
  const startY = 100;
  const endX = 800;
  const endY = 400;

  let timestamp = Date.now();

  for (let i = 0; i < count; i++) {
    // Linear interpolation - creates very low entropy
    const t = i / (count - 1);
    const x = Math.round(startX + (endX - startX) * t);
    const y = Math.round(startY + (endY - startY) * t);

    // Very consistent timing (low variance)
    timestamp += 50;

    movements.push({ x, y, timestamp });
  }

  return movements;
}

// Generate curved mouse movements using quadratic Bezier curves
function generateCurvedMouseMovements(count: number = 15): MouseMovement[] {
  const movements: MouseMovement[] = [];

  const startX = 100 + Math.random() * 50;
  const startY = 100 + Math.random() * 50;
  const endX = 750 + Math.random() * 100;
  const endY = 350 + Math.random() * 100;

  // Control point for curve - offset from midpoint
  const midX = (startX + endX) / 2;
  const midY = (startY + endY) / 2;
  const controlX = midX + (Math.random() - 0.5) * 200;
  const controlY = midY + (Math.random() - 0.5) * 200;

  let timestamp = Date.now();

  for (let i = 0; i < count; i++) {
    const t = i / (count - 1);

    // Quadratic Bezier: B(t) = (1-t)²P0 + 2(1-t)tP1 + t²P2
    const oneMinusT = 1 - t;
    const x = Math.round(
      oneMinusT * oneMinusT * startX +
      2 * oneMinusT * t * controlX +
      t * t * endX
    );
    const y = Math.round(
      oneMinusT * oneMinusT * startY +
      2 * oneMinusT * t * controlY +
      t * t * endY
    );

    // Some timing variance
    timestamp += 40 + Math.random() * 30;

    movements.push({ x, y, timestamp });
  }

  return movements;
}

// Generate human-like mouse movements with realistic patterns
function generateHumanLikeMouseMovements(count: number = 18): MouseMovement[] {
  const movements: MouseMovement[] = [];

  const startX = 80 + Math.random() * 100;
  const startY = 80 + Math.random() * 100;
  const targetX = 700 + Math.random() * 150;
  const targetY = 300 + Math.random() * 150;

  // Multiple control points for S-curve or complex path
  const ctrl1X = startX + (targetX - startX) * 0.3 + (Math.random() - 0.5) * 150;
  const ctrl1Y = startY + (targetY - startY) * 0.3 + (Math.random() - 0.5) * 150;
  const ctrl2X = startX + (targetX - startX) * 0.7 + (Math.random() - 0.5) * 150;
  const ctrl2Y = startY + (targetY - startY) * 0.7 + (Math.random() - 0.5) * 150;

  let timestamp = Date.now();
  let prevX = startX;
  let prevY = startY;

  // Add slight overshoot chance
  const hasOvershoot = Math.random() < 0.3;
  const overshootAmount = hasOvershoot ? 10 + Math.random() * 20 : 0;

  for (let i = 0; i < count; i++) {
    let t = i / (count - 1);

    // Add micro-hesitations (humans don't move perfectly smoothly)
    if (Math.random() < 0.15 && i > 0 && i < count - 1) {
      // Small pause - repeat previous position with time gap
      timestamp += 80 + Math.random() * 120;
      movements.push({ x: Math.round(prevX), y: Math.round(prevY), timestamp });
      continue;
    }

    // Cubic Bezier: B(t) = (1-t)³P0 + 3(1-t)²tP1 + 3(1-t)t²P2 + t³P3
    const oneMinusT = 1 - t;
    let x =
      oneMinusT * oneMinusT * oneMinusT * startX +
      3 * oneMinusT * oneMinusT * t * ctrl1X +
      3 * oneMinusT * t * t * ctrl2X +
      t * t * t * targetX;
    let y =
      oneMinusT * oneMinusT * oneMinusT * startY +
      3 * oneMinusT * oneMinusT * t * ctrl1Y +
      3 * oneMinusT * t * t * ctrl2Y +
      t * t * t * targetY;

    // Add overshoot near the end
    if (hasOvershoot && t > 0.85 && t < 0.95) {
      const overshootT = (t - 0.85) / 0.1;
      x += Math.sin(overshootT * Math.PI) * overshootAmount;
      y += Math.sin(overshootT * Math.PI) * overshootAmount * 0.5;
    }

    // Add small jitter (hand tremor)
    x += (Math.random() - 0.5) * 3;
    y += (Math.random() - 0.5) * 3;

    // Variable timing - faster in middle, slower at start/end (acceleration curve)
    const speedFactor = 1 - Math.abs(t - 0.5) * 0.8;
    const baseInterval = 30 + Math.random() * 40;
    timestamp += baseInterval / speedFactor;

    prevX = x;
    prevY = y;
    movements.push({ x: Math.round(x), y: Math.round(y), timestamp });
  }

  return movements;
}

// Generate mouse movements based on style
function generateMouseMovements(style: MouseStyle, count?: number): MouseMovement[] {
  switch (style) {
    case 'curved':
      return generateCurvedMouseMovements(count ?? 15);
    case 'human_like':
      return generateHumanLikeMouseMovements(count ?? 18);
    case 'linear':
    default:
      return generateBotMouseMovements(count ?? 10);
  }
}

// Track request context for correlation features
interface BotRequestContext {
  prevContentLength: number;
  prevDwellTime: number;
}

export interface BotRunnerOptions {
  baseUrl: string;
  profile: TrafficProfile;
  attackProfile?: AttackProfile;
  headless?: boolean;
}

export async function runBot(options: BotRunnerOptions): Promise<SessionResult> {
  const { baseUrl, profile, attackProfile, headless = true } = options;
  const sessionId = uuidv4();
  const startTime = Date.now();

  // Use attack profile settings if available
  const concurrency = attackProfile?.concurrency ?? profile.concurrency ?? 1;
  const requestsPerMinute = attackProfile?.requests_per_minute ?? profile.requestsPerMinute ?? 30;
  const jitterMs = attackProfile?.jitter_ms ?? [100, 500];
  const maxDepth = attackProfile?.pagination.max_depth_per_session ?? 3;
  const warmup = attackProfile?.warmup ?? false;
  const queryStrategy = attackProfile?.query_strategy.type ?? profile.searchBehavior;

  // Evasion settings
  const mouseStyle: MouseStyle = attackProfile?.evasion?.mouse_style ?? 'linear';
  const dwellContentCorrelation = attackProfile?.evasion?.dwell_content_correlation ?? false;
  const timingHumanization = attackProfile?.evasion?.timing_humanization ?? false;

  let browser: Browser | null = null;
  let pagesRequested = 0;
  let pagesExtracted = 0;
  let searchesPerformed = 0;
  let wasBlocked = false;
  let wasThrottled = false;
  let wasChallenged = false;
  const detectorResults: DetectorResult[] = [];

  try {
    browser = await chromium.launch({ headless });
    const context = await browser.newContext({
      extraHTTPHeaders: {
        'X-Session-Id': sessionId,
      },
    });

    // Warmup: load assets first if enabled AND profile allows asset loading
    if (warmup && profile.loadAssets) {
      const page = await context.newPage();
      await loadAssets(page, baseUrl, sessionId);
      await page.close();
    }

    // Calculate delay between requests
    const minDelayMs = Math.floor(60000 / requestsPerMinute);

    // Determine pages to visit
    const pagesToVisit = Math.max(
      1,
      Math.round(normalRandom(profile.pagesPerSession.mean, profile.pagesPerSession.stdDev))
    );

    let currentQuery = pickRandom(sampleQueries);
    let currentPage = 1;

    // Track context - bots use FIXED dwell time regardless of content
    let botContext: BotRequestContext = { prevContentLength: 0, prevDwellTime: 0 };

    for (let i = 0; i < pagesToVisit && !wasBlocked; i++) {
      const page = await context.newPage();

      try {
        // Decide what to scrape
        const action = pickRandom(['search', 'search', 'paginate', 'browse']);

        let url: string;
        if (action === 'search') {
          // Apply query strategy
          if (queryStrategy === 'refine' && searchesPerformed > 0) {
            currentQuery = refineQuery(currentQuery, attackProfile?.query_strategy.edit_distance_max ?? 2);
          } else if (queryStrategy === 'random') {
            currentQuery = pickRandom(sampleQueries);
          } else if (queryStrategy === 'sequential') {
            currentQuery = sampleQueries[searchesPerformed % sampleQueries.length];
          }
          url = `${baseUrl}/api/products/search?q=${encodeURIComponent(currentQuery)}&page=${currentPage}`;
          searchesPerformed++;
        } else if (action === 'paginate') {
          currentPage = Math.min(currentPage + 1, maxDepth);
          url = `${baseUrl}/api/products?page=${currentPage}`;
        } else {
          url = `${baseUrl}/api/products`;
        }

        // Generate mouse movements based on evasion style
        const mouseMovements = generateMouseMovements(mouseStyle);

        const headers: Record<string, string> = {
          'X-Session-Id': sessionId,
          'X-Mouse-Movements': JSON.stringify(mouseMovements),
        };

        // Include previous request context
        if (botContext.prevContentLength > 0) {
          headers['X-Prev-Content-Length'] = String(botContext.prevContentLength);
        }
        if (botContext.prevDwellTime > 0) {
          headers['X-Dwell-Time'] = String(botContext.prevDwellTime);
        }

        const response = await page.request.get(url, { headers });

        pagesRequested++;

        // Get content length
        let contentLength = 0;
        try {
          const body = await response.text();
          contentLength = body.length;
        } catch {
          // Ignore
        }

        if (response.status() === 403) {
          wasBlocked = true;
        } else if (response.status() === 429) {
          wasThrottled = true;
          pagesExtracted++; // Still got data, just slower
        } else if (response.headers()['x-challenge-required'] === 'true') {
          wasChallenged = true;
          pagesExtracted++; // Got data but flagged
        } else if (response.ok()) {
          pagesExtracted++;
        }

        // Load assets if profile says so (to blend in)
        if (profile.loadAssets && !wasBlocked) {
          await loadAssets(page, baseUrl, sessionId);
        }

        // Dwell time simulation
        let dwellTime: number;
        if (dwellContentCorrelation && contentLength > 0) {
          // Human-like: scale dwell time based on content length (reading speed)
          const baseDwell = profile.dwellTimeMs.mean;
          const readingSpeed = 200; // chars per second (typical reading speed)
          const contentDwell = (contentLength / readingSpeed) * 1000;
          // Mix base dwell with content-based dwell
          dwellTime = baseDwell + contentDwell * 0.3 + (Math.random() - 0.5) * 200;
          dwellTime = Math.max(300, Math.min(dwellTime, 8000)); // Reasonable bounds
        } else {
          // Bot-like: fixed time, NOT correlated with content
          dwellTime = Math.max(
            100,
            normalRandom(profile.dwellTimeMs.mean, profile.dwellTimeMs.stdDev)
          );
          dwellTime = Math.min(dwellTime, 5000); // Cap for bots
        }
        await sleep(dwellTime);

        // Update context
        botContext = {
          prevContentLength: contentLength,
          prevDwellTime: Math.round(dwellTime),
        };

        // Rate limiting + jitter
        let interRequestDelay: number;
        if (timingHumanization) {
          // Human-like timing: variable delays with occasional long pauses
          const baseJitter = randomJitter(jitterMs as [number, number]);

          // Occasional "distraction" pauses (like human checking phone, thinking, etc.)
          const hasLongPause = Math.random() < 0.1;
          const longPause = hasLongPause ? 2000 + Math.random() * 3000 : 0;

          // Add "thinking time" variance based on action complexity
          const thinkingTime = Math.random() < 0.3 ? 500 + Math.random() * 1000 : 0;

          interRequestDelay = Math.max(minDelayMs, baseJitter) + longPause + thinkingTime;
        } else {
          // Bot-like: consistent jitter pattern
          const jitter = randomJitter(jitterMs as [number, number]);
          interRequestDelay = Math.max(minDelayMs, jitter);
        }
        await sleep(interRequestDelay);
      } catch {
        wasBlocked = true;
      } finally {
        await page.close();
      }

      // Rotate session if configured
      if (attackProfile?.pagination.rotate_sessions && currentPage >= maxDepth) {
        break;
      }
    }

    // Fetch detector results
    try {
      const page = await context.newPage();
      const detectionsRes = await page.request.get(`${baseUrl}/admin/detections`);
      const allDetections = (await detectionsRes.json()) as DetectorResult[];
      detectorResults.push(...allDetections.filter((d) => d.sessionId === sessionId));
      await page.close();
    } catch {
      // Ignore
    }

    await browser.close();
  } catch (err) {
    if (browser) await browser.close();
    throw err;
  }

  const durationMs = Date.now() - startTime;
  const extractionRate = pagesRequested > 0 ? pagesExtracted / pagesRequested : 0;

  return {
    sessionId,
    profileType: profile.type,
    isBot: profile.isBot,
    pagesRequested,
    pagesExtracted,
    searchesPerformed,
    detectorResults,
    wasBlocked,
    wasThrottled,
    wasChallenged,
    extractionRate,
    durationMs,
  };
}

async function loadAssets(page: { request: { get: (url: string, options?: { headers?: Record<string, string> }) => Promise<unknown> } }, baseUrl: string, sessionId: string): Promise<void> {
  const assets = ['/assets/styles.css', '/assets/app.js', '/assets/logo.png'];

  await Promise.all(
    assets.map((asset) =>
      page.request.get(`${baseUrl}${asset}`, {
        headers: { 'X-Session-Id': sessionId },
      }).catch(() => {})
    )
  );
}
