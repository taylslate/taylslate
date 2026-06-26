// ============================================================
// PER-SHOW SPOT COST DERIVATION (Wave 14 Phase 2C — Layer 1)
//
// Deterministic. No LLM, no DB writes. Turns a discovered/onboarded
// Show into an estimated per-spot + 3-spot cost in INTEGER CENTS, so the
// tier classifier (Layer 2) can gate affordability against the campaign
// budget.
//
// REUSE, NOT DUPLICATE: the CPM / flat-fee band tables live ONLY in
// lib/discovery/format-discovered-show.ts (getDefaultPodcastRateCard —
// $18/22/28/35 mid-roll, with pre/post tiers; getDefaultYouTubeFlatRate —
// $2K–15K). This module READS the rate_card those functions already
// produced. It authors NO band table of its own; a forked table would
// silently diverge from the rest of the app.
//
// UNITS: every money value a Show carries is in DOLLARS (rate_card CPMs
// are plain numbers like 22; flat_rate like 5000). Every output here is
// in INTEGER CENTS. dollarsToCents() is the single conversion boundary,
// applied explicitly at each step.
// ============================================================

import type { CostBasis, Show } from "@/lib/data/types";

/** Default test cadence — 99% of podcast tests are 3-spot (CLAUDE.md). */
export const DEFAULT_SPOT_COUNT = 3;

/**
 * Coerce a (possibly overridden) spot count to a positive integer, falling back
 * to DEFAULT_SPOT_COUNT for anything invalid. deriveSpotCost stays total — a
 * malformed override (NaN, 0, fractional) can never produce a non-cost; it
 * silently degrades to the default cadence. The DB CHECK (migration 029) and the
 * override endpoint bound the real range to 1–12; this is the defensive floor.
 */
export function normalizeSpotCount(spotCount: number | null | undefined): number {
  return typeof spotCount === "number" &&
    Number.isInteger(spotCount) &&
    spotCount >= 1
    ? spotCount
    : DEFAULT_SPOT_COUNT;
}

/** Podcast ad placement. Distinct purchasable units at distinct CPMs. */
export type Placement = "preroll" | "midroll" | "postroll";

/**
 * How the cost was derived. Persisted to conviction_scores.cost_basis
 * (migration 028, controlled vocabulary) so the estimate-vs-quote delta is
 * recoverable when real quotes return post-outreach.
 * - 'derived'   — podcast CPM × downloads, from a DEFAULT (banded) rate card
 * - 'flat_fee'  — YouTube / flat-rate deal, from a DEFAULT flat rate
 * - 'rate_card' — a real onboarded rate card (not a discovery default)
 *
 * Canonical definition lives in lib/data/types.ts (it's a persisted column
 * vocabulary, migration 028); re-exported here so existing Layer 1 importers
 * keep working unchanged.
 */
export type { CostBasis };

export interface SpotCost {
  /** One spot at the selected placement, integer cents. null when needsQuote. */
  perSpotCents: number | null;
  /** perSpotCents × the spot count (DEFAULT_SPOT_COUNT unless a Layer 5 override
   *  passes one), integer cents. Named "three" for column compatibility — it
   *  holds N spots, not always 3. null when needsQuote. */
  threeSpotCents: number | null;
  /** CPM used, integer cents. null for the flat-fee and needsQuote paths. */
  cpmUsedCents: number | null;
  costBasis: CostBasis | null;
  /** true when the cost rests on a default band, false on a real rate card. */
  isEstimate: boolean;
  /** true when no cost is derivable — flows to a "needs quote" UI state. */
  needsQuote: boolean;
}

/**
 * Single dollars→cents boundary. Rounds to the nearest integer cent. Exported
 * so Layer 2 (tier-portfolio.ts) converts the campaign budget through the SAME
 * function — one conversion across the money path (pre-flight Flag 7).
 *
 * The magnitude-scaled epsilon nudges values that IEEE-754 represents a hair
 * BELOW an exact half-cent (e.g. (200093/1000)*35 = 7003.255 stored as
 * 7003.254999999999) back up so they round half-UP correctly. Without it, the
 * CPM path — the only one that produces genuine half-cents — silently rounds a
 * cent low at the boundary, which can flip a show across the affordability
 * line. Verified 0 mismatches vs an exact integer reference across 4M
 * audience×CPM combinations; a no-op for the integer/2-decimal budget and
 * flat-rate inputs (their true cents are already integers). (Codex gate, L2.)
 */
export function dollarsToCents(dollars: number): number {
  return Math.round((dollars + Number.EPSILON * Math.max(1, Math.abs(dollars))) * 100);
}

/** No derivable cost: all-null cost, surfaced as "needs quote". */
const NEEDS_QUOTE: SpotCost = {
  perSpotCents: null,
  threeSpotCents: null,
  cpmUsedCents: null,
  costBasis: null,
  isEstimate: false,
  needsQuote: true,
};

/**
 * A real onboarded rate card vs. a discovery default. Discovered shows
 * (format-discovered-show.ts) always leave min_buy undefined; an onboarded
 * show carries a min_buy, so its presence is the signal that the rate_card is
 * real. We do NOT apply min_buy as a cost floor here — that's an affordability
 * concern for Layer 2; folding it into per-spot would corrupt the
 * perSpot × 3 invariant the rest of the system relies on.
 */
function hasOnboardedRateCard(show: Show): boolean {
  return typeof show.min_buy === "number" && show.min_buy > 0;
}

/** Layer 5 override seam — overrides ride into cost derivation here. */
export interface DeriveSpotCostOptions {
  /** Which podcast CPM to price against (default 'midroll'). Pre/mid/post are
   *  distinct purchasable units; the chosen placement's CPM is used directly
   *  with NO cross-placement fallback. */
  placement?: Placement;
  /** Spots in the cadence (default DEFAULT_SPOT_COUNT = 3). The Layer 5
   *  campaign-level spot-count override flows in here; threeSpotCents = perSpot
   *  × this. An invalid value degrades to the default (normalizeSpotCount). */
  spotCount?: number;
  /** Brand's per-show CPM override, integer cents (Layer 5, persisted as
   *  conviction_scores.cpm_override_cents). When set (> 0, finite) it REPLACES
   *  the band-derived CPM on the podcast/CPM path — the brand told us the real
   *  rate, so the cost stops being an estimate (isEstimate=false). Ignored on
   *  the flat-fee path (no CPM there) and when audience is unusable. */
  cpmOverrideCents?: number | null;
}

/**
 * Derive an estimated per-spot and N-spot cost for one show, in integer cents.
 *
 * @param show  the discovered or onboarded candidate.
 * @param opts  placement / spot-count / per-show CPM override (Layer 5). All
 *   optional; the defaults reproduce Layer 1 behaviour (mid-roll, 3 spots, no
 *   override) exactly, so existing callers are unaffected.
 *
 * Never throws, never returns a zero cost, never drops a show: an underivable
 * cost returns needsQuote=true with null cost fields.
 */
export function deriveSpotCost(
  show: Show,
  opts: DeriveSpotCostOptions = {}
): SpotCost {
  const placement: Placement = opts.placement ?? "midroll";
  const spotCount = normalizeSpotCount(opts.spotCount);
  const onboarded = hasOnboardedRateCard(show);

  // Flat-fee path (YouTube, or an onboarded flat-rate podcast deal). The flat
  // fee is view-independent, so audience_size === 0 does NOT force a quote here
  // — only a missing/≤0 flat_rate does. (Dead 0-view YouTube is excluded
  // upstream by the Layer 1b orchestrator filter, so it never reaches here.) A
  // CPM override is meaningless for a flat fee, so it's ignored here.
  if (show.price_type === "flat_rate") {
    const flat = show.rate_card.flat_rate;
    if (flat == null || flat <= 0) return { ...NEEDS_QUOTE };
    const perSpotCents = dollarsToCents(flat);
    return {
      perSpotCents,
      threeSpotCents: perSpotCents * spotCount,
      cpmUsedCents: null,
      costBasis: onboarded ? "rate_card" : "flat_fee",
      isEstimate: !onboarded,
      needsQuote: false,
    };
  }

  // A usable brand CPM override (> 0, finite) supersedes the band CPM. We still
  // require a usable audience_size below — the override is a price, not reach.
  const override =
    opts.cpmOverrideCents != null &&
    Number.isFinite(opts.cpmOverrideCents) &&
    opts.cpmOverrideCents > 0
      ? opts.cpmOverrideCents
      : null;

  // CPM path (podcast). Price against the SELECTED placement's CPM only —
  // pre/post are distinct purchasable units, never collapsed into a
  // midroll ?? preroll ?? postroll chain. The override, in cents, is converted
  // back to dollars so the SAME epsilon-protected dollarsToCents boundary
  // rounds both the band and override paths identically.
  const cpmDollars =
    override != null ? override / 100 : show.rate_card[`${placement}_cpm`];
  // A non-finite audience_size (NaN/Infinity) is treated exactly like ≤ 0 →
  // needsQuote, so a malformed reach value can never yield NaN cents and break
  // the "never returns a non-cost" contract. With an override the placement CPM
  // may be absent, but the override supplies the price — so cpmDollars is the
  // single gate.
  if (
    !Number.isFinite(show.audience_size) ||
    show.audience_size <= 0 ||
    cpmDollars == null ||
    cpmDollars <= 0
  ) {
    return { ...NEEDS_QUOTE };
  }

  // Ad Spot Price = (Downloads ÷ 1,000) × CPM (CLAUDE.md domain rule).
  // Explicit at every step: dollars first, then the single cents boundary.
  const perSpotDollars = (show.audience_size / 1000) * cpmDollars;
  const perSpotCents = dollarsToCents(perSpotDollars);
  return {
    perSpotCents,
    threeSpotCents: perSpotCents * spotCount,
    // Override is already integer cents — surface it verbatim (no round-trip).
    cpmUsedCents: override != null ? override : dollarsToCents(cpmDollars),
    costBasis: onboarded ? "rate_card" : "derived",
    // The brand's own CPM is not an estimate; the band CPM is.
    isEstimate: override != null ? false : !onboarded,
    needsQuote: false,
  };
}
