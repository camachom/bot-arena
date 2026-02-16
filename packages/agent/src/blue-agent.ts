import Anthropic from '@anthropic-ai/sdk';
import type { RoundMetrics, Policy, PolicyProposal, ProposalHistoryEntry, FeatureAnalysis } from '@bot-arena/types';
import { env } from './env.js';

const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

const SYSTEM_PROMPT = `You are a Blue Team agent in a bot arena. Your goal is to maximize bot suppression while keeping false positives low.

You analyze round metrics and propose changes to the detection policy. Changes are validated - only improvements that maintain constraints are accepted.

Key metrics you care about:
- Bot suppression rate (higher = better)
- False positive rate (should stay ≤ 5% for acceptance)
- Human success rate (should stay ≥ 95% for acceptance)
- Which features triggered most detections

FEATURE ANALYSIS shows which features work:
- High discrimination ([GOOD]) = increase weight on these
- [FP RISK] = lower weight or raise threshold
- Use avg values to tune thresholds (set between bot avg and human avg)

IMPORTANT: Focus on FEATURE WEIGHTS rather than action thresholds. The current policy may have humans scoring ~2.2, so:
- If humans are being blocked, LOWER weights on features they trigger
- To catch more bots, RAISE weights on features bots trigger that humans don't

Detection features you can tune:
- reqs_per_min: requests per minute threshold + weight (bots are faster)
- unique_queries_per_hour: distinct searches threshold + weight (bots search more)
- pagination_ratio: page views / unique pages threshold + weight
- session_depth: max pagination depth threshold + weight (bots go deeper)
- dwell_time_avg: time between requests in ms (LOW = bot) threshold + weight
- timing_variance: coefficient of variation of request timing (LOW = bot, they're too consistent even with jitter)
- asset_warmup_missing: no CSS/JS loaded = headless bot, weight only (MOST RELIABLE)

Strategies that work:
1. Increase asset_warmup_missing weight - headless browsers don't load assets
2. Lower dwell_time_avg threshold - bots have unnaturally consistent timing
3. Be VERY conservative with changes - small weight adjustments (0.5) work better

Actions thresholds (allow < throttle < challenge < block):
- Raising thresholds = more permissive (fewer detections)
- Lowering thresholds = more aggressive (more detections)

Score = sum of (weight) for each feature exceeding threshold.`;

function formatFeatureAnalysis(analysis: FeatureAnalysis[]): string {
  const sorted = [...analysis].sort((a, b) => b.discriminationScore - a.discriminationScore);

  return sorted.map(f => {
    const botPct = (f.botTriggerRate * 100).toFixed(0);
    const humanPct = (f.humanTriggerRate * 100).toFixed(0);
    const discrim = (f.discriminationScore * 100).toFixed(0);

    let valueInfo = '';
    if (f.avgBotValue !== null && f.avgHumanValue !== null) {
      valueInfo = ` (bot avg: ${f.avgBotValue.toFixed(1)}, human avg: ${f.avgHumanValue.toFixed(1)})`;
    }

    const fpWarning = f.humanTriggerRate > 0.1 ? ' [FP RISK]' : '';
    const goodDiscrim = f.discriminationScore > 0.5 ? ' [GOOD]' : '';

    return `  ${f.featureName}: bot ${botPct}%, human ${humanPct}% (discrim: +${discrim}%)${valueInfo}${fpWarning}${goodDiscrim}`;
  }).join('\n');
}

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

Feature effectiveness (sorted by discrimination power):
${formatFeatureAnalysis(metrics.featureAnalysis)}

${historySection}

Analyze these results and use the submit_proposal tool to propose changes that will improve suppression while keeping FPR ≤ 5%.`;

  function formatHistory(entries: ProposalHistoryEntry[]): string {
    const blueEntries = entries.filter((e) => e.team === 'blue');
    if (blueEntries.length === 0) return '';

    const accepted = blueEntries.filter(e => e.accepted);
    const rejected = blueEntries.filter(e => !e.accepted);

    const formatEntry = (entry: ProposalHistoryEntry) => {
      const changes = Object.keys(entry.proposal.changes).length > 0
        ? JSON.stringify(entry.proposal.changes)
        : 'no changes';
      const metricsChange = entry.metricsAfter
        ? `suppression ${(entry.metricsBefore.suppression * 100).toFixed(0)}%→${(entry.metricsAfter.suppression * 100).toFixed(0)}%, FPR ${(entry.metricsBefore.fpr * 100).toFixed(0)}%→${(entry.metricsAfter.fpr * 100).toFixed(0)}%`
        : entry.reason;
      return `  - Round ${entry.roundNumber}: ${changes} (${metricsChange})`;
    };

    let result = 'Previous attempts:\n';
    if (accepted.length > 0) {
      result += `ACCEPTED (${accepted.length}):\n${accepted.map(formatEntry).join('\n')}\n`;
    }
    if (rejected.length > 0) {
      result += `REJECTED (${rejected.length}):\n${rejected.map(formatEntry).join('\n')}`;
    }
    return result;
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
