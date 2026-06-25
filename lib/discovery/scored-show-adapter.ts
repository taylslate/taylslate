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

import type { ScoredShowRecord } from "@/lib/data/types";
import type { TieredShow } from "./tiered-universe";

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
    estimatedCpm: effectiveCpmDollars(entry),
    demographics: null,
    sponsorCount: show.current_sponsors?.length ?? 0,
    adEngagementRate: null,
    brandSafety: null,
    source: "discover",
  };
}
