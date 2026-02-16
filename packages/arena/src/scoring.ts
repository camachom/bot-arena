import type { RoundMetrics, WinConditions } from '@bot-arena/types';

export const DEFAULT_WIN_CONDITIONS: WinConditions = {
  fprThreshold: 0.05,        // 5% more realistic for small samples
  humanSuccessThreshold: 0.95,
  redWinThreshold: 0.5,
  blueWinThreshold: 0.5,
};

export function determineWinner(
  metrics: RoundMetrics,
  conditions: WinConditions = DEFAULT_WIN_CONDITIONS
): { winner: 'red' | 'blue' | 'draw'; reason: string } {
  const { botExtractionRate, botSuppressionRate, falsePositiveRate } = metrics;

  const blueConstrained = falsePositiveRate <= conditions.fprThreshold;

  if (botExtractionRate > conditions.redWinThreshold) {
    return { winner: 'red', reason: `${(botExtractionRate * 100).toFixed(0)}% extraction` };
  }

  if (botSuppressionRate > conditions.blueWinThreshold && blueConstrained) {
    return { winner: 'blue', reason: `${(botSuppressionRate * 100).toFixed(0)}% suppression, ${(falsePositiveRate * 100).toFixed(1)}% FPR` };
  }

  return { winner: 'draw', reason: 'no clear advantage' };
}
