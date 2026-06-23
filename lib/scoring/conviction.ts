// ============================================================
// THREE-DIMENSIONAL CONVICTION SCORER (Wave 14 Phase 2B — Layer 2)
//
// Replaces the flat fit score with three NON-GATING sub-scores —
// audience fit, topical relevance, purchase power — plus a composite
// and a conviction band. PURE + deterministic: no LLM, no I/O, never
// throws. Persistence (recordConvictionScore) and Podscan vector
// adjacency live in Layer 3 (the orchestrator) — both are I/O and have
// no place in a pure function.
//
// Real-input notes (verified against the live 2A data model, not the
// spec's assumptions):
//   - A ring carries NO structured target profile — only label,
//     reasoning (free prose), and a confidence band. The confidence band
//     is the only structured target-side signal (drives the speculative
//     cap). Demographic intent lives only as prose in customer_summary /
//     reasoning, which a pure deterministic scorer cannot parse.
//   - Discovered shows carry EMPTY demographics ({}). So audience fit
//     "honest-degrades" (Chris's decision): it scores demographic
//     alignment only where BOTH a show value AND a structured target
//     exist, and otherwise returns a neutral 50 flagged `degraded` —
//     which feeds the §7 sparse→speculative band cap. It is written to
//     light up automatically when a structured target lands at
//     product_attributes.target_audience and show demographics get
//     enriched (Layer 3). Nothing is invented today.
//   - shows.audience_purchase_power is NULL/undefined for every runtime
//     show right now. Layer 2 reads it STRICTLY (Chris's decision): a
//     number is used as-is; NULL/undefined degrades to a neutral 50
//     flagged `degraded`, never zero-dragging the composite, never
//     throwing. Layer 3 fills the column from categories before scoring.
//
// Scales: sub-scores and composite are INT 0-100 (matching the
// conviction_scores columns). Band cuts are on the 0-100 scale (75/50).
// ============================================================

import type {
  Show,
  ShowDemographics,
  RingHypothesisRow,
  CampaignPatternRow,
  ConvictionBand,
  AovBucket,
} from "@/lib/data/types";
import { getEffectiveWeights, type ScoringWeights } from "./weights";

// ---- Tunable constants (first-pass; calibrate against real campaigns) ----

/** A dimension is "strong" at or above this (convergence guard, §7). */
export const STRONG_DIMENSION_THRESHOLD = 70;
/** Composite floor for the `high` band (§7). */
export const BAND_HIGH_COMPOSITE = 75;
/** Composite floor for the `medium` band (§7). */
export const BAND_MEDIUM_COMPOSITE = 50;
/** Neutral score a degraded (no-data) dimension contributes — never 0, so a
 *  missing dimension can't zero-drag the composite (the non-gating rule). */
export const NEUTRAL_DEGRADED_SCORE = 50;

/**
 * Base conviction weights fed to getEffectiveWeights. Non-zero
 * topicalRelevance + purchasePower opt INTO the 6-dimension path (the 4-dim
 * fast path skips the AOV tilt entirely — carry-forward #2). The legacy
 * delivery dimensions are zeroed: conviction is the three dims only, so they
 * are projected out and the survivors renormalized to sum 1.0.
 *
 * purchasePower base is a deliberately small 0.05 so that for low/mid-AOV
 * briefs (no tilt) the renormalized PP weight is ≈0; the high-AOV tilt inside
 * getEffectiveWeights raises it to 0.20 (renormalizes to ≈0.18).
 */
const CONVICTION_BASE: ScoringWeights = {
  audienceFit: 0.45,
  topicalRelevance: 0.45,
  purchasePower: 0.05,
  adEngagement: 0,
  sponsorRetention: 0,
  reach: 0,
};

// ---- Public types ----

export interface ConvictionWeights {
  audienceFit: number;
  topicalRelevance: number;
  purchasePower: number;
}

export interface ConvictionScore {
  /** 0-100 each. */
  audienceFit: number;
  topicalRelevance: number;
  purchasePower: number;
  composite: number;
  band: ConvictionBand;
  /** Renormalized 3-dim weights actually applied (transparency + tests). */
  weights: ConvictionWeights;
  /** Per-dimension diagnostics — feed Layer 4 reasoning and the band's
   *  sparse-data cap. `degraded` means the dimension had no real signal and
   *  fell back to the neutral score. */
  drivers: {
    audienceFit: { degraded: boolean; coverage: number };
    topicalRelevance: { degraded: boolean };
    purchasePower: { degraded: boolean; source: "column" | "absent" };
  };
}

// ============================================================
// Weight derivation
// ============================================================

/**
 * The three conviction-dimension weights for an AOV bucket, renormalized to
 * sum to 1.0. Calls getEffectiveWeights with aovBucket in the THIRD arg
 * (carry-forward #1 — passing it as the base lands it in the weights and the
 * tilt never fires) and projects the result onto the three conviction dims.
 *
 * Note: under high AOV, getEffectiveWeights also sets reach→0.05 as part of
 * the tilt. That value is intentionally inert here — reach is not a conviction
 * dimension, so it's projected out before renormalization. Only the
 * purchasePower→0.20 half of the tilt reaches the composite.
 */
export function convictionWeights(
  aovBucket?: AovBucket | null
): ConvictionWeights {
  const w = getEffectiveWeights(CONVICTION_BASE, undefined, {
    aovBucket: aovBucket ?? undefined,
  });
  const a = w.audienceFit;
  const t = w.topicalRelevance ?? 0;
  const p = w.purchasePower ?? 0;
  const total = a + t + p;
  if (total <= 0) {
    // Defensive: should never happen with CONVICTION_BASE, but never divide
    // by zero. Equal thirds.
    return { audienceFit: 1 / 3, topicalRelevance: 1 / 3, purchasePower: 1 / 3 };
  }
  return {
    audienceFit: a / total,
    topicalRelevance: t / total,
    purchasePower: p / total,
  };
}

// ============================================================
// Main entry
// ============================================================

export function scoreShowConviction(
  show: Show,
  ring: RingHypothesisRow,
  campaignPattern: CampaignPatternRow
): ConvictionScore {
  const audience = scoreAudienceFit(show, campaignPattern);
  const topical = scoreTopicalRelevance(show, ring, campaignPattern);
  const purchase = scorePurchasePower(show);

  const weights = convictionWeights(campaignPattern.aov_bucket);
  const composite = score100(
    weights.audienceFit * audience.score +
      weights.topicalRelevance * topical.score +
      weights.purchasePower * purchase.score
  );

  const degradedCount =
    (audience.degraded ? 1 : 0) +
    (topical.degraded ? 1 : 0) +
    (purchase.degraded ? 1 : 0);

  const band = deriveBand({
    composite,
    dims: [audience.score, topical.score, purchase.score],
    ringConfidence: ring.confidence,
    degradedCount,
  });

  return {
    audienceFit: audience.score,
    topicalRelevance: topical.score,
    purchasePower: purchase.score,
    composite,
    band,
    weights,
    drivers: {
      audienceFit: { degraded: audience.degraded, coverage: audience.coverage },
      topicalRelevance: { degraded: topical.degraded },
      purchasePower: { degraded: purchase.degraded, source: purchase.source },
    },
  };
}

// ============================================================
// Band logic (§7) — on the 0-100 scale
// ============================================================

function deriveBand(args: {
  composite: number;
  dims: number[];
  ringConfidence: ConvictionBand;
  degradedCount: number;
}): ConvictionBand {
  // A speculative source ring caps the band regardless of composite — the
  // brand has not confirmed this is a real ring.
  if (args.ringConfidence === "speculative") return "speculative";
  // Too sparse to genuinely score two of three dimensions.
  if (args.degradedCount >= 2) return "speculative";

  const strong = args.dims.filter(
    (d) => d >= STRONG_DIMENSION_THRESHOLD
  ).length;

  // Convergence guard: a single dominant dimension can't fake high conviction.
  if (args.composite >= BAND_HIGH_COMPOSITE && strong >= 2) return "high";
  if (args.composite >= BAND_MEDIUM_COMPOSITE) return "medium";
  // Matched the ring at all (non-gating: every scored show lands at least low).
  return "low";
}

// ============================================================
// Dimension: audience fit (honest degrade)
// ============================================================

interface TargetAudience {
  age_min?: number;
  age_max?: number;
  gender?: string;
}

interface AudienceResult {
  score: number;
  degraded: boolean;
  /** Fraction of attempted sub-signals (age, gender) that had data. */
  coverage: number;
}

function scoreAudienceFit(
  show: Show,
  pattern: CampaignPatternRow
): AudienceResult {
  const target = readTargetAudience(pattern);
  const demo = (show.demographics ?? {}) as ShowDemographics;

  const signals: number[] = [];

  // Age: needs a target range AND at least one show age bucket.
  const ageScore = scoreAge(demo, target);
  if (ageScore !== null) signals.push(ageScore);

  // Gender: needs a target gender AND a show male/female split.
  const genderScore = scoreGender(demo, target);
  if (genderScore !== null) signals.push(genderScore);

  if (signals.length === 0) {
    // No matchable demographic signal — neutral, flagged degraded so the band
    // cap can treat the dimension as unscored. (Launch-common case.)
    return { score: NEUTRAL_DEGRADED_SCORE, degraded: true, coverage: 0 };
  }

  const avg = signals.reduce((s, v) => s + v, 0) / signals.length;
  return {
    score: score100(avg),
    degraded: false,
    coverage: signals.length / 2,
  };
}

function readTargetAudience(pattern: CampaignPatternRow): TargetAudience | null {
  const attrs = pattern.product_attributes;
  if (!attrs || typeof attrs !== "object") return null;
  const raw = (attrs as Record<string, unknown>).target_audience;
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const t: TargetAudience = {};
  if (typeof obj.age_min === "number") t.age_min = obj.age_min;
  if (typeof obj.age_max === "number") t.age_max = obj.age_max;
  if (typeof obj.gender === "string") t.gender = obj.gender;
  if (t.age_min === undefined && t.age_max === undefined && !t.gender) {
    return null;
  }
  return t;
}

// Show age buckets → [min, max] ranges.
const AGE_BUCKETS: Array<{ key: keyof ShowDemographics; min: number; max: number }> = [
  { key: "age_18_24", min: 18, max: 24 },
  { key: "age_25_34", min: 25, max: 34 },
  { key: "age_35_44", min: 35, max: 44 },
  { key: "age_45_54", min: 45, max: 54 },
  { key: "age_55_plus", min: 55, max: 100 },
];

/** Returns 0-100, or null when age can't be scored (no target / no data). */
function scoreAge(demo: ShowDemographics, target: TargetAudience | null): number | null {
  if (!target || (target.age_min === undefined && target.age_max === undefined)) {
    return null;
  }
  const min = target.age_min ?? 0;
  const max = target.age_max ?? 200;

  let total = 0;
  let inTarget = 0;
  let hasAny = false;
  for (const bucket of AGE_BUCKETS) {
    const pct = demo[bucket.key];
    if (typeof pct !== "number") continue;
    hasAny = true;
    total += pct;
    const overlaps = bucket.max >= min && bucket.min <= max;
    if (overlaps) inTarget += pct;
  }
  if (!hasAny || total <= 0) return null;

  // Share of audience inside the target age range, normalized to the buckets
  // present (robust to whether the data is percentages or fractions).
  return score100((inTarget / total) * 100);
}

type GenderTarget = "men" | "women" | "mixed";

function normalizeGenderTarget(g: string): GenderTarget | null {
  const n = g.toLowerCase();
  // Check women/female FIRST — "women" contains "men", "female" contains "male".
  if (n.includes("women") || n.includes("female")) return "women";
  if (n.includes("men") || n.includes("male")) return "men";
  if (
    n.includes("mix") ||
    n.includes("no_pref") ||
    n.includes("no pref") ||
    n === "all" ||
    n === "balanced"
  ) {
    return "mixed";
  }
  return null;
}

/** Returns 0-100, or null when gender can't be scored. */
function scoreGender(demo: ShowDemographics, target: TargetAudience | null): number | null {
  if (!target || !target.gender) return null;
  const want = normalizeGenderTarget(target.gender);
  if (!want) return null;

  const male = typeof demo.male === "number" ? demo.male : undefined;
  const female = typeof demo.female === "number" ? demo.female : undefined;
  if (male === undefined && female === undefined) return null;

  const m = male ?? 0;
  const f = female ?? 0;
  const total = m + f;
  if (total <= 0) return null;

  if (want === "men") return score100((m / total) * 100);
  if (want === "women") return score100((f / total) * 100);
  // mixed: reward balance — 100 when even, lower the more skewed.
  return score100((1 - Math.abs(m - f) / total) * 100);
}

// ============================================================
// Dimension: topical relevance (deterministic lexical / category overlap)
//
// Podscan vector adjacency (lib/podscan/discover.ts) would sharpen this, but
// it is async I/O and cannot live in a pure function — it's a Layer-3
// precompute that can be folded in later. Layer 2 stays lexical-only.
// ============================================================

interface TopicalResult {
  score: number;
  degraded: boolean;
}

const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "of", "for", "to", "in", "on", "with",
  "is", "are", "this", "that", "who", "their", "they", "it", "as", "at",
  "by", "be", "from", "your", "you", "we", "our",
]);

function scoreTopicalRelevance(
  show: Show,
  ring: RingHypothesisRow,
  pattern: CampaignPatternRow
): TopicalResult {
  // Normalize BEFORE dedup so case/separator variants of the same category
  // (e.g. "Recovery" in categories and "recovery" in interests) collapse.
  const showCats = uniqueNonEmpty(
    [...(show.categories ?? []), ...(show.audience_interests ?? [])].map(
      normalizeText
    )
  );

  const attrs = (pattern.product_attributes ?? {}) as Record<string, unknown>;
  const productCategory = readStr(attrs.category);
  const keyAttributes = readStrArray(attrs.key_attributes);

  // Ring phrases for exact-ish matching; ring token set for overlap recall.
  const ringPhrases = uniqueNonEmpty([
    normalizeText(ring.label ?? ""),
    normalizeText(productCategory),
    ...keyAttributes.map(normalizeText),
  ]);
  const ringTokenSet = new Set(
    tokenize(
      [ring.label ?? "", ring.reasoning ?? "", productCategory, ...keyAttributes].join(" ")
    )
  );

  const hasShowSignal = showCats.length > 0;
  const hasRingSignal = ringPhrases.length > 0 || ringTokenSet.size > 0;
  if (!hasShowSignal || !hasRingSignal) {
    return { score: NEUTRAL_DEGRADED_SCORE, degraded: true };
  }

  // Direct match: a show category whose every token appears in the ring's
  // token set (e.g. show "recovery" inside ring "protocol-driven recovery").
  const direct = showCats.some((cat) => {
    const toks = tokenize(cat);
    return toks.length > 0 && toks.every((tok) => ringTokenSet.has(tok));
  });
  if (direct) return { score: 85, degraded: false };

  // Otherwise: recall of show category tokens present in the ring tokens.
  const showTokens = uniqueNonEmpty(showCats.flatMap(tokenize));
  if (showTokens.length === 0) {
    return { score: NEUTRAL_DEGRADED_SCORE, degraded: true };
  }
  const found = showTokens.filter((tok) => ringTokenSet.has(tok)).length;
  const recall = found / showTokens.length;
  return { score: score100(20 + 80 * recall), degraded: false };
}

// ============================================================
// Dimension: purchase power (strict column read)
// ============================================================

interface PurchaseResult {
  score: number;
  degraded: boolean;
  source: "column" | "absent";
}

function scorePurchasePower(show: Show): PurchaseResult {
  const v = show.audience_purchase_power;
  if (typeof v === "number" && Number.isFinite(v)) {
    return { score: score100(v), degraded: false, source: "column" };
  }
  // NULL/undefined → neutral, flagged degraded. Never zero-drag, never throw.
  return { score: NEUTRAL_DEGRADED_SCORE, degraded: true, source: "absent" };
}

// ============================================================
// Helpers
// ============================================================

function score100(n: number): number {
  return Math.round(Math.max(0, Math.min(100, n)));
}

function normalizeText(s: string): string {
  return s
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[\s_\-]+/g, " ")
    .trim();
}

function tokenize(s: string): string[] {
  return normalizeText(s)
    .split(/[^a-z0-9]+/)
    .filter((tok) => tok.length >= 3 && !STOPWORDS.has(tok));
}

function uniqueNonEmpty(items: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    const v = (item ?? "").trim();
    if (!v || seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}

function readStr(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function readStrArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}
