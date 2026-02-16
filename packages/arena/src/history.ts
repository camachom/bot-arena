import { readFileSync, writeFileSync, existsSync } from 'fs';
import type { ProposalHistoryEntry, AttackProfileProposal, PolicyProposal } from '@bot-arena/types';

export function loadHistory(path: string): ProposalHistoryEntry[] {
  if (!existsSync(path)) {
    return [];
  }
  try {
    const content = readFileSync(path, 'utf-8');
    return JSON.parse(content) as ProposalHistoryEntry[];
  } catch {
    return [];
  }
}

export function saveHistory(path: string, entries: ProposalHistoryEntry[]): void {
  writeFileSync(path, JSON.stringify(entries, null, 2));
}

function summarizeChanges(proposal: AttackProfileProposal | PolicyProposal): string {
  const changes = proposal.changes;
  const parts: string[] = [];

  // Handle attack profile changes
  if ('concurrency' in changes && changes.concurrency !== undefined) {
    parts.push(`concurrency→${changes.concurrency}`);
  }
  if ('requests_per_minute' in changes && changes.requests_per_minute !== undefined) {
    parts.push(`rpm→${changes.requests_per_minute}`);
  }
  if ('jitter_ms' in changes && changes.jitter_ms !== undefined) {
    const jitter = changes.jitter_ms as [number, number];
    parts.push(`jitter→${jitter[0]}-${jitter[1]}ms`);
  }
  if ('warmup' in changes && changes.warmup !== undefined) {
    parts.push(`warmup=${changes.warmup}`);
  }

  // Handle policy changes
  if ('features' in changes && changes.features) {
    for (const [key, val] of Object.entries(changes.features)) {
      if (val && typeof val === 'object' && 'weight' in val) {
        parts.push(`${key} weight→${val.weight}`);
      }
      if (val && typeof val === 'object' && 'threshold' in val) {
        parts.push(`${key} thresh→${val.threshold}`);
      }
    }
  }

  return parts.length > 0 ? parts.join(', ') : 'no specific changes';
}

export function formatHistoryForAgent(
  entries: ProposalHistoryEntry[],
  team: 'red' | 'blue',
  limit = 5
): string {
  const teamEntries = entries.filter((e) => e.team === team).slice(-limit);

  if (teamEntries.length === 0) {
    return 'No previous attempts.';
  }

  const lines = teamEntries.map((entry) => {
    const status = entry.accepted ? 'ACCEPTED' : 'REJECTED';
    const summary = summarizeChanges(entry.proposal);
    const metricsChange = entry.metricsAfter
      ? team === 'red'
        ? `extraction ${(entry.metricsBefore.extraction * 100).toFixed(0)}%→${(entry.metricsAfter.extraction * 100).toFixed(0)}%`
        : `suppression ${(entry.metricsBefore.suppression * 100).toFixed(0)}%→${(entry.metricsAfter.suppression * 100).toFixed(0)}%`
      : entry.reason;

    return `- Round ${entry.roundNumber}: ${summary} → ${status} (${metricsChange})`;
  });

  return `Previous attempts:\n${lines.join('\n')}`;
}
