// ============================================================
// SCORING WEIGHTS
// Default dimension weights, redistribution logic for unavailable
// dimensions, and per-request override + product-context tilting
// for the conviction-scoring system (Wave 14 Phase 1).
// ============================================================

export interface ScoringWeights {
  audienceFit: number;        // Demographics match — default 40%
  adEngagement: number;       // Mid-roll engagement, completion — default 30%
  sponsorRetention: number;   // Repeat sponsors — default 20%
  reach: number;              // Audience size + PRS — default 10%
  // Phase 2 dimensions — optional, default 0 if not provided.
  // When set, these override the equivalent existing dimensions
  // in callers that have opted into the conviction-scoring system.
  topicalRelevance?: number;
  purchasePower?: number;
}

export const DEFAULT_WEIGHTS: ScoringWeights = {
  audienceFit: 0.4,
  adEngagement: 0.3,
  sponsorRetention: 0.2,
  reach: 0.1,
};

export type AovBucket = "low" | "mid" | "high";

export interface ProductContext {
  aovBucket?: AovBucket;
}

/**
 * Compute the effective weights for a scoring run.
 *
 * Phase 1 contract: when neither `topicalRelevance` nor `purchasePower`
 * are set in the merged weights, the function returns the existing
 * 4-dimensional weights unchanged. This keeps every existing caller
 * (lib/scoring/dimensions/*) on the legacy code path. Phase 2 will
 * pass non-zero values for those dimensions and opt callers in.
 *
 * Tilt logic for high-AOV products:
 *   When `aovBucket === 'high'` (product price >$1000), purchase power
 *   matters disproportionately — a $1500 cold plunge converts on
 *   high-HHI listeners and almost nowhere else, regardless of raw
 *   audience size. We bump purchasePower to 0.20 and shrink reach to
 *   0.05 to reflect that. Future engineers: the tilt is intentionally
 *   coarse-grained. Replace with a learned table once we have outcome
 *   data to fit against.
 */
export function getEffectiveWeights(
  base: ScoringWeights = DEFAULT_WEIGHTS,
  overrides?: Partial<ScoringWeights>,
  context?: ProductContext
): ScoringWeights {
  const merged: ScoringWeights = {
    ...base,
    ...overrides,
  };

  const topical = merged.topicalRelevance ?? 0;
  const purchase = merged.purchasePower ?? 0;

  // Backwards-compat fast path: no Phase 2 dimensions in play. Return
  // the 4-dimensional weights as-is. Existing scoring code paths that
  // sum the four legacy dimensions stay byte-for-byte identical.
  if (topical === 0 && purchase === 0) {
    return {
      audienceFit: merged.audienceFit,
      adEngagement: merged.adEngagement,
      sponsorRetention: merged.sponsorRetention,
      reach: merged.reach,
    };
  }

  let result: ScoringWeights = {
    audienceFit: merged.audienceFit,
    adEngagement: merged.adEngagement,
    sponsorRetention: merged.sponsorRetention,
    reach: merged.reach,
    topicalRelevance: topical,
    purchasePower: purchase,
  };

  if (context?.aovBucket === "high") {
    // High-AOV tilt: purchase power → 0.20, reach → 0.05. See header
    // comment. Override even if caller passed something else; product
    // context wins over generic overrides.
    result = {
      ...result,
      purchasePower: 0.2,
      reach: 0.05,
    };
  }

  return result;
}

/**
 * Redistributes weights when one or more dimensions have no data.
 * Missing dimensions' weight is distributed proportionally to remaining
 * dimensions so the active weights still sum to 1.0.
 *
 * Phase 1 added optional `topicalRelevance` and `purchasePower` to the
 * dimension set. Both default to `false` in `available` so existing
 * callers (which pass only the four legacy dimensions) are unaffected.
 *
 * Example: if adEngagement is unavailable (0.3 weight) and the Phase 2
 * dimensions are off, the remaining 0.7 is normalized to sum to 1.0:
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
    topicalRelevance?: boolean;
    purchasePower?: boolean;
  }
): ScoringWeights {
  const baseTopical = base.topicalRelevance ?? 0;
  const basePurchase = base.purchasePower ?? 0;

  const active = {
    audienceFit: available.audienceFit ? base.audienceFit : 0,
    adEngagement: available.adEngagement ? base.adEngagement : 0,
    sponsorRetention: available.sponsorRetention ? base.sponsorRetention : 0,
    reach: available.reach ? base.reach : 0,
    topicalRelevance: available.topicalRelevance ? baseTopical : 0,
    purchasePower: available.purchasePower ? basePurchase : 0,
  };

  const total =
    active.audienceFit +
    active.adEngagement +
    active.sponsorRetention +
    active.reach +
    active.topicalRelevance +
    active.purchasePower;

  if (total === 0) {
    // All dimensions unavailable — fall back to equal weights across
    // the four legacy dimensions only. Phase 2 dimensions stay off.
    return {
      audienceFit: 0.25,
      adEngagement: 0.25,
      sponsorRetention: 0.25,
      reach: 0.25,
    };
  }

  // Backwards-compat: if neither Phase 2 dimension is contributing,
  // return only the 4-dimensional shape so existing tests/callers see
  // an identical object.
  if (active.topicalRelevance === 0 && active.purchasePower === 0) {
    return {
      audienceFit: active.audienceFit / total,
      adEngagement: active.adEngagement / total,
      sponsorRetention: active.sponsorRetention / total,
      reach: active.reach / total,
    };
  }

  return {
    audienceFit: active.audienceFit / total,
    adEngagement: active.adEngagement / total,
    sponsorRetention: active.sponsorRetention / total,
    reach: active.reach / total,
    topicalRelevance: active.topicalRelevance / total,
    purchasePower: active.purchasePower / total,
  };
}
