// Wave 14 Phase 2D — Layer B: per-deal UTM tracking link.
//
// A tracking link is the brand's OWN website with UTM params appended, handed
// to the show for its show notes ("get 20% off at saunabox.com — link below").
// The UTM params let the brand's own analytics (GA, etc.) attribute podcast-
// driven traffic back to a specific show + deal.
//
// GENERATED ON READ — no migration, no column, no persistence. Derived
// deterministically from `brand_profiles.brand_website` + the show name +
// `deals.id` every render, so it can never drift from the deal record.
//
// TODO(backlog): persisting the exact emitted link, or a per-deal
// landing-URL override (so the brand can point the show at a campaign-specific
// page instead of the site root), is a deferred backlog item — not built now.

/**
 * UTM taxonomy (see buildTrackingLink):
 *   utm_source   = "podcast"           — stable channel; all podcast traffic
 *                                        buckets together in the brand's analytics
 *                                        rather than fragmenting per show.
 *   utm_medium   = "podcast"           — the channel.
 *   utm_campaign = "<show-slug>-<id>"  — per-show + per-deal granularity lives
 *                                        here; the deal id guarantees uniqueness.
 */
export const UTM_SOURCE = "podcast";
export const UTM_MEDIUM = "podcast";

export interface TrackingLinkParams {
  /** Brand's website — the link target. From brand_profiles.brand_website. */
  brandWebsite: string | null | undefined;
  /** The deal id — the unique, stable per-deal token. */
  dealId: string;
  /** Show name — slugified into utm_campaign for per-show granularity. */
  showName?: string | null;
}

/**
 * Slugify a show name for use inside utm_campaign: lowercase, non-alphanumerics
 * to single hyphens, trimmed. Returns "" when nothing usable remains.
 */
function slugifyShowName(showName: string | null | undefined): string {
  if (!showName) return "";
  return showName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Build a UTM-tagged tracking link pointing at the brand's website.
 *
 * Returns null when `brandWebsite` is missing/blank or unparseable — callers
 * render nothing in that case, never a broken link.
 *
 * Behavior:
 *   - blank / null / undefined brandWebsite → null
 *   - no scheme → prepend "https://"
 *   - existing query params on brandWebsite are preserved; only the utm_* keys
 *     are set (merged, not clobbered)
 *   - encoding is handled by the URL API
 */
export function buildTrackingLink({
  brandWebsite,
  dealId,
  showName,
}: TrackingLinkParams): string | null {
  const raw = brandWebsite?.trim();
  if (!raw) return null;

  // Prepend a scheme if the brand entered a bare host ("saunabox.com").
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;

  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    // Malformed value — render nothing rather than a broken link.
    return null;
  }

  // A tracking link must be http(s). Reject any other scheme that survived
  // parsing (e.g. a stored "ftp://" or "javascript:" value) rather than hand
  // the show a non-http link. Render nothing instead.
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;

  const slug = slugifyShowName(showName);
  const campaign = slug ? `${slug}-${dealId}` : dealId;

  // .set() preserves any existing (non-utm) query params and only writes ours.
  url.searchParams.set("utm_source", UTM_SOURCE);
  url.searchParams.set("utm_medium", UTM_MEDIUM);
  url.searchParams.set("utm_campaign", campaign);

  return url.toString();
}
