// Bounded lift from a brand's own confirmed imports and, separately,
// an anonymized pooled prior. The brand signal moves the score only
// when that brand's imports for this show have conversions above zero.
// The pool adds a smaller nudge only when a group of at least 5 brands
// has a median conversion rate above zero.
//
// Never lowers a score, never invents one from a missing composite, and
// never removes a show. Callers keep the show on screen either way.
// The composite passed in is the score so far (post-air lift already
// applied). The result stays within POST_AIR_SCORE_CAP, so the two
// lifts together cannot pass 100.

import { POST_AIR_SCORE_CAP } from "@/lib/scoring/post-air-lift";

/** Points added for this brand's own converting imports on the show. */
export const IMPORT_BRAND_LIFT_POINTS = 6;

/**
 * Smaller nudge when a pooled group exists and its median conversions
 * per 1,000 downloads is above zero.
 */
export const IMPORT_POOL_LIFT_POINTS = 2;

/** A pooled group is not a prior until this many distinct brands are in it. */
export const IMPORT_POOL_MIN_BRANDS = 5;

export interface ImportBrandSignal {
  records: number;
  conversions: number;
  spend: number;
  downloads: number;
}

export interface ImportPooledPrior {
  brandCount: number;
  recordCount: number;
  medianCpm: number | null;
  medianConversionsPer1kDownloads: number | null;
}

export interface ImportLift {
  /** Points actually added. Zero when there is nothing to apply. */
  delta: number;
  /**
   * Composite after this lift. Null when the incoming composite is
   * missing. A signal does not become a score.
   */
  adjusted: number | null;
  /** Shown next to the score. Null when nothing was learned. */
  reasoningLine: string | null;
}

/**
 * Apply the import lift on top of the score so far.
 * Pass null for a missing brand signal or a missing pooled prior.
 * With neither, delta is 0 and the score is unchanged.
 */
export function applyImportLift(
  composite: number | null,
  brandSignal: ImportBrandSignal | null,
  pooledPrior: ImportPooledPrior | null
): ImportLift {
  const base = finiteScore(composite);
  const conversions = positiveCount(brandSignal?.conversions);
  const brandLifts = conversions != null;
  const poolLifts = poolCanNudge(pooledPrior);

  if (!brandLifts && !poolLifts) {
    return { delta: 0, adjusted: base, reasoningLine: null };
  }
  if (base == null) {
    return { delta: 0, adjusted: null, reasoningLine: null };
  }

  const wanted =
    (brandLifts ? IMPORT_BRAND_LIFT_POINTS : 0) +
    (poolLifts ? IMPORT_POOL_LIFT_POINTS : 0);
  const room = Math.max(0, POST_AIR_SCORE_CAP - base);
  const delta = Math.min(wanted, room);
  const adjusted = base + delta;

  const sentences: string[] = [];
  if (brandLifts) {
    const noun = conversions === 1 ? "conversion" : "conversions";
    sentences.push(`From your past campaigns: ${conversions} ${noun}.`);
  }
  if (poolLifts) {
    sentences.push("Pattern across brands.");
  }
  const reasoningLine =
    delta > 0
      ? `${sentences.join(" ")} Score lifted +${delta}.`
      : `${sentences.join(" ")} Score held at ${base}; the lift is capped.`;

  return { delta, adjusted, reasoningLine };
}

function poolCanNudge(prior: ImportPooledPrior | null): boolean {
  if (!prior) return false;
  if (!Number.isFinite(prior.brandCount) || prior.brandCount < IMPORT_POOL_MIN_BRANDS) {
    return false;
  }
  const median = prior.medianConversionsPer1kDownloads;
  return median != null && Number.isFinite(median) && median > 0;
}

function positiveCount(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value) || value <= 0) return null;
  const truncated = Math.trunc(value);
  return truncated > 0 ? truncated : null;
}

function finiteScore(value: number | null): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  return value;
}
