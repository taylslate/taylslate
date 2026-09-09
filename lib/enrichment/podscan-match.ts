// ============================================================
// PODSCAN MATCH VERIFICATION
//
// Strict "is this search result actually this show?" check, required before
// persisting a podscan_id anywhere. findPodcastByName matches by name search
// and FALLS BACK TO THE FIRST RESULT — fine for display enrichment, not for
// a durable id write: a wrong podscan_id silently poisons that show's
// demographics forever.
//
// Rule: rss_url equality when both sides have one, else normalized-name
// equality. Anything weaker is reported for manual review, never written.
//
// Pure, no I/O.
// ============================================================

import type { PodscanPodcast } from "./podscan";

/** Lowercase, decode the common &amp; entity, collapse whitespace. */
export function normalizeShowName(name: string): string {
  return name
    .toLowerCase()
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

/** Protocol/trailing-slash-insensitive RSS URL comparison key. */
function normalizeRssUrl(url: string): string {
  return url
    .toLowerCase()
    .trim()
    .replace(/^https?:\/\//, "")
    .replace(/\/+$/, "");
}

/**
 * True only when the Podscan podcast is verifiably the same show:
 * - both sides have an RSS URL → they must match (normalized);
 * - otherwise → normalized names must be EQUAL (not merely containing).
 */
export function isVerifiedPodcastMatch(
  show: { name: string; rss_url?: string | null },
  podcast: PodscanPodcast
): boolean {
  const showRss = show.rss_url?.trim() ?? "";
  const podRssCandidates = [podcast.rss_url, podcast.rss_url_normalized]
    .filter((u): u is string => !!u && u.trim().length > 0)
    .map(normalizeRssUrl);
  if (showRss && podRssCandidates.length > 0) {
    return podRssCandidates.includes(normalizeRssUrl(showRss));
  }
  return normalizeShowName(show.name) === normalizeShowName(podcast.podcast_name);
}
