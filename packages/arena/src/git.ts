import { execSync } from 'child_process';
import { join } from 'path';
import type { RoundReport } from '@bot-arena/types';

export function isGitRepo(): boolean {
  try {
    execSync('git rev-parse --git-dir', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

export function commitRound(report: RoundReport, rootDir: string): void {
  const { roundNumber, redValidation, blueValidation } = report;

  // Stage config files using absolute paths
  const attackProfilePath = join(rootDir, 'configs/attack_profile.json');
  const policyPath = join(rootDir, 'configs/policy.yml');
  execSync(`git add "${attackProfilePath}" "${policyPath}"`);

  // Build commit message
  const changes: string[] = [];
  if (redValidation?.accepted) {
    changes.push(`Red: ${redValidation.reason}`);
  }
  if (blueValidation?.accepted) {
    changes.push(`Blue: ${blueValidation.reason}`);
  }

  if (changes.length === 0) return; // Nothing accepted

  const message = `Round ${roundNumber}: ${changes.join(', ')}

Metrics:
- Bot extraction: ${(report.metrics.botExtractionRate * 100).toFixed(1)}%
- Bot suppression: ${(report.metrics.botSuppressionRate * 100).toFixed(1)}%
- Human success: ${(report.metrics.humanSuccessRate * 100).toFixed(1)}%
- False positive: ${(report.metrics.falsePositiveRate * 100).toFixed(2)}%`;

  execSync(`git commit -m "${message.replace(/"/g, '\\"')}"`);
}
