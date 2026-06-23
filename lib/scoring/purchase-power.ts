// ============================================================
// PURCHASE-POWER CATEGORY PROXY (Wave 14 Phase 2B — Layer 1)
//
// "Can this audience afford the AOV?" — answered bluntly from show
// category, a crude proxy for audience affluence. This is ONE of three
// non-gating conviction dimensions (audience fit, topical relevance,
// purchase power); being wrong on a show lowers one sub-score, never
// vetoes the show. Imperfection is survivable and gets red-penned /
// calibrated against real campaigns over time.
//
// Pure + deterministic. No I/O, no LLM, never throws. Unknown/missing
// category degrades to `medium` (neutral), never an error.
//
// Tier → int anchors are LOCKED (Chris, 2B pre-flight):
//   high → 80, medium → 50, low → 25.
// `25` (not 20) for low keeps the floor off the ground so a low-purchase-
// power show with strong audience + topical still composites into a ring
// (the non-gating guarantee).
// ============================================================

import type { PurchasePowerTier } from "@/lib/data/types";

// Anchors. Exported so Layer 2 / calibration can reference them by name
// rather than re-hardcoding the numbers.
export const PURCHASE_POWER_SCORE: Record<PurchasePowerTier, number> = {
  high: 80,
  medium: 50,
  low: 25,
};

const TIER_RANK: Record<PurchasePowerTier, number> = {
  low: 0,
  medium: 1,
  high: 2,
};

// ---- Category → tier mapping (first-pass; §6 of the 2B spec) ----
//
// Keys are NORMALIZED (see normalizeCategory): lowercase, "&" → "and",
// whitespace/underscore/hyphen collapsed to single spaces. Add real-world
// variants liberally — the source taxonomy (Podscan / seed) is inconsistent
// ("Health & Medicine", "Fitness", "Beauty", "Society & Culture", ...).
//
// Decision B (locked): a BARE "Health & Fitness" → medium. §6 reserves high
// for *biohacking/optimization-leaning* Health & Fitness, which is not
// distinguishable from a plain category string — so generic health / fitness
// / wellness / beauty / medicine sit at medium, and high is reserved for
// unambiguous affluence signals.
//
// Deliberate divergence from §6 (Chris + Codex, 2B build): "Marketing" is
// mapped MEDIUM, not high. §6's first-pass list put it in high, but marketing
// podcast audiences skew small-business / indie operators — a mixed-income
// signal, not an affluence one. Intentional, not a typo.

const HIGH_CATEGORIES = [
  "business",
  "investing",
  "investment",
  "personal finance",
  "finance",
  "financial",
  "entrepreneurship",
  "entrepreneur",
  "technology",
  "tech",
  "real estate",
  "management",
  "careers",
  "career",
  "golf",
  "wine",
  "luxury",
  "premium lifestyle",
];

const MEDIUM_CATEGORIES = [
  "health and wellness",
  "health and fitness", // Decision B: bare H&F is medium, not high
  "health and medicine",
  "health",
  "wellness",
  "fitness",
  "beauty",
  "education",
  "science",
  "society and culture",
  "culture",
  "sports",
  "sport",
  "news",
  "arts",
  "art",
  "food",
  "cooking",
  "parenting",
  "relationships",
  "history",
  "comedy",
  "true crime",
  "documentary",
  "self improvement",
  "marketing", // §6 listed Marketing as high; mapped medium here (see note above)
];

// NOTE: sleep / meditation / asmr are mapped low here, but Layer 3 EXCLUDES
// them from results entirely (hard genre filter, before scoring). Mapping
// them at all is harmless — they never reach the scorer.
const LOW_CATEGORIES = [
  "kids and family",
  "kids",
  "family",
  "religion",
  "religion and spirituality",
  "spirituality",
  "music",
  "fiction",
  "drama",
  "entertainment",
  "tv and film",
  "leisure",
  "sleep",
  "meditation",
  "asmr",
];

function buildTierMap(): Map<string, PurchasePowerTier> {
  const m = new Map<string, PurchasePowerTier>();
  for (const c of LOW_CATEGORIES) m.set(c, "low");
  for (const c of MEDIUM_CATEGORIES) m.set(c, "medium");
  for (const c of HIGH_CATEGORIES) m.set(c, "high");
  return m;
}

const TIER_MAP = buildTierMap();

function normalizeCategory(category: string): string {
  return category
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[\s_\-]+/g, " ")
    .trim();
}

/**
 * Internal: classify a single category, returning `null` when the category
 * is empty or unrecognized (i.e. "no signal"). The public primitive below
 * degrades null → medium; the array collapse treats null as no-signal so an
 * unknown tag cannot raise a show's floor.
 */
function classifyCategory(category: string | null | undefined): PurchasePowerTier | null {
  if (!category) return null;
  const key = normalizeCategory(category);
  if (!key) return null;
  return TIER_MAP.get(key) ?? null;
}

/**
 * Per-category primitive (2B spec signature). Deterministic. Unknown,
 * empty, null, or undefined category → `medium` (neutral default). Never
 * throws.
 */
export function categoryToPurchasePower(
  category: string | null | undefined
): PurchasePowerTier {
  return classifyCategory(category) ?? "medium";
}

/** Map a tier to its locked 0-100 anchor. */
export function tierToPurchasePowerScore(tier: PurchasePowerTier): number {
  return PURCHASE_POWER_SCORE[tier];
}

/**
 * Collapse a show's category array to a single 0-100 purchase-power int.
 *
 * Decision A (locked): MAX tier across the KNOWN categories — the presence
 * of an affluent-skewing category implies a real affluent segment, and over-
 * inflation on one non-gating dimension is survivable. Unknown / empty
 * categories contribute NO signal (they are skipped, not counted as medium),
 * so an unrecognized tag cannot lift a genuinely-low show. When a show has no
 * recognizable categories at all, default to medium.
 */
export function categoriesToPurchasePowerScore(
  categories: string[] | null | undefined
): number {
  const known: PurchasePowerTier[] = [];
  for (const c of categories ?? []) {
    const tier = classifyCategory(c);
    if (tier) known.push(tier);
  }
  if (known.length === 0) return tierToPurchasePowerScore("medium");
  const best = known.reduce((a, b) => (TIER_RANK[b] > TIER_RANK[a] ? b : a));
  return tierToPurchasePowerScore(best);
}

// ---- Backfill planner (pure, testable without a live DB) ----

export interface ShowBackfillRow {
  id: string;
  categories: string[] | null;
  audience_purchase_power: number | null;
}

export interface PurchasePowerBackfillUpdate {
  id: string;
  audience_purchase_power: number;
}

export interface BackfillOptions {
  /**
   * When false (default): only NULL `audience_purchase_power` rows are
   * planned — the proxy never clobbers an existing value (manual override or
   * a prior proxy run), which makes the backfill idempotent and override-safe.
   * When true: recompute every row, but skip no-op writes (value unchanged).
   */
  recompute?: boolean;
}

/**
 * Decide which shows the backfill should write, and to what value. Pure: the
 * runner script (scripts/backfill-purchase-power.ts) feeds it rows read from
 * the DB and applies the returned updates.
 */
export function planPurchasePowerBackfill(
  rows: ShowBackfillRow[],
  opts: BackfillOptions = {}
): PurchasePowerBackfillUpdate[] {
  const recompute = opts.recompute ?? false;
  const updates: PurchasePowerBackfillUpdate[] = [];
  for (const row of rows) {
    const hasValue =
      row.audience_purchase_power !== null &&
      row.audience_purchase_power !== undefined;
    // Default path: never touch a row that already has a value.
    if (hasValue && !recompute) continue;
    const score = categoriesToPurchasePowerScore(row.categories);
    // Even in recompute mode, skip writes that would change nothing.
    if (hasValue && row.audience_purchase_power === score) continue;
    updates.push({ id: row.id, audience_purchase_power: score });
  }
  return updates;
}
