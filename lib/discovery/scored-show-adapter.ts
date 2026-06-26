// ============================================================
// TIERED SHOW → SCORED SHOW RECORD ADAPTER (Wave 14 Phase 2C — Layer 4)
//
// Pure, no I/O. Bridges the Phase 2C tiered universe (conviction-scored shows
// with derived cost) into the legacy Wave 7 media-plan path, which reads
// campaigns.scored_shows (ScoredShowRecord[]) filtered by selected_show_ids.
//
// The plan handoff endpoint (app/api/campaigns/[id]/plan-handoff) calls this
// for each selected test-tier show, then writes the result to scored_shows so
// the existing media-plan builder can consume it WITHOUT forking Wave 7.
//
// UNITS: TieredShow costs are integer CENTS (Layer 1). ScoredShowRecord money
// is DOLLARS (estimatedCpm like 22). cents→dollars is the single boundary here.
// ============================================================

import type { Placement as MediaPlanPlacement, ScoredShowRecord } from "@/lib/data/types";
import type { TieredShow } from "./tiered-universe";
import type { Placement as DiscoveryPlacement } from "./spot-cost";
import { PLACEMENT_MULTIPLIERS } from "@/lib/utils/pricing";

/**
 * The discovery placement vocabulary (preroll/midroll/postroll) and the Wave 7
 * media-plan vocabulary (pre-roll/mid-roll/post-roll) are distinct strings — map
 * at this boundary so the selected placement (Layer 5) travels into the plan.
 */
const PLACEMENT_TO_MEDIA_PLAN: Record<DiscoveryPlacement, MediaPlanPlacement> = {
  preroll: "pre-roll",
  midroll: "mid-roll",
  postroll: "post-roll",
};

/**
 * Recover an effective CPM (dollars) the Wave 7 builder can price against.
 *
 * - Podcast (`cpmUsedCents` present): the CPM the tier pass priced with, in
 *   dollars — so the plan builder shows the SAME number the discovery card did
 *   (closes the "CPM shown but not editable upstream" continuity gap).
 * - Flat-fee / no CPM: back-compute the CPM that reproduces the per-spot cost
 *   from the audience (perSpot = audience/1000 × cpm ⇒ cpm = perSpot ÷
 *   (audience/1000)), so the builder's CPM-based spotPrice math lands ~the same
 *   total. Falls back to 0 when there's no usable audience/cost (needs-quote
 *   shows never reach here — they're bench, not test).
 *
 * This is the PLACEMENT-PRICED CPM (discovery prices each placement against its
 * own band CPM). The Wave 7 builder, by contrast, applies a placement MULTIPLIER
 * to a base CPM — so baseCpmForBuilder() divides this out, see below.
 */
function effectiveCpmDollars(entry: TieredShow): number {
  if (entry.cpmUsedCents != null && entry.cpmUsedCents > 0) {
    return entry.cpmUsedCents / 100;
  }
  const audience = entry.show?.audience_size ?? 0;
  if (
    entry.perSpotCents != null &&
    entry.perSpotCents > 0 &&
    Number.isFinite(audience) &&
    audience > 0
  ) {
    return entry.perSpotCents / 100 / (audience / 1000);
  }
  return 0;
}

/**
 * The base CPM to hand the Wave 7 builder so its placement-multiplier math
 * reproduces the discovery per-spot price EXACTLY (no double placement
 * adjustment).
 *
 * Discovery prices `perSpot = audience/1000 × placementCpm`, where placementCpm
 * is the band's pre/mid/post CPM directly. Wave 7 prices
 * `perSpot = audience/1000 × baseCpm × MULT[placement]`. Setting
 * `baseCpm = placementCpm / MULT[placement]` makes the two equal:
 * `audience/1000 × (placementCpm / MULT) × MULT = audience/1000 × placementCpm`.
 *
 * For mid-roll (MULT = 1.0) this is a no-op — the common case is unchanged. The
 * fix matters only for a pre/post placement override, where passing the
 * placement-priced CPM straight through would let the builder adjust it a second
 * time. MULT is 1.1 / 1.0 / 0.75 — never 0, so the division is always safe.
 */
function baseCpmForBuilder(
  placementCpm: number,
  placement: MediaPlanPlacement
): number {
  return placementCpm / PLACEMENT_MULTIPLIERS[placement];
}

/**
 * Map one tiered (test-selected) show to a ScoredShowRecord. Returns null when
 * the embedded Show is missing — a show without its row cannot feed the plan
 * builder, so the caller drops it rather than fabricating one.
 *
 * Faithful where the Show carries the data; defensive nulls/zeros for fields
 * the discovery path never populated (episodeCount, language, prsScore,
 * adEngagementRate, brandSafety) — the media-plan builder only reads
 * podcastId / name / audienceSize / estimatedCpm / imageUrl / publisherName.
 */
export function tieredShowToScoredShowRecord(
  entry: TieredShow
): ScoredShowRecord | null {
  const show = entry.show;
  if (!show) return null;

  // The placement travels into the plan, and the CPM is converted to the base
  // the builder's multiplier model expects — so the plan reproduces the
  // discovery per-spot price instead of double-adjusting for placement.
  const placement = PLACEMENT_TO_MEDIA_PLAN[entry.placement];
  const estimatedCpm = baseCpmForBuilder(effectiveCpmDollars(entry), placement);

  return {
    podcastId: entry.showId,
    name: show.name,
    description: show.description ?? "",
    imageUrl: show.image_url ?? null,
    websiteUrl: null,
    rssUrl: show.rss_url ?? null,
    categories: show.categories ?? [],
    publisherName: show.network ?? null,
    language: null,
    episodeCount: 0,
    lastPostedAt: null,
    contactEmail: show.contact?.email ?? null,
    audienceSize: Number.isFinite(show.audience_size) ? show.audience_size : 0,
    prsScore: null,
    compositeScore: entry.composite ?? 0,
    dimensionScores: {
      audienceFit: entry.audienceFit,
      adEngagement: null,
      sponsorRetention: null,
      reach: 0,
    },
    estimatedCpm,
    demographics: null,
    sponsorCount: show.current_sponsors?.length ?? 0,
    adEngagementRate: null,
    brandSafety: null,
    source: "discover",
    // Layer 5: carry the selected placement into the plan (Wave 7 vocabulary).
    // The builder seeds the line item's placement from this and prices the base
    // CPM above against it — reproducing the discovery per-spot price.
    placement,
  };
}
