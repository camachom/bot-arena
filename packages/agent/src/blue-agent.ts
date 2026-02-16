import Anthropic from '@anthropic-ai/sdk';
import type { RoundMetrics, Policy, PolicyProposal, ProposalHistoryEntry } from '@bot-arena/types';
import { env } from './env.js';

const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

const SYSTEM_PROMPT = `You are a Blue Team agent in a bot arena. Your goal is to maximize bot suppression while keeping false positives below 1%.

You analyze round metrics and propose changes to the detection policy. Changes are validated - only improvements that maintain constraints are accepted.

Key metrics you care about:
- Bot suppression rate (higher = better)
- False positive rate (must stay ≤ 1%)
- Human success rate (must stay ≥ 99%)
- Which features triggered most detections

Detection features you can tune:
- reqs_per_min: requests per minute threshold + weight
- unique_queries_per_hour: distinct searches threshold + weight
- pagination_ratio: page views / unique pages threshold + weight
- session_depth: max pagination depth threshold + weight
- dwell_time_avg: time between requests (LOW = bot) threshold + weight
- asset_warmup_missing: no CSS/JS loaded = headless bot, weight only

Actions thresholds:
- allow.max_score: below this = allow
- throttle.max_score: below this = slow down
- challenge.max_score: below this = captcha
- block.max_score: above this = block

Score = sum of (weight) for each feature exceeding threshold.

Only include fields you want to change. Be careful with false positives - aggressive policies can block humans.`;

const proposalTool: Anthropic.Tool = {
  name: 'submit_proposal',
  description: 'Submit your proposed changes to the detection policy',
  input_schema: {
    type: 'object',
    properties: {
      changes: {
        type: 'object',
        description: 'Partial policy with only the fields you want to change',
      },
      reasoning: {
        type: 'string',
        description: 'Brief explanation of your strategy',
      },
    },
    required: ['changes', 'reasoning'],
  },
};

export async function getBlueProposal(
  metrics: RoundMetrics,
  currentPolicy: Policy,
  history: ProposalHistoryEntry[] = []
): Promise<PolicyProposal> {
  const historySection = formatHistory(history);

  const prompt = `Current policy:
${JSON.stringify(currentPolicy, null, 2)}

Round ${metrics.roundNumber} metrics:
- Bot suppression rate: ${(metrics.botSuppressionRate * 100).toFixed(1)}%
- Bot extraction rate: ${(metrics.botExtractionRate * 100).toFixed(1)}%
- Human success rate: ${(metrics.humanSuccessRate * 100).toFixed(1)}%
- False positive rate: ${(metrics.falsePositiveRate * 100).toFixed(2)}%

Profile breakdown:
${metrics.profiles
  .map(
    (p) =>
      `- ${p.profileType} (${p.isBot ? 'bot' : 'human'}): ${(p.extractionRate * 100).toFixed(1)}% extracted, ${p.blockedRequests} blocked, avg score ${p.avgScore.toFixed(2)}`
  )
  .join('\n')}

${historySection}

Analyze these results and use the submit_proposal tool to propose changes that will improve suppression while keeping FPR ≤ 1%.`;

  function formatHistory(entries: ProposalHistoryEntry[]): string {
    const blueEntries = entries.filter((e) => e.team === 'blue').slice(-5);
    if (blueEntries.length === 0) return '';

    const lines = blueEntries.map((entry) => {
      const status = entry.accepted ? 'ACCEPTED' : 'REJECTED';
      const changes = Object.keys(entry.proposal.changes).length > 0
        ? JSON.stringify(entry.proposal.changes)
        : 'no changes';
      const metricsChange = entry.metricsAfter
        ? `suppression ${(entry.metricsBefore.suppression * 100).toFixed(0)}%→${(entry.metricsAfter.suppression * 100).toFixed(0)}%`
        : entry.reason;
      return `- Round ${entry.roundNumber}: ${changes} → ${status} (${metricsChange})`;
    });

    return `Previous attempts:\n${lines.join('\n')}`;
  }

  const response = await client.messages.create({
    model: env.ANTHROPIC_MODEL,
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    tools: [proposalTool],
    tool_choice: { type: 'tool', name: 'submit_proposal' },
    messages: [{ role: 'user', content: prompt }],
  });

  const toolUse = response.content.find((block) => block.type === 'tool_use');
  if (toolUse && toolUse.type === 'tool_use') {
    const input = toolUse.input as { changes?: Partial<Policy>; reasoning?: string };
    return {
      changes: input.changes || {},
      reasoning: input.reasoning || 'No reasoning provided',
    };
  }

  return {
    changes: {},
    reasoning: 'No tool use in response',
  };
}
