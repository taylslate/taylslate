// ============================================================
// TIERED UNIVERSE READER (Wave 14 Phase 2C — Layer 3)
//
// Read-only loader the /campaigns/[id] page calls to render the dual-output
// discovery view (Layer 4). Reads the 2B conviction_scores (with the per-show
// tier + cost the tier pass persisted) and returns three partitions:
//   - test   — affordable at the 3-spot floor, conviction ≥ medium.
//   - scale  — wanted but over test budget; carries a budget delta.
//   - bench  — tier 'dropped' (below the medium floor, or no derivable cost).
//
// READ, do not regenerate: reasoning prose comes straight off the persisted
// conviction_scores row (2B / Layer 4 wrote it) — no LLM in this path.
//
// Compute-on-read fallback: a row whose tier is null (the tier pass failed soft,
// or pre-028 data) is classified on the fly from the embedded Show via the same
// pure Layer 1/2 functions, so the view always has a usable split. Fail-soft end
// to end — never throws; an empty universe is the honest "not scored yet" state.
//
// Lives in lib/discovery (not lib/data) because it depends on the pure cost +
// classifier functions; tier-portfolio already imports the DB readers FROM
// lib/data, so keeping this here avoids an import cycle.
// ============================================================

import type {
  ConvictionBand,
  ConvictionTier,
  CostBasis,
  Show,
} from "@/lib/data/types";
import {
  getConvictionScoresWithShowsForPattern,
  getCampaignContextForPattern,
  type ConvictionScoreWithShow,
  type CampaignContextForPattern,
} from "@/lib/data/reasoning-log";
import {
  classifyTier,
  rollupShowComposite,
  THREE_SPOT_THRESHOLD,
  MIN_TEST_SHOWS,
} from "./tier-portfolio";
import { deriveSpotCost, dollarsToCents, type Placement } from "./spot-cost";

/** One show in a tier partition: the 2B conviction read + the per-show cost
 *  (persisted, or computed on read) the Layer 4 card renders. */
export interface TieredShow {
  showId: string;
  show: Show | null;
  /** The top (highest-composite) row's ring — Layer 4 uses it as a sub-label. */
  ringHypothesisId: string | null;
  band: ConvictionBand | null;
  audienceFit: number | null;
  topicalRelevance: number | null;
  purchasePower: number | null;
  composite: number | null;
  /** Persisted 2B prose — READ only, never regenerated here. */
  reasoning: string | null;
  tier: ConvictionTier;
  perSpotCents: number | null;
  threeSpotCents: number | null;
  cpmUsedCents: number | null;
  costBasis: CostBasis | null;
  isEstimate: boolean;
  needsQuote: boolean;
  /** Scale rows only: 3-spot cost minus the per-show affordability ceiling
   *  (THREE_SPOT_THRESHOLD × test budget), integer cents. null for test/bench. */
  budgetDeltaCents: number | null;
  brandSaved: boolean;
  brandDismissed: boolean;
  /** True when tier+cost were derived on read (persisted tier was null). */
  computedOnRead: boolean;
}

export interface TieredUniverse {
  test: TieredShow[];
  scale: TieredShow[];
  /** tier 'dropped' — below the medium floor or un-pricable (needs_quote). */
  bench: TieredShow[];
  /** Campaign budget in integer cents (the single dollars→cents boundary). */
  testBudgetCents: number;
  /** test.length < MIN_TEST_SHOWS — Layer 4 surfaces the tight-budget copy. */
  testUnderfilled: boolean;
  hasScores: boolean;
}

export interface TieredUniverseDeps {
  loadScoresWithShows: (
    campaignPatternId: string
  ) => Promise<ConvictionScoreWithShow[]>;
  loadCampaignCtx: (
    campaignPatternId: string
  ) => Promise<CampaignContextForPattern | null>;
}

const defaultDeps: TieredUniverseDeps = {
  loadScoresWithShows: getConvictionScoresWithShowsForPattern,
  loadCampaignCtx: getCampaignContextForPattern,
};

function emptyUniverse(): TieredUniverse {
  return {
    test: [],
    scale: [],
    bench: [],
    testBudgetCents: 0,
    testUnderfilled: true,
    hasScores: false,
  };
}

/**
 * Assemble the tiered, cost-annotated universe for a campaign pattern. Pure
 * read + deterministic derivation; fail-soft (any failure → empty universe).
 */
export async function getTieredUniverse(
  campaignPatternId: string,
  deps: TieredUniverseDeps = defaultDeps,
  options: { placement?: Placement } = {}
): Promise<TieredUniverse> {
  const placement: Placement = options.placement ?? "midroll";

  let rows: ConvictionScoreWithShow[] = [];
  try {
    rows = await deps.loadScoresWithShows(campaignPatternId);
  } catch {
    return emptyUniverse();
  }
  if (rows.length === 0) return emptyUniverse();

  let ctx: CampaignContextForPattern | null = null;
  try {
    ctx = await deps.loadCampaignCtx(campaignPatternId);
  } catch {
    ctx = null;
  }
  const testBudgetCents = dollarsToCents(ctx?.budgetTotalDollars ?? 0);
  // FLOOR, not round: classifyTier compares threeSpotCents against the RAW
  // (unrounded) threshold × budget, so a scale row has threeSpotCents > that
  // raw ceiling. Flooring keeps budgetDeltaCents an integer AND guarantees a
  // genuine scale row never displays a misleading 0/under-by-1-cent delta
  // (rounding up could make the displayed ceiling ≥ a scale row's cost).
  const ceilingCents = Math.floor(THREE_SPOT_THRESHOLD * testBudgetCents);

  // First non-null embedded show per show id (all of a show's ring rows embed
  // the same show; guard the rare null).
  const showById = new Map<string, Show | null>();
  for (const row of rows) {
    if (!row.show_id) continue;
    if (!showById.has(row.show_id) || (showById.get(row.show_id) == null && row.show)) {
      showById.set(row.show_id, row.show ?? null);
    }
  }

  // Collapse per-(show, ring) → one entry per show at its highest composite.
  const rollup = rollupShowComposite(rows);

  const test: TieredShow[] = [];
  const scale: TieredShow[] = [];
  const bench: TieredShow[] = [];

  for (const [showId, roll] of rollup) {
    const top = roll.topRow as ConvictionScoreWithShow;
    const show = showById.get(showId) ?? null;

    let tier: ConvictionTier;
    let perSpotCents: number | null;
    let threeSpotCents: number | null;
    let cpmUsedCents: number | null;
    let costBasis: CostBasis | null;
    let isEstimate: boolean;
    let needsQuote: boolean;
    let computedOnRead: boolean;

    if (top.tier != null) {
      // Persisted by the tier pass — trust it, surface it.
      tier = top.tier;
      perSpotCents = top.per_spot_cents ?? null;
      threeSpotCents = top.three_spot_cents ?? null;
      cpmUsedCents = top.cpm_used_cents ?? null;
      costBasis = top.cost_basis ?? null;
      isEstimate = top.cost_is_estimate ?? false;
      needsQuote = top.needs_quote ?? false;
      computedOnRead = false;
    } else {
      // Compute-on-read: persistence failed soft (or pre-028 row). Derive cost
      // + classify from the embedded Show with the same pure Layer 1/2 logic.
      const cost = show
        ? deriveSpotCost(show, undefined, placement)
        : {
            perSpotCents: null,
            threeSpotCents: null,
            cpmUsedCents: null,
            costBasis: null,
            isEstimate: false,
            needsQuote: true,
          };
      tier = classifyTier({
        compositeScore: roll.composite,
        threeSpotCents: cost.threeSpotCents,
        costBasis: cost.costBasis,
        needsQuote: cost.needsQuote,
        testBudgetCents,
      });
      perSpotCents = cost.perSpotCents;
      threeSpotCents = cost.threeSpotCents;
      cpmUsedCents = cost.cpmUsedCents;
      costBasis = cost.costBasis;
      isEstimate = cost.isEstimate;
      needsQuote = cost.needsQuote;
      computedOnRead = true;
    }

    const budgetDeltaCents =
      tier === "scale" && threeSpotCents != null
        ? threeSpotCents - ceilingCents
        : null;

    const entry: TieredShow = {
      showId,
      show,
      ringHypothesisId: top.ring_hypothesis_id,
      band: top.conviction_band,
      audienceFit: top.audience_fit_score,
      topicalRelevance: top.topical_relevance_score,
      purchasePower: top.purchase_power_score,
      composite: roll.composite,
      reasoning: top.reasoning,
      tier,
      perSpotCents,
      threeSpotCents,
      cpmUsedCents,
      costBasis,
      isEstimate,
      needsQuote,
      budgetDeltaCents,
      brandSaved: top.brand_saved ?? false,
      brandDismissed: top.brand_dismissed ?? false,
      computedOnRead,
    };

    if (tier === "test") test.push(entry);
    else if (tier === "scale") scale.push(entry);
    else bench.push(entry);
  }

  const byCompositeDesc = (a: TieredShow, b: TieredShow) =>
    (b.composite ?? -1) - (a.composite ?? -1);
  test.sort(byCompositeDesc);
  scale.sort(byCompositeDesc);
  bench.sort(byCompositeDesc);

  return {
    test,
    scale,
    bench,
    testBudgetCents,
    testUnderfilled: test.length < MIN_TEST_SHOWS,
    hasScores: true,
  };
}
