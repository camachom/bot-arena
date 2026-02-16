import { describe, it, expect } from 'vitest';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..', '..', '..');

describe('tournament', () => {
  const configDir = join(rootDir, 'configs');

  it('should have attack_profile.json', () => {
    const path = join(configDir, 'attack_profile.json');
    expect(existsSync(path)).toBe(true);
  });

  it('should have policy.yml', () => {
    const path = join(configDir, 'policy.yml');
    expect(existsSync(path)).toBe(true);
  });

  it('should parse attack profile correctly', async () => {
    const { loadAttackProfile } = await import('./tournament.js');
    const profile = loadAttackProfile(join(configDir, 'attack_profile.json'));

    expect(profile.mode).toBe('headless');
    expect(profile.concurrency).toBe(3);
    expect(profile.requests_per_minute).toBe(40);
    expect(profile.warmup).toBe(true);
    expect(profile.jitter_ms).toEqual([500, 2000]);
  });

  it('should parse policy correctly', async () => {
    const { loadPolicy } = await import('./tournament.js');
    const policy = loadPolicy(join(configDir, 'policy.yml'));

    expect(policy.features.reqs_per_min.weight).toBe(1.5);
    expect(policy.features.reqs_per_min.threshold).toBe(20);
    expect(policy.actions.allow.max_score).toBe(2);
    expect(policy.constraints.max_false_positive_rate).toBe(0.01);
  });
});
