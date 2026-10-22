// ============================================================
// TIERED UNIVERSE READER (Wave 14 Phase 2C — Layer 3)
//
// Read-only loader the /campaigns/[id] page calls to render the dual-output
// discovery view (Layer 4). Reads the 2B conviction_scores (with the per-show
// tier + cost the tier pass persisted) and returns three partitions:
//   - test   — pricable and affordable at the 3-spot floor.
//   - scale  — pricable but over test budget; carries a budget delta (still
//              selectable — the delta is a warning, not an exclusion).
//   - bench  — tier 'dropped': un-pricable only (needs a quote at outreach).
//              NO conviction floor — composite is a sort key, never a cutoff.
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
  RingHypothesisRow,
  Show,
} from "@/lib/data/types";
import {
  getConvictionScoresWithShowsForPattern,
  getCampaignContextForPattern,
  getConfirmedRings,
  type ConvictionScoreWithShow,
  type CampaignContextForPattern,
} from "@/lib/data/reasoning-log";
import {
  classifyTier,
  filterToConfirmedRings,
  rollupShowComposite,
  THREE_SPOT_THRESHOLD,
  MIN_TEST_SHOWS,
  type ShowRollup,
} from "./tier-portfolio";
import {
  deriveSpotCost,
  dollarsToCents,
  normalizeSpotCount,
  type Placement,
} from "./spot-cost";
import { applyPostAirLift } from "@/lib/scoring/post-air-lift";
import { applyImportLift } from "@/lib/scoring/import-lift";
import type { ImportBrandSignal } from "@/lib/scoring/import-lift";
import {
  loadCampaignBrandUserId,
  loadPostAirConversionsByShow,
} from "@/lib/learning/post-air-outcomes";
import { loadImportSignalsByShow } from "@/lib/learning/past-imports";
import {
  loadPooledPriors,
  priorMapKey,
  toPoolPlacement,
  toPoolPriceType,
  type PooledPrior,
  type PooledPriorKey,
} from "@/lib/learning/pooled-priors";

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
  /** The effective placement this show is priced/handed off at (Layer 5):
   *  per-show override ?? campaign default ?? 'midroll'. Discovery vocabulary —
   *  the media-plan handoff maps it to the Wave 7 'pre-roll'/… form. */
  placement: Placement;
  /** Scale rows only: 3-spot cost minus the per-show affordability ceiling
   *  (THREE_SPOT_THRESHOLD × test budget), integer cents. null for test/bench. */
  budgetDeltaCents: number | null;
  brandSaved: boolean;
  brandDismissed: boolean;
  /** True when tier+cost were derived on read (persisted tier was null). */
  computedOnRead: boolean;
  /**
   * Post-air lift. The original composite stays on `composite`. `postAirAdjusted`
   * is the sort key when a brand reported conversions for this catalog show.
   * A missing report leaves the score unchanged. The lift never drops a show.
   */
  postAirDelta?: number;
  postAirAdjusted?: number | null;
  postAirReasoning?: string | null;
  /**
   * Import lift, applied after the post-air lift. Omitted when this brand
   * has no converting import on the show and no pooled prior matches.
   * composite and tier stay as scored.
   */
  importDelta?: number;
  importAdjusted?: number | null;
  importReasoning?: string | null;
}

export interface TieredUniverse {
  test: TieredShow[];
  scale: TieredShow[];
  /** tier 'dropped' — un-pricable only (needs_quote). No conviction floor. */
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
  /** Layer 3.5: confirmed rings (getConfirmedRings) — the same source of truth
   *  getConvictionUniverse uses to drop rejected-ring rows before rollup, so a
   *  rejected show can't leak into the tiered output / test cart. */
  loadConfirmedRings: (
    campaignPatternId: string
  ) => Promise<RingHypothesisRow[]>;
  loadCampaignCtx: (
    campaignPatternId: string
  ) => Promise<CampaignContextForPattern | null>;
  /**
   * This brand's reported conversions, keyed by catalog show id.
   * The second argument is campaigns.user_id for the brand who is
   * looking. Omitted → no lift (tests). The default loader is fail-soft
   * and does not read another brand's reports.
   */
  loadPostAirByShow?: (
    showIds: string[],
    brandUserId: string
  ) => Promise<Map<string, number>>;
  /**
   * Owner of the campaign being viewed (campaigns.user_id). Omitted
   * together with the loader → no lift. The default reads that column.
   */
  loadBrandUserId?: (campaignId: string) => Promise<string | null>;
  /**
   * This brand's confirmed import totals, keyed by catalog show id.
   * Omitted or empty leaves scores unchanged. The default loader is
   * fail-soft and filters brand_id to the brand who is looking.
   */
  loadImportSignalsByShow?: (
    showIds: string[],
    brandUserId: string
  ) => Promise<Map<string, ImportBrandSignal>>;
  /**
   * Anonymized pooled priors for these (category, placement, price type)
   * keys. Omitted or empty leaves scores unchanged. The default reads
   * pooled_import_priors as service_role and is fail-soft.
   */
  loadPooledPriors?: (keys: PooledPriorKey[]) => Promise<Map<string, PooledPrior>>;
}

export const defaultDeps: TieredUniverseDeps = {
  loadScoresWithShows: getConvictionScoresWithShowsForPattern,
  loadConfirmedRings: getConfirmedRings,
  loadCampaignCtx: getCampaignContextForPattern,
  loadPostAirByShow: loadPostAirConversionsByShow,
  loadBrandUserId: loadCampaignBrandUserId,
  loadImportSignalsByShow: loadImportSignalsByShow,
  loadPooledPriors: loadPooledPriors,
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
  options: { placement?: Placement; spotCount?: number } = {}
): Promise<TieredUniverse> {
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
  // Effective campaign-level overrides (Layer 5). Source of truth is the
  // persisted campaign config (ctx); an explicit option wins for callers that
  // force one. These drive compute-on-read AND the effective per-show placement
  // surfaced for the media-plan handoff.
  const campaignPlacement: Placement =
    options.placement ?? ctx?.testPlacement ?? "midroll";
  const spotCount = normalizeSpotCount(
    options.spotCount ?? ctx?.testSpotCount ?? undefined
  );
  // FLOOR, not round: classifyTier compares threeSpotCents against the RAW
  // (unrounded) threshold × budget, so a scale row has threeSpotCents > that
  // raw ceiling. Flooring keeps budgetDeltaCents an integer AND guarantees a
  // genuine scale row never displays a misleading 0/under-by-1-cent delta
  // (rounding up could make the displayed ceiling ≥ a scale row's cost).
  const ceilingCents = Math.floor(THREE_SPOT_THRESHOLD * testBudgetCents);

  // Layer 3.5: drop rows for rings the brand did not keep BEFORE rollup, so a
  // ring rejected without re-running discovery can't leak its shows into the
  // tiered output / test cart. Same confirmed-ring source of truth as
  // getConvictionUniverse (getConfirmedRings). Guarded → empty set on failure.
  let confirmedRingIds = new Set<string>();
  try {
    const confirmedRings = await deps.loadConfirmedRings(campaignPatternId);
    confirmedRingIds = new Set(confirmedRings.map((r) => r.id));
  } catch {
    confirmedRingIds = new Set<string>();
  }
  const confirmedRows = filterToConfirmedRings(rows, confirmedRingIds);

  // First non-null embedded show per show id (all of a show's ring rows embed
  // the same show; guard the rare null).
  const showById = new Map<string, Show | null>();
  for (const row of confirmedRows) {
    if (!row.show_id) continue;
    if (!showById.has(row.show_id) || (showById.get(row.show_id) == null && row.show)) {
      showById.set(row.show_id, row.show ?? null);
    }
  }

  // Post-air lift and the brand's own import signal are sort guides for
  // this brand only. Another brand's rows are not loaded. A missing brand
  // id or a loader failure leaves every score as it was scored. Shows are
  // not filtered on the result. The pooled prior is separate: it has no
  // brand id, and an empty pool adds nothing.
  let reportedByShow = new Map<string, number>();
  let importByShow = new Map<string, ImportBrandSignal>();
  const showIds = [...showById.keys()];
  const wantsBrand =
    !!ctx?.campaignId &&
    !!deps.loadBrandUserId &&
    (!!deps.loadPostAirByShow || !!deps.loadImportSignalsByShow);
  let brandUserId: string | null = null;
  if (wantsBrand && deps.loadBrandUserId && ctx?.campaignId) {
    try {
      brandUserId = (await deps.loadBrandUserId(ctx.campaignId))?.trim() || null;
    } catch {
      brandUserId = null;
    }
  }
  if (brandUserId && deps.loadPostAirByShow) {
    try {
      reportedByShow = await deps.loadPostAirByShow(showIds, brandUserId);
    } catch {
      reportedByShow = new Map();
    }
  }
  if (brandUserId && deps.loadImportSignalsByShow) {
    try {
      importByShow = await deps.loadImportSignalsByShow(showIds, brandUserId);
    } catch {
      importByShow = new Map();
    }
  }

  // Collapse per-(show, ring) → one entry per show at its highest composite.
  const rollup = rollupShowComposite(confirmedRows);

  let pooledByKey = new Map<string, PooledPrior>();
  if (deps.loadPooledPriors) {
    const keys = pooledKeysFor(rollup, showById, campaignPlacement);
    if (keys.length > 0) {
      try {
        pooledByKey = await deps.loadPooledPriors(keys);
      } catch {
        pooledByKey = new Map();
      }
    }
  }

  const test: TieredShow[] = [];
  const scale: TieredShow[] = [];
  const bench: TieredShow[] = [];

  for (const [showId, roll] of rollup) {
    const top = roll.topRow as ConvictionScoreWithShow;
    const show = showById.get(showId) ?? null;

    // Effective placement for this show (Layer 5): per-show override beats the
    // campaign default. Surfaced on the entry so the media-plan handoff carries
    // it, AND used by compute-on-read below.
    const effPlacement: Placement = top.placement_override ?? campaignPlacement;

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
      // + classify from the embedded Show with the same pure Layer 1/2 logic,
      // honoring the Layer 5 overrides (effective placement, campaign spot count,
      // per-show CPM) so the fallback agrees with what the recompute persists.
      const cost = show
        ? deriveSpotCost(show, {
            placement: effPlacement,
            spotCount,
            cpmOverrideCents: top.cpm_override_cents,
          })
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

    const reported = reportedByShow.get(showId) ?? null;
    const lift = applyPostAirLift(roll.composite, reported);
    const imported = applyImportLift(
      lift.adjusted,
      importByShow.get(showId) ?? null,
      matchPooledPrior(show, effPlacement, pooledByKey)
    );

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
      placement: effPlacement,
      budgetDeltaCents,
      brandSaved: top.brand_saved ?? false,
      brandDismissed: top.brand_dismissed ?? false,
      computedOnRead,
      postAirDelta: lift.delta,
      postAirAdjusted: lift.adjusted,
      postAirReasoning: lift.reasoningLine,
    };
    if (imported.delta > 0 || imported.reasoningLine) {
      entry.importDelta = imported.delta;
      entry.importAdjusted = imported.adjusted;
      entry.importReasoning = imported.reasoningLine;
    }

    if (tier === "test") test.push(entry);
    else if (tier === "scale") scale.push(entry);
    else bench.push(entry);
  }

  // Lifted score guides the order. A show with no report keeps its
  // composite and stays in the list.
  const byCompositeDesc = (a: TieredShow, b: TieredShow) =>
    (b.importAdjusted ?? b.postAirAdjusted ?? b.composite ?? -1) -
    (a.importAdjusted ?? a.postAirAdjusted ?? a.composite ?? -1);
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

function pooledKeysFor(
  rollup: Map<string, ShowRollup>,
  showById: Map<string, Show | null>,
  campaignPlacement: Placement
): PooledPriorKey[] {
  const keys: PooledPriorKey[] = [];
  const seen = new Set<string>();
  for (const [showId, roll] of rollup) {
    const show = showById.get(showId) ?? null;
    const placement = toPoolPlacement(roll.topRow.placement_override ?? campaignPlacement);
    const priceType = toPoolPriceType(show?.price_type);
    for (const category of show?.categories ?? []) {
      const trimmed = category.trim();
      if (!trimmed) continue;
      const mapKey = priorMapKey(trimmed, placement, priceType);
      if (seen.has(mapKey)) continue;
      seen.add(mapKey);
      keys.push({ category: trimmed, placement, priceType });
    }
  }
  return keys;
}

function matchPooledPrior(
  show: Show | null,
  placement: Placement,
  priors: Map<string, PooledPrior>
): PooledPrior | null {
  if (!show || priors.size === 0) return null;
  const poolPlacement = toPoolPlacement(placement);
  const priceType = toPoolPriceType(show.price_type);
  let best: PooledPrior | null = null;
  for (const category of show.categories ?? []) {
    const trimmed = category.trim();
    if (!trimmed) continue;
    const prior = priors.get(priorMapKey(trimmed, poolPlacement, priceType));
    if (!prior) continue;
    const median = prior.medianConversionsPer1kDownloads ?? Number.NEGATIVE_INFINITY;
    const bestMedian = best?.medianConversionsPer1kDownloads ?? Number.NEGATIVE_INFINITY;
    if (!best || median > bestMedian) best = prior;
  }
  return best;
}
