// ============================================================
// PODSCAN MATCH VERIFICATION
//
// Strict "is this search result actually this show?" check, required before
// persisting a podscan_id anywhere. findPodcastByName matches by name search
// and FALLS BACK TO THE FIRST RESULT — fine for display enrichment, not for
// a durable id write: a wrong podscan_id silently poisons that show's
// demographics forever.
//
// Two gates:
// - isRssVerifiedMatch — feed-URL equality ONLY; the auto-write gate for the
//   demographics backfill. Name similarity is never consulted there: the
//   first live review queue surfaced first-result mismatches (Huberman → a
//   Spreaker feed, Rich Roll → Daily Stoic).
// - isVerifiedPodcastMatch — rss equality when both sides have a feed, else
//   exact normalized-name equality; the enrich route's persist gate.
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

/** The podcast's feed-URL comparison keys (rss_url + rss_url_normalized). */
function podcastRssKeys(podcast: PodscanPodcast): string[] {
  return [podcast.rss_url, podcast.rss_url_normalized]
    .filter((u): u is string => !!u && u.trim().length > 0)
    .map(normalizeRssUrl);
}

/**
 * Strict feed-identity check: true ONLY when our stored rss_url equals one
 * of the podcast's feed URLs (normalized). Name equality is deliberately
 * never consulted — a show without a stored rss_url can never RSS-verify.
 */
export function isRssVerifiedMatch(
  show: { rss_url?: string | null },
  podcast: PodscanPodcast
): boolean {
  const showRss = show.rss_url?.trim();
  if (!showRss) return false;
  return podcastRssKeys(podcast).includes(normalizeRssUrl(showRss));
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
  const podRssKeys = podcastRssKeys(podcast);
  if (showRss && podRssKeys.length > 0) {
    return podRssKeys.includes(normalizeRssUrl(showRss));
  }
  return normalizeShowName(show.name) === normalizeShowName(podcast.podcast_name);
}
