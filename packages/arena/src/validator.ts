import type {
  AttackProfile,
  Policy,
  RoundMetrics,
  ValidationResult,
  AttackProfileProposal,
  PolicyProposal,
} from '@bot-arena/types';
import {
  runTournament,
  loadAttackProfile,
  loadPolicy,
  saveAttackProfile,
  savePolicy,
  type TournamentConfig,
} from './tournament.js';

export interface ValidatorConfig {
  attackProfilePath: string;
  policyPath: string;
  profilePaths: string[];
  sessionsPerProfile?: number;
  port?: number;
}

function deepMerge<T extends object>(target: T, source: Partial<T>): T {
  const result = { ...target };

  for (const key of Object.keys(source) as (keyof T)[]) {
    const sourceValue = source[key];
    const targetValue = result[key];

    if (
      sourceValue !== undefined &&
      typeof sourceValue === 'object' &&
      sourceValue !== null &&
      !Array.isArray(sourceValue) &&
      typeof targetValue === 'object' &&
      targetValue !== null &&
      !Array.isArray(targetValue)
    ) {
      result[key] = deepMerge(targetValue as object, sourceValue as object) as T[keyof T];
    } else if (sourceValue !== undefined) {
      result[key] = sourceValue as T[keyof T];
    }
  }

  return result;
}

export async function validateRedProposal(
  config: ValidatorConfig,
  proposal: AttackProfileProposal,
  baselineMetrics: RoundMetrics
): Promise<ValidationResult> {
  const currentProfile = loadAttackProfile(config.attackProfilePath);
  const proposedProfile = deepMerge(currentProfile, proposal.changes);

  // Temporarily save proposed profile
  const backupProfile = { ...currentProfile };
  saveAttackProfile(config.attackProfilePath, proposedProfile);

  try {
    const tournamentConfig: TournamentConfig = {
      attackProfilePath: config.attackProfilePath,
      policyPath: config.policyPath,
      profilePaths: config.profilePaths,
      sessionsPerProfile: config.sessionsPerProfile,
      port: (config.port || 3000) + 1, // Use different port for validation
    };

    const { metrics: afterMetrics } = await runTournament(
      tournamentConfig,
      baselineMetrics.roundNumber
    );

    // Red team wins if extraction rate improves
    const beforeExtraction = baselineMetrics.botExtractionRate;
    const afterExtraction = afterMetrics.botExtractionRate;
    const improved = afterExtraction > beforeExtraction;

    // Check constraints (must still meet basic requirements)
    const constraintsMet = true; // Add specific constraint checks if needed

    const accepted = improved && constraintsMet;

    if (accepted) {
      // Keep the proposed profile
      return {
        accepted: true,
        reason: `Extraction improved from ${(beforeExtraction * 100).toFixed(1)}% to ${(afterExtraction * 100).toFixed(1)}%`,
        beforeMetrics: baselineMetrics,
        afterMetrics,
        improvement: {
          metric: 'botExtractionRate',
          before: beforeExtraction,
          after: afterExtraction,
          delta: afterExtraction - beforeExtraction,
        },
      };
    } else {
      // Restore backup
      saveAttackProfile(config.attackProfilePath, backupProfile);
      return {
        accepted: false,
        reason: improved
          ? 'Constraints not met'
          : `No improvement: ${(beforeExtraction * 100).toFixed(1)}% → ${(afterExtraction * 100).toFixed(1)}%`,
        beforeMetrics: baselineMetrics,
        afterMetrics,
      };
    }
  } catch (err) {
    // Restore backup on error
    saveAttackProfile(config.attackProfilePath, backupProfile);
    return {
      accepted: false,
      reason: `Validation error: ${err instanceof Error ? err.message : 'Unknown error'}`,
      beforeMetrics: baselineMetrics,
      afterMetrics: baselineMetrics,
    };
  }
}

export async function validateBlueProposal(
  config: ValidatorConfig,
  proposal: PolicyProposal,
  baselineMetrics: RoundMetrics
): Promise<ValidationResult> {
  const currentPolicy = loadPolicy(config.policyPath);
  const proposedPolicy = deepMerge(currentPolicy, proposal.changes);

  // Temporarily save proposed policy
  const backupPolicy = { ...currentPolicy };
  savePolicy(config.policyPath, proposedPolicy);

  try {
    const tournamentConfig: TournamentConfig = {
      attackProfilePath: config.attackProfilePath,
      policyPath: config.policyPath,
      profilePaths: config.profilePaths,
      sessionsPerProfile: config.sessionsPerProfile,
      port: (config.port || 3000) + 2, // Use different port for validation
    };

    const { metrics: afterMetrics } = await runTournament(
      tournamentConfig,
      baselineMetrics.roundNumber
    );

    // Blue team wins if suppression improves AND FPR stays under 1%
    const beforeSuppression = baselineMetrics.botSuppressionRate;
    const afterSuppression = afterMetrics.botSuppressionRate;
    const improved = afterSuppression > beforeSuppression;

    const fprConstraint = afterMetrics.falsePositiveRate <= 0.01;
    const humanSuccessConstraint = afterMetrics.humanSuccessRate >= 0.99;

    const accepted = improved && fprConstraint && humanSuccessConstraint;

    if (accepted) {
      // Keep the proposed policy
      return {
        accepted: true,
        reason: `Suppression improved from ${(beforeSuppression * 100).toFixed(1)}% to ${(afterSuppression * 100).toFixed(1)}%, FPR: ${(afterMetrics.falsePositiveRate * 100).toFixed(1)}%`,
        beforeMetrics: baselineMetrics,
        afterMetrics,
        improvement: {
          metric: 'botSuppressionRate',
          before: beforeSuppression,
          after: afterSuppression,
          delta: afterSuppression - beforeSuppression,
        },
      };
    } else {
      // Restore backup
      savePolicy(config.policyPath, backupPolicy);

      let reason = '';
      if (!improved) {
        reason = `No improvement: ${(beforeSuppression * 100).toFixed(1)}% → ${(afterSuppression * 100).toFixed(1)}%`;
      } else if (!fprConstraint) {
        reason = `FPR constraint violated: ${(afterMetrics.falsePositiveRate * 100).toFixed(1)}% > 1%`;
      } else if (!humanSuccessConstraint) {
        reason = `Human success rate too low: ${(afterMetrics.humanSuccessRate * 100).toFixed(1)}% < 99%`;
      }

      return {
        accepted: false,
        reason,
        beforeMetrics: baselineMetrics,
        afterMetrics,
      };
    }
  } catch (err) {
    // Restore backup on error
    savePolicy(config.policyPath, backupPolicy);
    return {
      accepted: false,
      reason: `Validation error: ${err instanceof Error ? err.message : 'Unknown error'}`,
      beforeMetrics: baselineMetrics,
      afterMetrics: baselineMetrics,
    };
  }
}
