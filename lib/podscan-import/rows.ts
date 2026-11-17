// Row builders for the two internal tables. Nothing here targets shows.

import type { CatalogCandidate } from "./candidates";
import type { CheckedEmail, ContactRowStatus, ContactSource } from "./email";
import type { KeepReason } from "./keep";

export interface CatalogInput {
  candidate: CatalogCandidate;
  sponsoredLast12m: boolean;
  latestSponsoredEpisodeId: string | null;
  latestSponsoredAt: string | null;
  appleFeedUrl: string | null;
  feedUrl: string | null;
  reason: KeepReason;
  floor: number;
  demographics: unknown;
  listener: unknown;
  contactStatus: ContactRowStatus;
  showId: string | null;
  updatedAt: string;
}

export function catalogRow(input: CatalogInput): Record<string, unknown> {
  return {
    podscan_id: input.candidate.podcastId,
    show_id: input.showId,
    name: input.candidate.name || input.candidate.podcastId,
    podscan_rss_url: input.candidate.rssUrl,
    apple_itunes_id: input.candidate.itunesId,
    apple_feed_url: input.appleFeedUrl,
    feed_url: input.feedUrl,
    language: input.candidate.language,
    region: input.candidate.region,
    categories: input.candidate.categories,
    last_posted_at: input.candidate.lastPostedAt,
    episode_count: input.candidate.episodeCount,
    podscan_has_sponsors: input.candidate.hasSponsors,
    sponsored_last_12m: input.sponsoredLast12m,
    latest_sponsored_episode_id: input.latestSponsoredEpisodeId,
    latest_sponsored_at: input.latestSponsoredAt,
    keep_reason: input.reason,
    floor_used: input.floor,
    podscan_audience_estimate: input.candidate.audienceSize,
    demographics: input.demographics,
    listener_engagement: input.listener,
    contact_status: input.contactStatus,
    updated_at: input.updatedAt,
  };
}

export function contactRows(input: {
  podscanId: string;
  showId: string | null;
  checks: CheckedEmail[];
  updatedAt: string;
}): Array<Record<string, unknown>> {
  const rows: Array<Record<string, unknown>> = [];
  const seen = new Set<string>();
  for (const check of input.checks) {
    if (!check.email || check.email.length > 254) continue;
    if (check.email !== check.email.trim().toLowerCase()) continue;
    const key = `${check.source}\0${check.email}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({
      podscan_id: input.podscanId,
      show_id: input.showId,
      email: check.email,
      source: check.source satisfies ContactSource,
      syntax_ok: check.syntaxOk,
      mx_ok: check.mxOk,
      mx_checked_at: check.mxOk == null ? null : input.updatedAt,
      status: check.status,
      updated_at: input.updatedAt,
    });
  }
  return rows;
}

export function sortKept<T extends { sponsoredLast12m: boolean; audienceSize: number | null }>(
  shows: readonly T[]
): T[] {
  return [...shows].sort((a, b) => {
    if (a.sponsoredLast12m !== b.sponsoredLast12m) return a.sponsoredLast12m ? -1 : 1;
    return (b.audienceSize ?? -1) - (a.audienceSize ?? -1);
  });
}
