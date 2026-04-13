// ============================================================
// SCORING WEIGHTS
// Default dimension weights and redistribution logic for when
// a dimension's data is unavailable (e.g., engagement add-on).
// ============================================================

export interface ScoringWeights {
  audienceFit: number;    // Demographics match — default 40%
  adEngagement: number;   // Mid-roll engagement, completion — default 30%
  sponsorRetention: number; // Repeat sponsors — default 20%
  reach: number;          // Audience size + PRS — default 10%
}

export const DEFAULT_WEIGHTS: ScoringWeights = {
  audienceFit: 0.4,
  adEngagement: 0.3,
  sponsorRetention: 0.2,
  reach: 0.1,
};

/**
 * Redistributes weights when one or more dimensions have no data.
 * Missing dimensions' weight is distributed proportionally to remaining dimensions.
 *
 * Example: if adEngagement is unavailable (0.3 weight), the remaining
 * 0.7 is normalized to sum to 1.0:
 *   audienceFit: 0.4/0.7 ≈ 0.571
 *   sponsorRetention: 0.2/0.7 ≈ 0.286
 *   reach: 0.1/0.7 ≈ 0.143
 */
export function redistributeWeights(
  base: ScoringWeights,
  available: {
    audienceFit: boolean;
    adEngagement: boolean;
    sponsorRetention: boolean;
    reach: boolean;
  }
): ScoringWeights {
  const active: ScoringWeights = {
    audienceFit: available.audienceFit ? base.audienceFit : 0,
    adEngagement: available.adEngagement ? base.adEngagement : 0,
    sponsorRetention: available.sponsorRetention ? base.sponsorRetention : 0,
    reach: available.reach ? base.reach : 0,
  };

  const total = active.audienceFit + active.adEngagement + active.sponsorRetention + active.reach;

  if (total === 0) {
    // All dimensions unavailable — equal weights as fallback
    return { audienceFit: 0.25, adEngagement: 0.25, sponsorRetention: 0.25, reach: 0.25 };
  }

  return {
    audienceFit: active.audienceFit / total,
    adEngagement: active.adEngagement / total,
    sponsorRetention: active.sponsorRetention / total,
    reach: active.reach / total,
  };
}
