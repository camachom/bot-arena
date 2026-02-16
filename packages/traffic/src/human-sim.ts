import { chromium, type Browser, type Page } from 'playwright';
import { v4 as uuidv4 } from 'uuid';
import type { TrafficProfile, SessionResult, DetectorResult, MouseMovement } from '@bot-arena/types';
import { normalRandom, sleep, pickRandom, refineQuery, sampleQueries } from './utils.js';

// Generate human-like mouse movements with natural curves and jitter
function generateHumanMouseMovements(count: number = 15): MouseMovement[] {
  const movements: MouseMovement[] = [];
  let x = Math.random() * 800 + 100;
  let y = Math.random() * 400 + 100;
  let timestamp = Date.now();

  // Humans have irregular, curved movements
  for (let i = 0; i < count; i++) {
    // Add natural jitter and curves
    const angle = Math.random() * Math.PI * 2;
    const distance = normalRandom(50, 30);
    const curve = normalRandom(0, 0.5); // Add curve factor

    x += Math.cos(angle + curve) * distance + normalRandom(0, 10);
    y += Math.sin(angle + curve) * distance + normalRandom(0, 10);

    // Keep in bounds
    x = Math.max(0, Math.min(1200, x));
    y = Math.max(0, Math.min(800, y));

    // Variable time between movements
    timestamp += Math.floor(normalRandom(80, 40));

    movements.push({ x: Math.round(x), y: Math.round(y), timestamp });
  }

  return movements;
}

export interface SimulatorOptions {
  baseUrl: string;
  profile: TrafficProfile;
  headless?: boolean;
}

export interface SimulatorResult extends SessionResult {
  detectorResults: DetectorResult[];
}

export async function runSimulator(options: SimulatorOptions): Promise<SimulatorResult> {
  const { baseUrl, profile, headless = true } = options;
  const sessionId = uuidv4();
  const startTime = Date.now();

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
    const page = await context.newPage();

    // Determine number of pages to visit
    const pagesToVisit = Math.max(
      1,
      Math.round(normalRandom(profile.pagesPerSession.mean, profile.pagesPerSession.stdDev))
    );

    // Track context for correlation features
    let requestContext: RequestContext = { prevContentLength: 0, prevDwellTime: 0 };

    // Check for bounce
    if (Math.random() < profile.bounceRate) {
      // Just visit home page and leave
      await visitPage(page, baseUrl, profile, sessionId);
      pagesRequested = 1;
      pagesExtracted = 1;
    } else {
      let currentQuery = pickRandom(sampleQueries);

      for (let i = 0; i < pagesToVisit; i++) {
        // Decide action: browse products, search, or paginate
        const action = pickRandom(['browse', 'search', 'search', 'paginate']);

        try {
          let result: PageVisitResult;

          if (action === 'search') {
            // Refine query if using refine strategy
            if (profile.searchBehavior === 'refine' && searchesPerformed > 0) {
              currentQuery = refineQuery(currentQuery, 2);
            } else if (profile.searchBehavior === 'random') {
              currentQuery = pickRandom(sampleQueries);
            }

            const searchUrl = `${baseUrl}/api/products/search?q=${encodeURIComponent(currentQuery)}`;
            result = await visitPage(page, searchUrl, profile, sessionId, requestContext);
            pagesRequested++;
            searchesPerformed++;

            if (result.success) {
              pagesExtracted++;
            } else {
              if (result.blocked) wasBlocked = true;
              if (result.throttled) wasThrottled = true;
              if (result.challenged) wasChallenged = true;
            }
          } else if (action === 'paginate') {
            const pageNum = Math.floor(Math.random() * 3) + 1;
            const paginateUrl = `${baseUrl}/api/products?page=${pageNum}`;
            result = await visitPage(page, paginateUrl, profile, sessionId, requestContext);
            pagesRequested++;

            if (result.success) {
              pagesExtracted++;
            } else {
              if (result.blocked) wasBlocked = true;
              if (result.throttled) wasThrottled = true;
              if (result.challenged) wasChallenged = true;
            }
          } else {
            // Browse products
            const browseUrl = `${baseUrl}/api/products`;
            result = await visitPage(page, browseUrl, profile, sessionId, requestContext);
            pagesRequested++;

            if (result.success) {
              pagesExtracted++;
            } else {
              if (result.blocked) wasBlocked = true;
              if (result.throttled) wasThrottled = true;
              if (result.challenged) wasChallenged = true;
            }
          }

          // Load assets if profile says so
          if (profile.loadAssets) {
            await loadAssets(page, baseUrl, sessionId);
          }

          // Dwell time - humans spend time proportional to content length
          // Base dwell time + extra time per KB of content
          const contentFactor = result.contentLength > 0 ? Math.log(result.contentLength / 100 + 1) * 500 : 0;
          const dwellTime = Math.max(
            100,
            normalRandom(profile.dwellTimeMs.mean + contentFactor, profile.dwellTimeMs.stdDev)
          );
          await sleep(dwellTime);

          // Update context for next request
          requestContext = {
            prevContentLength: result.contentLength,
            prevDwellTime: Math.round(dwellTime),
          };

          // Click delay before next action
          const clickDelay = Math.max(
            50,
            normalRandom(profile.clickDelay.mean, profile.clickDelay.stdDev)
          );
          await sleep(clickDelay);
        } catch (err) {
          // Request failed, likely blocked
          wasBlocked = true;
          break;
        }
      }
    }

    // Fetch detector results
    try {
      const detectionsRes = await page.request.get(`${baseUrl}/admin/detections`);
      const allDetections = (await detectionsRes.json()) as DetectorResult[];
      detectorResults.push(...allDetections.filter((d) => d.sessionId === sessionId));
    } catch {
      // Ignore errors fetching detections
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

interface PageVisitResult {
  success: boolean;
  blocked: boolean;
  throttled: boolean;
  challenged: boolean;
  contentLength: number;
}

// Track previous request metadata for correlation features
interface RequestContext {
  prevContentLength: number;
  prevDwellTime: number;
}

async function visitPage(
  page: Page,
  url: string,
  profile: TrafficProfile,
  sessionId: string,
  context?: RequestContext
): Promise<PageVisitResult> {
  try {
    // Generate human-like mouse movements
    const mouseMovements = generateHumanMouseMovements();

    const headers: Record<string, string> = {
      'X-Session-Id': sessionId,
      'X-Mouse-Movements': JSON.stringify(mouseMovements),
    };

    // Include previous request context if available
    if (context?.prevContentLength) {
      headers['X-Prev-Content-Length'] = String(context.prevContentLength);
    }
    if (context?.prevDwellTime) {
      headers['X-Dwell-Time'] = String(context.prevDwellTime);
    }

    const response = await page.request.get(url, { headers });

    const blocked = response.status() === 403;
    const throttled = response.status() === 429;
    const challenged = response.headers()['x-challenge-required'] === 'true';

    // Get content length from response
    let contentLength = 0;
    try {
      const body = await response.text();
      contentLength = body.length;
    } catch {
      // Ignore
    }

    return {
      success: response.ok() && !blocked,
      blocked,
      throttled,
      challenged,
      contentLength,
    };
  } catch {
    return {
      success: false,
      blocked: true,
      throttled: false,
      challenged: false,
      contentLength: 0,
    };
  }
}

async function loadAssets(page: Page, baseUrl: string, sessionId: string): Promise<void> {
  const assets = ['/assets/styles.css', '/assets/app.js', '/assets/logo.png'];

  await Promise.all(
    assets.map((asset) =>
      page.request.get(`${baseUrl}${asset}`, {
        headers: { 'X-Session-Id': sessionId },
      }).catch(() => {})
    )
  );
}
