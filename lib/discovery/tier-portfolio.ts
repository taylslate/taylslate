// ============================================================
// TIER CLASSIFIER + PORTFOLIO PASS (Wave 14 Phase 2C — Layer 2)
//
// Deterministic. No LLM. Splits the 2B conviction-scored universe into
// three tiers and persists the result onto conviction_scores:
//   - test    — affordable at the 3-spot test cadence, conviction ≥ medium.
//   - scale   — wanted (conviction ≥ medium) but too expensive for this test.
//   - dropped — bench: below the medium floor, or no derivable cost.
//
// TWO GATES, in order (classifyTier):
//   1. needsQuote → dropped (no cost → can't price, can't gate).
//   2. composite < MEDIUM_FLOOR → dropped.
//   Then cost-CONFIDENCE decides whether cost is allowed to split test/scale:
//     - rate_card / derived  → gate-worthy: affordability decides test vs scale.
//     - flat_fee             → NOT gate-worthy: conviction-only (always test if
//                              it cleared the floor); never scale on cost — the
//                              non-onboarded-YouTube number is a wild guess.
//
// Scale is gated on AFFORDABILITY + COMPOSITE, NOT the conviction band
// (pre-flight Flag 7: audience-fit is pinned neutral at launch, so the `high`
// band is structurally unreachable — a band gate would render scale empty).
//
// UNITS: every cost is integer cents (Layer 1). The campaign budget is DECIMAL
// dollars; it is converted through the SAME dollarsToCents boundary Layer 1
// uses (one money path — pre-flight Flag 7).
// ============================================================

import type {
  ConvictionScoreRow,
  ConvictionTier,
  CostBasis,
  Show,
} from "@/lib/data/types";
import {
  deriveSpotCost,
  dollarsToCents,
  type Placement,
  type SpotCost,
} from "./spot-cost";
import { BAND_MEDIUM_COMPOSITE } from "@/lib/scoring/conviction";
import {
  getCampaignContextForPattern,
  getConvictionScoresForPattern,
  updateConvictionTierCost,
  type CampaignContextForPattern,
  type UpdateConvictionTierCostInput,
} from "@/lib/data/reasoning-log";
import { getShowsByIds } from "@/lib/data/queries";
import { logEvent, type LogEventInput } from "@/lib/data/events";

// ---- Tunable constants (first-pass; see SCORING_CALIBRATION.md) ----

/**
 * Composite cutoff for test/scale eligibility. REUSES 2B's medium band floor
 * (BAND_MEDIUM_COMPOSITE = 50) — one source of truth, no divergent constant.
 * Below it → bench. Tier eligibility is composite-based, never band-based
 * (Flag 7), so this tracks the medium floor automatically as the scorer evolves.
 */
export const MEDIUM_FLOOR = BAND_MEDIUM_COMPOSITE;

/** 3-spot cost ≤ 25% of test budget → affordable (the 3-spot test floor). */
export const THREE_SPOT_THRESHOLD = 0.25;

/** Below this many test shows → flag test_underfilled (tight-budget UX). */
export const MIN_TEST_SHOWS = 3;

// ---- Pure classifier ----

export interface ClassifyTierInput {
  /** Show-level rolled-up highest composite across the show's rings (0-100). */
  compositeScore: number | null;
  /** The N-spot cost from Layer 1, integer cents (cadence already applied). */
  threeSpotCents: number | null;
  costBasis: CostBasis | null;
  needsQuote: boolean;
  /** Campaign budget already converted to integer cents. */
  testBudgetCents: number;
  /** Affordability fraction; defaults to THREE_SPOT_THRESHOLD. */
  threshold?: number;
}

/**
 * Classify one show into test / scale / dropped. Pure, total, deterministic —
 * never throws. `cadence` is intentionally absent: the cost arg already encodes
 * the spot count (Layer 1 derived it), so a cadence param would double-count.
 * Layer 5's spot-count override changes the cost passed in, not this signature.
 */
export function classifyTier(input: ClassifyTierInput): ConvictionTier {
  const threshold = input.threshold ?? THREE_SPOT_THRESHOLD;

  // Gate 1 — no derivable cost: can't price, can't affordability-gate → bench.
  if (input.needsQuote) return "dropped";

  // Gate 2 — composite floor. Below medium → bench, regardless of cost.
  if (input.compositeScore == null || input.compositeScore < MEDIUM_FLOOR) {
    return "dropped";
  }

  // flat_fee (non-onboarded YouTube): the number is a guess, so cost is NOT
  // allowed to decide the split. Conviction-only → test. Never scale on cost.
  if (input.costBasis === "flat_fee") return "test";

  // rate_card / derived: gate-worthy cost. Affordability decides test vs scale.
  if (input.costBasis === "rate_card" || input.costBasis === "derived") {
    if (input.threeSpotCents == null || !Number.isFinite(input.threeSpotCents)) {
      // Gate-worthy basis with no usable cost is unreachable from Layer 1 (a
      // non-null basis implies a non-null cost). Conservative bench.
      return "dropped";
    }
    const ceilingCents = threshold * input.testBudgetCents;
    return input.threeSpotCents <= ceilingCents ? "test" : "scale";
  }

  // Null/unknown basis without needsQuote — unreachable from Layer 1. Bench.
  return "dropped";
}

// ---- Show-level rollup (mandatory: table is per-(show, ring)) ----

export interface ShowRollup {
  showId: string;
  /** The highest-composite conviction_scores row for this show. */
  topRow: ConvictionScoreRow;
  /** That row's composite (null if every ring row was null). */
  composite: number | null;
}

/**
 * Collapse per-(show, ring) rows to one entry per show, keeping the row with
 * the HIGHEST composite (null composites lose to any real score). Pure. The
 * winning row carries the band/reasoning Layer 3/4 surfaces alongside the tier.
 */
export function rollupShowComposite(
  rows: ConvictionScoreRow[]
): Map<string, ShowRollup> {
  const byShow = new Map<string, ShowRollup>();
  for (const row of rows) {
    if (!row.show_id) continue;
    const existing = byShow.get(row.show_id);
    if (!existing || (row.composite_score ?? -1) > (existing.composite ?? -1)) {
      byShow.set(row.show_id, {
        showId: row.show_id,
        topRow: row,
        composite: row.composite_score,
      });
    }
  }
  return byShow;
}

// ---- Campaign-level pass (standalone, fail-soft, dep-injected) ----

export interface TierPortfolioDeps {
  loadScores: (campaignPatternId: string) => Promise<ConvictionScoreRow[]>;
  loadCampaignCtx: (
    campaignPatternId: string
  ) => Promise<CampaignContextForPattern | null>;
  loadShowsByIds: (ids: string[]) => Promise<Map<string, Show>>;
  persist: (input: UpdateConvictionTierCostInput) => Promise<boolean>;
  emit: (input: LogEventInput) => Promise<unknown>;
}

const defaultDeps: TierPortfolioDeps = {
  loadScores: getConvictionScoresForPattern,
  loadCampaignCtx: getCampaignContextForPattern,
  loadShowsByIds: async (ids) => {
    const shows = await getShowsByIds(ids);
    return new Map(shows.map((s) => [s.id, s]));
  },
  persist: updateConvictionTierCost,
  emit: logEvent,
};

export interface TierPortfolioResult {
  campaignPatternId: string;
  testCount: number;
  scaleCount: number;
  droppedCount: number;
  /** testCount < MIN_TEST_SHOWS — Layer 4 surfaces the tight-budget UX. */
  testUnderfilled: boolean;
  showsClassified: number;
  /** Per-show persist calls that succeeded. */
  persisted: number;
  errors: string[];
}

const NEEDS_QUOTE_COST: SpotCost = {
  perSpotCents: null,
  threeSpotCents: null,
  cpmUsedCents: null,
  costBasis: null,
  isEstimate: false,
  needsQuote: true,
};

function msg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Derive cost (Layer 1), classify (classifyTier), and persist tier + cost onto
 * conviction_scores for one campaign pattern. Keyed on campaign_pattern_id —
 * loads everything it needs. Standalone (NOT wired into runConvictionDiscovery;
 * that orchestrator hook is Layer 3). Fail-soft end to end: every I/O call is
 * guarded, per-show failures are collected, the function never throws.
 *
 * The cost columns it writes are added by migration 028; until that migration
 * is run + introspected the UPDATE fails soft (returns false) — which is why
 * this pass is not yet called from the live discovery flow.
 */
export async function tierCampaignPortfolio(
  campaignPatternId: string,
  deps: TierPortfolioDeps = defaultDeps,
  options: { placement?: Placement } = {}
): Promise<TierPortfolioResult> {
  const placement: Placement = options.placement ?? "midroll";
  const result: TierPortfolioResult = {
    campaignPatternId,
    testCount: 0,
    scaleCount: 0,
    droppedCount: 0,
    testUnderfilled: false,
    showsClassified: 0,
    persisted: 0,
    errors: [],
  };

  let rows: ConvictionScoreRow[] = [];
  try {
    rows = await deps.loadScores(campaignPatternId);
  } catch (err) {
    result.errors.push(`loadScores failed: ${msg(err)}`);
  }

  if (rows.length === 0) {
    // Nothing scored yet (or the read failed). 0 test shows is the honest
    // signal; nothing to persist.
    result.testUnderfilled = result.testCount < MIN_TEST_SHOWS;
    return result;
  }

  let ctx: CampaignContextForPattern | null = null;
  try {
    ctx = await deps.loadCampaignCtx(campaignPatternId);
  } catch (err) {
    result.errors.push(`loadCampaignCtx failed: ${msg(err)}`);
  }
  const testBudgetCents = dollarsToCents(ctx?.budgetTotalDollars ?? 0);
  if (!(testBudgetCents > 0)) {
    result.errors.push(
      `No usable campaign budget for pattern ${campaignPatternId}; ` +
        `affordability gate degenerate (gate-worthy shows skew to scale).`
    );
  }

  const rollup = rollupShowComposite(rows);
  const showIds = [...rollup.keys()];

  let showsById = new Map<string, Show>();
  try {
    showsById = await deps.loadShowsByIds(showIds);
  } catch (err) {
    result.errors.push(`loadShowsByIds failed: ${msg(err)}`);
  }

  for (const [showId, roll] of rollup) {
    const show = showsById.get(showId);
    let cost: SpotCost;
    if (show) {
      cost = deriveSpotCost(show, undefined, placement);
    } else {
      // Defensive: 2B persists kept shows, so a missing row is an anomaly.
      // Treat as un-pricable → needsQuote → dropped; never throw or drop silently.
      cost = { ...NEEDS_QUOTE_COST };
      result.errors.push(`Show ${showId} not found; classified as needs-quote.`);
    }

    const tier = classifyTier({
      compositeScore: roll.composite,
      threeSpotCents: cost.threeSpotCents,
      costBasis: cost.costBasis,
      needsQuote: cost.needsQuote,
      testBudgetCents,
    });

    result.showsClassified++;
    if (tier === "test") result.testCount++;
    else if (tier === "scale") result.scaleCount++;
    else result.droppedCount++;

    try {
      const ok = await deps.persist({
        campaignPatternId,
        showId,
        tier,
        perSpotCents: cost.perSpotCents,
        threeSpotCents: cost.threeSpotCents,
        cpmUsedCents: cost.cpmUsedCents,
        costBasis: cost.costBasis,
        costIsEstimate: cost.isEstimate,
        needsQuote: cost.needsQuote,
      });
      if (ok) result.persisted++;
      else result.errors.push(`persist returned false for show ${showId}.`);
    } catch (err) {
      result.errors.push(`persist threw for show ${showId}: ${msg(err)}`);
    }
  }

  result.testUnderfilled = result.testCount < MIN_TEST_SHOWS;

  // portfolio.tiered — the split completed. Fail-soft; only fire when the
  // campaign id is known (the event hangs off the campaign entity).
  if (ctx?.campaignId) {
    try {
      await deps.emit({
        eventType: "portfolio.tiered",
        entityType: "campaign",
        entityId: ctx.campaignId,
        payload: {
          campaignPatternId,
          testCount: result.testCount,
          scaleCount: result.scaleCount,
          droppedCount: result.droppedCount,
          testUnderfilled: result.testUnderfilled,
          testBudgetCents,
        },
      });
    } catch (err) {
      result.errors.push(`emit portfolio.tiered failed: ${msg(err)}`);
    }
  }

  return result;
}
