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

import type { Campaign, Show } from "@/lib/data/types";

/** Default test cadence — 99% of podcast tests are 3-spot (CLAUDE.md). */
export const DEFAULT_SPOT_COUNT = 3;

/** Podcast ad placement. Distinct purchasable units at distinct CPMs. */
export type Placement = "preroll" | "midroll" | "postroll";

/**
 * How the cost was derived. Persisted to conviction_scores.cost_basis
 * (migration 028, controlled vocabulary) so the estimate-vs-quote delta is
 * recoverable when real quotes return post-outreach.
 * - 'derived'   — podcast CPM × downloads, from a DEFAULT (banded) rate card
 * - 'flat_fee'  — YouTube / flat-rate deal, from a DEFAULT flat rate
 * - 'rate_card' — a real onboarded rate card (not a discovery default)
 */
export type CostBasis = "derived" | "flat_fee" | "rate_card";

export interface SpotCost {
  /** One spot at the selected placement, integer cents. null when needsQuote. */
  perSpotCents: number | null;
  /** perSpotCents × DEFAULT_SPOT_COUNT, integer cents. null when needsQuote. */
  threeSpotCents: number | null;
  /** CPM used, integer cents. null for the flat-fee and needsQuote paths. */
  cpmUsedCents: number | null;
  costBasis: CostBasis | null;
  /** true when the cost rests on a default band, false on a real rate card. */
  isEstimate: boolean;
  /** true when no cost is derivable — flows to a "needs quote" UI state. */
  needsQuote: boolean;
}

/** Single dollars→cents boundary. Rounds to the nearest integer cent. */
function dollarsToCents(dollars: number): number {
  return Math.round(dollars * 100);
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

/**
 * Derive an estimated per-spot and 3-spot cost for one show, in integer cents.
 *
 * @param show       the discovered or onboarded candidate.
 * @param _campaign  reserved for Layer 5 (spot-count / per-show CPM / placement
 *   overrides travel on the campaign). Unused in Layer 1.
 * @param placement  which podcast CPM to price against (default 'midroll').
 *   Pre/mid/post are distinct purchasable units at distinct prices — the
 *   chosen placement's CPM is used directly with NO cross-placement fallback;
 *   a missing CPM for the chosen placement → needsQuote.
 *
 * Never throws, never returns a zero cost, never drops a show: an underivable
 * cost returns needsQuote=true with null cost fields.
 */
export function deriveSpotCost(
  show: Show,
  _campaign?: Campaign,
  placement: Placement = "midroll"
): SpotCost {
  const onboarded = hasOnboardedRateCard(show);

  // Flat-fee path (YouTube, or an onboarded flat-rate podcast deal). The flat
  // fee is view-independent, so audience_size === 0 does NOT force a quote here
  // — only a missing/≤0 flat_rate does. (Dead 0-view YouTube is excluded
  // upstream by the Layer 1b orchestrator filter, so it never reaches here.)
  if (show.price_type === "flat_rate") {
    const flat = show.rate_card.flat_rate;
    if (flat == null || flat <= 0) return { ...NEEDS_QUOTE };
    const perSpotCents = dollarsToCents(flat);
    return {
      perSpotCents,
      threeSpotCents: perSpotCents * DEFAULT_SPOT_COUNT,
      cpmUsedCents: null,
      costBasis: onboarded ? "rate_card" : "flat_fee",
      isEstimate: !onboarded,
      needsQuote: false,
    };
  }

  // CPM path (podcast). Price against the SELECTED placement's CPM only —
  // pre/post are distinct purchasable units, never collapsed into a
  // midroll ?? preroll ?? postroll chain.
  const cpm = show.rate_card[`${placement}_cpm`];
  // A non-finite audience_size (NaN/Infinity) is treated exactly like ≤ 0 →
  // needsQuote, so a malformed reach value can never yield NaN cents and break
  // the "never returns a non-cost" contract.
  if (
    !Number.isFinite(show.audience_size) ||
    show.audience_size <= 0 ||
    cpm == null ||
    cpm <= 0
  ) {
    return { ...NEEDS_QUOTE };
  }

  // Ad Spot Price = (Downloads ÷ 1,000) × CPM (CLAUDE.md domain rule).
  // Explicit at every step: dollars first, then the single cents boundary.
  const perSpotDollars = (show.audience_size / 1000) * cpm;
  const perSpotCents = dollarsToCents(perSpotDollars);
  return {
    perSpotCents,
    threeSpotCents: perSpotCents * DEFAULT_SPOT_COUNT,
    cpmUsedCents: dollarsToCents(cpm),
    costBasis: onboarded ? "rate_card" : "derived",
    isEstimate: !onboarded,
    needsQuote: false,
  };
}
