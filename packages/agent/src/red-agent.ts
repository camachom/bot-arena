import Anthropic from '@anthropic-ai/sdk';
import type { RoundMetrics, AttackProfile, AttackProfileProposal } from '@bot-arena/types';

const client = new Anthropic();

const SYSTEM_PROMPT = `You are a Red Team agent in a bot arena. Your goal is to maximize data extraction from a target website while evading detection.

You analyze round metrics and propose changes to the attack profile configuration. Changes are validated - only improvements are accepted.

Key metrics you care about:
- Bot extraction rate (higher = better)
- Which bot profiles performed best/worst
- What features triggered detection

You can modify these attack profile settings:
- mode: "headless" or "headed"
- concurrency: number of parallel requests (1-10)
- requests_per_minute: rate limit (10-100)
- warmup: boolean - load assets first to appear human
- query_strategy.type: "refine", "random", or "sequential"
- query_strategy.edit_distance_max: how much to vary queries (1-5)
- pagination.max_depth_per_session: pages deep before rotating (1-10)
- pagination.rotate_sessions: boolean
- jitter_ms: [min, max] delay range between requests

Only include fields you want to change. Be strategic - small incremental changes work better than drastic ones.`;

const proposalTool: Anthropic.Tool = {
  name: 'submit_proposal',
  description: 'Submit your proposed changes to the attack profile',
  input_schema: {
    type: 'object',
    properties: {
      changes: {
        type: 'object',
        description: 'Partial attack profile with only the fields you want to change',
      },
      reasoning: {
        type: 'string',
        description: 'Brief explanation of your strategy',
      },
    },
    required: ['changes', 'reasoning'],
  },
};

export async function getRedProposal(
  metrics: RoundMetrics,
  currentProfile: AttackProfile
): Promise<AttackProfileProposal> {
  const prompt = `Current attack profile:
${JSON.stringify(currentProfile, null, 2)}

Round ${metrics.roundNumber} metrics:
- Bot extraction rate: ${(metrics.botExtractionRate * 100).toFixed(1)}%
- Bot suppression rate: ${(metrics.botSuppressionRate * 100).toFixed(1)}%

Profile breakdown:
${metrics.profiles
  .filter((p) => p.isBot)
  .map(
    (p) =>
      `- ${p.profileType}: ${(p.extractionRate * 100).toFixed(1)}% extracted, ${p.blockedRequests} blocked, avg score ${p.avgScore.toFixed(2)}`
  )
  .join('\n')}

Analyze these results and use the submit_proposal tool to propose changes that will improve extraction rate while avoiding detection.`;

  const response = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    tools: [proposalTool],
    tool_choice: { type: 'tool', name: 'submit_proposal' },
    messages: [{ role: 'user', content: prompt }],
  });

  const toolUse = response.content.find((block) => block.type === 'tool_use');
  if (toolUse && toolUse.type === 'tool_use') {
    const input = toolUse.input as { changes?: Partial<AttackProfile>; reasoning?: string };
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
