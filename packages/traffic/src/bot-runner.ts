import { chromium, type Browser } from 'playwright';
import { v4 as uuidv4 } from 'uuid';
import type { TrafficProfile, SessionResult, DetectorResult, AttackProfile } from '@bot-arena/types';
import { normalRandom, sleep, pickRandom, refineQuery, sampleQueries, randomJitter } from './utils.js';

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

        const response = await page.request.get(url, {
          headers: { 'X-Session-Id': sessionId },
        });

        pagesRequested++;

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
        const dwellTime = Math.max(
          100,
          normalRandom(profile.dwellTimeMs.mean, profile.dwellTimeMs.stdDev)
        );
        await sleep(Math.min(dwellTime, 5000)); // Cap for bots

        // Rate limiting + jitter
        const jitter = randomJitter(jitterMs as [number, number]);
        await sleep(Math.max(minDelayMs, jitter));
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
