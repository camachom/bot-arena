#!/usr/bin/env node
import { Command } from 'commander';
import { join, resolve, dirname } from 'path';
import { existsSync } from 'fs';
import { fileURLToPath } from 'url';
import type { RoundReport, AttackProfileProposal, PolicyProposal, RoundMetrics, AttackProfile, Policy, ValidationResult } from '@bot-arena/types';

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
import { generateSummary } from './summary.js';
import { isGitRepo, commitRound, commitFightEnd } from './git.js';
import { determineWinner, DEFAULT_WIN_CONDITIONS } from './scoring.js';
import type { WinConditions } from '@bot-arena/types';
import { loadHistory, saveHistory } from './history.js';
import { loadState, saveState, getNextFightNumber, formatFightRound, formatReportFilename } from './state.js';
import type { ProposalHistoryEntry } from '@bot-arena/types';

const program = new Command();

program
  .name('arena')
  .description('Bot Arena - Self-play arena for scraping bot vs detection')
  .version('0.1.0');

program
  .option('-r, --rounds <number>', 'Number of rounds to run', '5')
  .option('-p, --port <number>', 'Base port for target app', '3000')
  .option('-s, --sessions <number>', 'Sessions per profile', '10')
  .option('--fpr-threshold <number>', 'Max FPR for Blue to win', '0.05')
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
    const fprThreshold = parseFloat(options.fprThreshold);
    const useAgents = options.agents !== false;
    const useGit = options.git !== false;
    const fast = options.fast === true;

    // Build win conditions from CLI options
    const winConditions: WinConditions = {
      ...DEFAULT_WIN_CONDITIONS,
      fprThreshold,
    };

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

    // Load state (includes all historical reports)
    const statePath = join(configDir, 'arena-state.json');
    const state = loadState(statePath);
    const fightNumber = getNextFightNumber(state);
    state.currentFightNumber = fightNumber;

    console.log('Bot Arena Starting...\n');
    console.log(`Fight: ${fightNumber}`);
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

    // Track metrics history for trends (current fight only)
    const metricsHistory: RoundMetrics[] = [];

    for (let round = 1; round <= rounds; round++) {
      console.log(`\nFight ${fightNumber} - Round ${round}/${rounds}`);
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
      const { metrics } = await runTournament(tournamentConfig, fightNumber, round);

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

      // Track metrics for trends
      metricsHistory.push(metrics);

      // Show trends (compare to previous round - from current fight or last fight)
      const allReportsWithCurrent = [...state.reports, { metrics } as RoundReport];
      if (allReportsWithCurrent.length > 1) {
        const prev = allReportsWithCurrent[allReportsWithCurrent.length - 2];
        const extractionDelta = metrics.botExtractionRate - prev.metrics.botExtractionRate;
        const arrow = extractionDelta > 0 ? '↑' : extractionDelta < 0 ? '↓' : '→';
        const prevLabel = formatFightRound(prev.metrics.fightNumber, prev.metrics.roundNumber);
        console.log(`├─ Trend: extraction ${arrow} ${Math.abs(extractionDelta * 100).toFixed(0)}% from ${prevLabel}`);
      }

      // Show all-time scoreboard
      const allMetrics = [...state.reports.map(r => r.metrics), metrics];
      const redWins = allMetrics.filter(m => determineWinner(m, winConditions).winner === 'red').length;
      const blueWins = allMetrics.filter(m => determineWinner(m, winConditions).winner === 'blue').length;
      const draws = allMetrics.length - redWins - blueWins;
      console.log(`├─ Scoreboard: 🔴 ${redWins} | 🔵 ${blueWins} | ⚪ ${draws}  (all-time)`);

      const { winner, reason } = determineWinner(metrics, winConditions);
      const winnerLabel = winner === 'red' ? '🔴 Red' : winner === 'blue' ? '🔵 Blue' : '⚪ Draw';
      console.log(`└─ Winner: ${winnerLabel} (${reason})`);

      // Get agent proposals - only from losing team (or both on draw)
      let redProposal: AttackProfileProposal | undefined;
      let blueProposal: PolicyProposal | undefined;

      if (getRedProposal && getBlueProposal) {
        const attackProfile = loadAttackProfile(attackProfilePath);
        const policy = loadPolicy(policyPath);

        try {
          // Red proposes if blue won or draw
          if (winner !== 'red') {
            redProposal = await getRedProposal(metrics, attackProfile, history);
            console.log(`├─ Red proposal: ${summarizeRedProposal(redProposal)}`);
          } else {
            console.log(`├─ Red: skipped (winner)`);
          }

          // Blue proposes if red won or draw
          if (winner !== 'blue') {
            blueProposal = await getBlueProposal(metrics, policy, history);
            console.log(`├─ Blue proposal: ${summarizeBlueProposal(blueProposal)}`);
          } else {
            console.log(`├─ Blue: skipped (winner)`);
          }
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
        fast,
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
        blueValidation = await validateBlueProposal(validatorConfig, blueProposal, metrics, winConditions);
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
      const { winner: reportWinner, reason: winReason } = determineWinner(metrics, winConditions);
      const report: RoundReport = {
        fightNumber,
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

      const reportFilename = formatReportFilename(fightNumber, round);
      const reportPath = join(reportsDir, reportFilename);
      generateReport(report, reportPath);

      // Update state with new report
      state.reports.push(report);
      saveState(statePath, state);

      console.log(`\nReport: ${reportPath}`);

      // Git tracking (if in a git repo and changes were accepted)
      if (useGit && isGitRepo() && (redValidation?.accepted || blueValidation?.accepted)) {
        try {
          commitRound(report, rootDir);
          console.log(`Git: committed ${formatFightRound(fightNumber, round)} changes`);
        } catch (err) {
          console.warn('Git commit failed:', err instanceof Error ? err.message : String(err));
        }
      }
    }

    // Generate cumulative summary dashboard from ALL reports
    const summaryPath = join(reportsDir, 'summary.html');
    generateSummary(state.reports, summaryPath);
    console.log(`\nSummary: ${summaryPath} (${state.reports.length} total rounds)`);

    // Commit final state if in git repo
    if (useGit && isGitRepo()) {
      try {
        commitFightEnd(fightNumber, state.reports.slice(-rounds), reportsDir, statePath, rootDir);
        console.log(`Git: committed fight ${fightNumber} summary`);
      } catch (err) {
        console.warn('Git commit failed:', err instanceof Error ? err.message : String(err));
      }
    }

    console.log('\nBot Arena Complete!');
  });

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
