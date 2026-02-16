#!/usr/bin/env node
import { Command } from 'commander';
import { join, resolve, dirname } from 'path';
import { existsSync } from 'fs';
import { fileURLToPath } from 'url';
import type { RoundReport, AttackProfileProposal, PolicyProposal, RoundMetrics, AttackProfile, Policy } from '@bot-arena/types';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, '..', '..', '..');
import {
  runTournament,
  loadAttackProfile,
  loadPolicy,
  type TournamentConfig,
} from './tournament.js';
import { validateRedProposal, validateBlueProposal, type ValidatorConfig } from './validator.js';
import { generateReport } from './report.js';
import { isGitRepo, commitRound } from './git.js';
import { loadHistory, saveHistory } from './history.js';
import type { ProposalHistoryEntry } from '@bot-arena/types';

const program = new Command();

program
  .name('arena')
  .description('Bot Arena - Self-play arena for scraping bot vs detection')
  .version('0.1.0');

program
  .option('-r, --rounds <number>', 'Number of rounds to run', '5')
  .option('-p, --port <number>', 'Base port for target app', '3000')
  .option('-s, --sessions <number>', 'Sessions per profile', '3')
  .option('--no-agents', 'Skip agent proposals')
  .option('--no-git', 'Disable automatic git commits')
  .option('-f, --fast', 'Fast mode with reduced dwell times')
  .option('--config-dir <path>', 'Config directory', join(rootDir, 'configs'))
  .option('--profiles-dir <path>', 'Profiles directory', join(rootDir, 'packages/traffic/src/profiles'))
  .option('--reports-dir <path>', 'Reports output directory', join(rootDir, 'reports'))
  .action(async (options) => {
    const rounds = parseInt(options.rounds);
    const port = parseInt(options.port);
    const sessions = parseInt(options.sessions);
    const useAgents = options.agents !== false;
    const useGit = options.git !== false;
    const fast = options.fast === true;

    const configDir = resolve(options.configDir);
    const profilesDir = resolve(options.profilesDir);
    const reportsDir = resolve(options.reportsDir);

    const attackProfilePath = join(configDir, 'attack_profile.json');
    const policyPath = join(configDir, 'policy.yml');

    const profilePaths = [
      join(profilesDir, 'human.json'),
      join(profilesDir, 'naive.json'),
      join(profilesDir, 'moderate.json'),
      join(profilesDir, 'aggressive.json'),
    ].filter((p) => existsSync(p));

    if (profilePaths.length === 0) {
      console.error('No traffic profiles found in', profilesDir);
      process.exit(1);
    }

    console.log('Bot Arena Starting...\n');
    console.log(`Rounds: ${rounds}`);
    console.log(`Profiles: ${profilePaths.map((p) => p.split('/').pop()).join(', ')}`);
    console.log(`Sessions per profile: ${sessions}`);
    console.log(`Agents: ${useAgents ? 'enabled' : 'disabled'}`);
    console.log(`Fast mode: ${fast ? 'enabled' : 'disabled'}\n`);

    // Import agents dynamically to avoid circular deps
    let getRedProposal: ((metrics: RoundMetrics, profile: AttackProfile, history: ProposalHistoryEntry[]) => Promise<AttackProfileProposal>) | null = null;
    let getBlueProposal: ((metrics: RoundMetrics, policy: Policy, history: ProposalHistoryEntry[]) => Promise<PolicyProposal>) | null = null;

    if (useAgents) {
      try {
        const agentModule = await import('@bot-arena/agent');
        getRedProposal = agentModule.getRedProposal;
        getBlueProposal = agentModule.getBlueProposal;
      } catch (err) {
        console.warn('Agent module not available, running without agents');
      }
    }

    // Load proposal history
    const historyPath = join(configDir, 'history.json');
    let history = loadHistory(historyPath);

    // Helper to check if proposal has changes
    function hasChanges(changes: object): boolean {
      return Object.keys(changes).length > 0;
    }

    for (let round = 1; round <= rounds; round++) {
      console.log(`\nRound ${round}/${rounds}`);
      console.log('─'.repeat(40));

      const tournamentConfig: TournamentConfig = {
        attackProfilePath,
        policyPath,
        profilePaths,
        sessionsPerProfile: sessions,
        port,
        fast,
        onProgress: (msg) => console.log(msg),
      };

      // Run tournament
      const { metrics } = await runTournament(tournamentConfig, round);

      // Print results
      for (const profile of metrics.profiles) {
        const icon = profile.isBot ? '├─' : '├─';
        const label = profile.isBot ? `Bot ${profile.profileType}` : 'Human sim';
        const extraction = (profile.extractionRate * 100).toFixed(0);
        const score = profile.avgScore.toFixed(1);

        if (profile.isBot) {
          const actions = [];
          if (profile.blockedRequests > 0) actions.push(`${profile.blockedRequests} blocked`);
          if (profile.throttledRequests > 0) actions.push(`${profile.throttledRequests} throttled`);
          if (profile.challengedRequests > 0) actions.push(`${profile.challengedRequests} challenged`);
          const actionStr = actions.length > 0 ? actions.join(', ') : 'no actions';
          console.log(`${icon} ${label}: ${extraction}% extracted, ${actionStr}, score ${score}`);
        } else {
          console.log(`${icon} ${label}: ${extraction}% success, avg score ${score}`);
        }
      }

      const { winner, reason } = determineWinner(metrics);
      const winnerLabel = winner === 'red' ? '🔴 Red' : winner === 'blue' ? '🔵 Blue' : '⚪ Draw';
      console.log(`└─ Winner: ${winnerLabel} (${reason})`);

      // Get agent proposals
      let redProposal: AttackProfileProposal | undefined;
      let blueProposal: PolicyProposal | undefined;

      if (getRedProposal && getBlueProposal) {
        const attackProfile = loadAttackProfile(attackProfilePath);
        const policy = loadPolicy(policyPath);

        try {
          [redProposal, blueProposal] = await Promise.all([
            getRedProposal(metrics, attackProfile, history),
            getBlueProposal(metrics, policy, history),
          ]);

          console.log(`├─ Red proposal: ${summarizeRedProposal(redProposal)}`);
          console.log(`├─ Blue proposal: ${summarizeBlueProposal(blueProposal)}`);
        } catch (err) {
          console.log('├─ Agent proposals failed:', err instanceof Error ? err.message : 'Unknown error');
        }
      }

      // Validate proposals
      let redValidation;
      let blueValidation;

      const validatorConfig: ValidatorConfig = {
        attackProfilePath,
        policyPath,
        profilePaths,
        sessionsPerProfile: sessions,
        port,
      };

      if (redProposal && hasChanges(redProposal.changes)) {
        console.log('├─ Validation: running tournament for Red...');
        redValidation = await validateRedProposal(validatorConfig, redProposal, metrics);
        console.log(`├─ Red: ${redValidation.accepted ? 'ACCEPTED' : 'REJECTED'} (${redValidation.reason})`);
      } else if (redProposal) {
        console.log('├─ Red: skipped (no changes)');
      }

      if (blueProposal && hasChanges(blueProposal.changes)) {
        console.log('├─ Validation: running tournament for Blue...');
        blueValidation = await validateBlueProposal(validatorConfig, blueProposal, metrics);
        console.log(`├─ Blue: ${blueValidation.accepted ? 'ACCEPTED' : 'REJECTED'} (${blueValidation.reason})`);
      } else if (blueProposal) {
        console.log('├─ Blue: skipped (no changes)');
      }

      // Update history
      const metricsBefore = {
        extraction: metrics.botExtractionRate,
        suppression: metrics.botSuppressionRate,
        fpr: metrics.falsePositiveRate,
      };

      if (redProposal) {
        const entry: ProposalHistoryEntry = {
          roundNumber: round,
          team: 'red',
          proposal: redProposal,
          accepted: redValidation?.accepted ?? false,
          reason: redValidation?.reason ?? 'no changes',
          metricsBefore,
          metricsAfter: redValidation?.afterMetrics ? {
            extraction: redValidation.afterMetrics.botExtractionRate,
            suppression: redValidation.afterMetrics.botSuppressionRate,
            fpr: redValidation.afterMetrics.falsePositiveRate,
          } : undefined,
        };
        history.push(entry);
      }

      if (blueProposal) {
        const entry: ProposalHistoryEntry = {
          roundNumber: round,
          team: 'blue',
          proposal: blueProposal,
          accepted: blueValidation?.accepted ?? false,
          reason: blueValidation?.reason ?? 'no changes',
          metricsBefore,
          metricsAfter: blueValidation?.afterMetrics ? {
            extraction: blueValidation.afterMetrics.botExtractionRate,
            suppression: blueValidation.afterMetrics.botSuppressionRate,
            fpr: blueValidation.afterMetrics.falsePositiveRate,
          } : undefined,
        };
        history.push(entry);
      }

      // Save history after each round
      saveHistory(historyPath, history);

      // Generate report
      const { winner: reportWinner, reason: winReason } = determineWinner(metrics);
      const report: RoundReport = {
        roundNumber: round,
        timestamp: metrics.timestamp,
        metrics,
        redProposal,
        blueProposal,
        redValidation,
        blueValidation,
        attackProfile: loadAttackProfile(attackProfilePath),
        policy: loadPolicy(policyPath),
        winner: reportWinner,
        winReason,
      };

      const reportPath = join(reportsDir, `round-${String(round).padStart(3, '0')}.html`);
      generateReport(report, reportPath);
      console.log(`\nReport: ${reportPath}`);

      // Git tracking (if in a git repo and changes were accepted)
      if (useGit && isGitRepo() && (redValidation?.accepted || blueValidation?.accepted)) {
        try {
          commitRound(report, rootDir);
          console.log(`Git: committed round ${round} changes`);
        } catch (err) {
          console.warn('Git commit failed:', err instanceof Error ? err.message : String(err));
        }
      }
    }

    console.log('\nBot Arena Complete!');
  });

function determineWinner(metrics: RoundMetrics): { winner: 'red' | 'blue' | 'draw'; reason: string } {
  const { botExtractionRate, botSuppressionRate, falsePositiveRate } = metrics;

  const blueConstrained = falsePositiveRate <= 0.01;

  if (botExtractionRate > 0.5) {
    return { winner: 'red', reason: `${(botExtractionRate * 100).toFixed(0)}% extraction` };
  }

  if (botSuppressionRate > 0.5 && blueConstrained) {
    return { winner: 'blue', reason: `${(botSuppressionRate * 100).toFixed(0)}% suppression, ${(falsePositiveRate * 100).toFixed(1)}% FPR` };
  }

  return { winner: 'draw', reason: 'no clear advantage' };
}

function summarizeRedProposal(proposal: AttackProfileProposal): string {
  const changes: string[] = [];
  const c = proposal.changes;

  if (c.concurrency !== undefined) changes.push(`concurrency→${c.concurrency}`);
  if (c.requests_per_minute !== undefined) changes.push(`rpm→${c.requests_per_minute}`);
  if (c.jitter_ms !== undefined) changes.push(`jitter→${c.jitter_ms[0]}-${c.jitter_ms[1]}ms`);
  if (c.warmup !== undefined) changes.push(`warmup=${c.warmup}`);

  return changes.length > 0 ? changes.join(', ') : 'no changes';
}

function summarizeBlueProposal(proposal: PolicyProposal): string {
  const changes: string[] = [];
  const c = proposal.changes;

  if (c.features) {
    for (const [key, val] of Object.entries(c.features)) {
      if (val && typeof val === 'object') {
        if ('weight' in val) changes.push(`${key} weight→${val.weight}`);
        if ('threshold' in val) changes.push(`${key} thresh→${val.threshold}`);
      }
    }
  }

  if (c.actions) {
    for (const [action, val] of Object.entries(c.actions)) {
      if (val && typeof val === 'object' && 'max_score' in val) {
        changes.push(`${action}→${val.max_score}`);
      }
    }
  }

  if (c.constraints) {
    for (const [key, val] of Object.entries(c.constraints)) {
      changes.push(`${key}→${val}`);
    }
  }

  return changes.length > 0 ? changes.join(', ') : 'no changes';
}

program.parse();
