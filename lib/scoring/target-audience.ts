// ============================================================
// BRAND-LEVEL TARGET AUDIENCE (audience-fit live)
//
// Maps brand_profiles targeting fields onto the structured
// product_attributes.target_audience object the conviction scorer reads
// (readTargetAudience in lib/scoring/conviction.ts). Brand-level defaults
// for now — a future per-campaign LLM refinement layer derives a target
// from the brief and overrides this same key at the same persist site; the
// scorer contract never changes.
//
// Pure, no I/O.
// ============================================================

import type { BrandProfile } from "@/lib/data/types";

/** Shape consumed by readTargetAudience (conviction.ts). */
export interface BrandTargetAudience {
  age_min?: number;
  age_max?: number;
  gender?: string;
}

/**
 * Build the target from a brand profile, or null when there's nothing to
 * target (null profile / no fields set) — callers omit the key entirely so
 * readTargetAudience returns null and audience fit degrades honestly.
 *
 * Gender rules:
 * - "mostly_men" / "mostly_women" / "mixed" pass through VERBATIM —
 *   normalizeGenderTarget (conviction.ts) already maps all three, and
 *   persisting the source value keeps the pattern row honest training data.
 * - "no_preference" (and null) OMIT gender: a stated no-preference must not
 *   become a "reward balanced shows" signal. Absent gender → scoreGender
 *   returns null → age is the only audience-fit signal.
 */
export function buildTargetAudience(
  profile: Pick<
    BrandProfile,
    "target_age_min" | "target_age_max" | "target_gender"
  > | null
): BrandTargetAudience | null {
  if (!profile) return null;
  const t: BrandTargetAudience = {};
  if (typeof profile.target_age_min === "number") {
    t.age_min = profile.target_age_min;
  }
  if (typeof profile.target_age_max === "number") {
    t.age_max = profile.target_age_max;
  }
  if (profile.target_gender && profile.target_gender !== "no_preference") {
    t.gender = profile.target_gender;
  }
  if (t.age_min === undefined && t.age_max === undefined && !t.gender) {
    return null;
  }
  return t;
}
