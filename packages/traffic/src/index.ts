import { readFileSync } from 'fs';
import type { TrafficProfile, SessionResult, AttackProfile } from '@bot-arena/types';
import { runSimulator } from './human-sim.js';
import { runBot } from './bot-runner.js';

export { runSimulator } from './human-sim.js';
export { runBot } from './bot-runner.js';
export * from './utils.js';

export function loadProfile(path: string): TrafficProfile {
  const content = readFileSync(path, 'utf-8');
  return JSON.parse(content) as TrafficProfile;
}

export interface TrafficRunnerOptions {
  baseUrl: string;
  profiles: TrafficProfile[];
  attackProfile?: AttackProfile;
  sessionsPerProfile?: number;
  headless?: boolean;
  fast?: boolean;
  onProgress?: (message: string) => void;
}

export async function runTraffic(options: TrafficRunnerOptions): Promise<SessionResult[]> {
  const {
    baseUrl,
    profiles,
    attackProfile,
    sessionsPerProfile = 1,
    headless = true,
  } = options;

  const results: SessionResult[] = [];

  for (const profile of profiles) {
    for (let i = 0; i < sessionsPerProfile; i++) {
      let result: SessionResult;

      if (profile.isBot) {
        result = await runBot({
          baseUrl,
          profile,
          attackProfile,
          headless,
        });
      } else {
        result = await runSimulator({
          baseUrl,
          profile,
          headless,
        });
      }

      results.push(result);
    }
  }

  return results;
}

function applyFastMode(profile: TrafficProfile): TrafficProfile {
  return {
    ...profile,
    dwellTimeMs: { mean: Math.min(profile.dwellTimeMs.mean, 500), stdDev: 100 },
    clickDelay: { mean: Math.min(profile.clickDelay.mean, 100), stdDev: 30 },
    pagesPerSession: { mean: Math.min(profile.pagesPerSession.mean, 3), stdDev: 1 },
  };
}

export async function runParallelTraffic(options: TrafficRunnerOptions): Promise<SessionResult[]> {
  const {
    baseUrl,
    profiles,
    attackProfile,
    sessionsPerProfile = 1,
    headless = true,
    fast = false,
    onProgress,
  } = options;

  const tasks: Promise<SessionResult>[] = [];
  const effectiveProfiles = fast ? profiles.map(applyFastMode) : profiles;
  let completed = 0;
  const total = effectiveProfiles.length * sessionsPerProfile;

  for (const profile of effectiveProfiles) {
    for (let i = 0; i < sessionsPerProfile; i++) {
      const task = (async () => {
        let result: SessionResult;
        if (profile.isBot) {
          result = await runBot({
            baseUrl,
            profile,
            attackProfile,
            headless,
          });
        } else {
          result = await runSimulator({
            baseUrl,
            profile,
            headless,
          });
        }
        completed++;
        onProgress?.(`  [${completed}/${total}] ${profile.name} session complete`);
        return result;
      })();
      tasks.push(task);
    }
  }

  return Promise.all(tasks);
}
