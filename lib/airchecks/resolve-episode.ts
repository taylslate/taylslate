// Resolve the episode an IO line already points at.
// episode_url on the line is the identifier. When that URL is not itself
// an audio file, the show's rss_url is fetched and the matching item's
// enclosure is the audio URL. No second episode table.

import { safeFetch } from "@/lib/security/safe-fetch";
import {
  looksLikeAudioUrl,
  matchRssItem,
  parseRssItems,
} from "./rss";

const MAX_RSS_CHARS = 5_000_000;

export interface ResolvedEpisode {
  episodeIdentifier: string | null;
  audioUrl: string | null;
  /** Why audio could not be resolved. Null when audioUrl is set. */
  note: string | null;
}

async function fetchRss(
  rssUrl: string
): Promise<{ xml: string | null; error: string | null }> {
  const res = await safeFetch(rssUrl, {
    headers: { Accept: "application/rss+xml, application/xml, text/xml, */*" },
  });
  if (!res) {
    return { xml: null, error: `RSS fetch was blocked or failed for ${rssUrl}` };
  }
  if (!res.ok) {
    return { xml: null, error: `RSS fetch failed: ${res.status}` };
  }
  const xml = await res.text();
  if (!xml.trim()) return { xml: null, error: "RSS feed was empty" };
  if (xml.length > MAX_RSS_CHARS) {
    return { xml: null, error: "RSS feed exceeded 5MB" };
  }
  return { xml, error: null };
}

export async function resolveEpisode(input: {
  episodeUrl: string | null;
  postDate: string | null;
  rssUrl: string | null;
}): Promise<ResolvedEpisode> {
  const episodeUrl = input.episodeUrl?.trim() || null;
  let episodeIdentifier = episodeUrl;
  let audioUrl = episodeUrl && looksLikeAudioUrl(episodeUrl) ? episodeUrl : null;
  let note: string | null = null;

  const rssUrl = input.rssUrl?.trim() || null;
  // The line already names an audio file. The feed is not required.
  if (!audioUrl && rssUrl) {
    const rss = await fetchRss(rssUrl);
    if (!rss.xml) {
      note = rss.error;
    } else {
      const item = matchRssItem(parseRssItems(rss.xml), episodeUrl, input.postDate);
      if (!item) {
        note = episodeUrl
          ? "Show RSS did not list an item for this episode URL"
          : "Show RSS did not list an episode on the line's post date";
      } else {
        if (item.enclosureUrl) audioUrl = item.enclosureUrl;
        if (!episodeIdentifier) {
          episodeIdentifier = item.guid || item.link || item.enclosureUrl;
        }
        if (!audioUrl) {
          note = "RSS item matched the episode but has no enclosure URL";
        }
      }
    }
  } else if (!audioUrl && !rssUrl && !episodeUrl) {
    note = "IO line has no episode_url and the show has no rss_url";
  }

  return { episodeIdentifier, audioUrl, note };
}
