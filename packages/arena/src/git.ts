import { execSync } from 'child_process';
import { join } from 'path';
import type { RoundReport } from '@bot-arena/types';
import { determineWinner } from './scoring.js';

export function isGitRepo(): boolean {
  try {
    execSync('git rev-parse --git-dir', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function formatFightRound(fightNumber: number, roundNumber: number): string {
  return `F${fightNumber}-R${roundNumber}`;
}

export function commitRound(report: RoundReport, rootDir: string): void {
  const { fightNumber, roundNumber, redValidation, blueValidation } = report;

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

  const roundLabel = formatFightRound(fightNumber, roundNumber);
  const message = `${roundLabel}: ${changes.join(', ')}

Metrics:
- Bot extraction: ${(report.metrics.botExtractionRate * 100).toFixed(1)}%
- Bot suppression: ${(report.metrics.botSuppressionRate * 100).toFixed(1)}%
- Human success: ${(report.metrics.humanSuccessRate * 100).toFixed(1)}%
- False positive: ${(report.metrics.falsePositiveRate * 100).toFixed(2)}%`;

  execSync(`git commit -m "${message.replace(/"/g, '\\"')}"`);
}

export function commitFightEnd(
  fightNumber: number,
  fightReports: RoundReport[],
  reportsDir: string,
  statePath: string,
  rootDir: string
): void {
  // Stage all report files for this fight
  for (const report of fightReports) {
    const fightPad = String(report.fightNumber).padStart(3, '0');
    const roundPad = String(report.roundNumber).padStart(3, '0');
    const reportPath = join(reportsDir, `round-F${fightPad}-R${roundPad}.html`);
    try {
      execSync(`git add "${reportPath}"`, { stdio: 'ignore' });
    } catch {
      // Report file may not exist if there were errors
    }
  }

  // Stage summary
  const summaryPath = join(reportsDir, 'summary.html');
  try {
    execSync(`git add "${summaryPath}"`, { stdio: 'ignore' });
  } catch {
    // Summary may not exist
  }

  // Stage state file
  try {
    execSync(`git add "${statePath}"`, { stdio: 'ignore' });
  } catch {
    // State file may not exist
  }

  // Check if there's anything to commit
  try {
    const status = execSync('git diff --cached --name-only', { encoding: 'utf-8' });
    if (!status.trim()) {
      return; // Nothing staged
    }
  } catch {
    return;
  }

  // Calculate fight summary
  const totalRounds = fightReports.length;
  const redWins = fightReports.filter(r => determineWinner(r.metrics).winner === 'red').length;
  const blueWins = fightReports.filter(r => determineWinner(r.metrics).winner === 'blue').length;
  const draws = totalRounds - redWins - blueWins;

  const message = `Fight ${fightNumber} complete: ${totalRounds} rounds

Results: Red ${redWins} | Blue ${blueWins} | Draw ${draws}`;

  execSync(`git commit -m "${message.replace(/"/g, '\\"')}"`);
}
