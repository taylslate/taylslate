// Find the one episode tied to a booked spot.
// Podcast: that show's RSS enclosure.
// YouTube: that channel's uploads, or the video id the IO already names,
// through the existing YouTube client. This does not search the catalog
// and does not run the library pull.

import {
  getYouTubeClientSafe,
  type YouTubeClient,
} from "@/lib/enrichment/youtube";
import { fetchCapped, RSS_MAX_BYTES, DEFAULT_FETCH_TIMEOUT_MS } from "@/lib/security/safe-fetch";
import { looksLikeAudioUrl, matchRssItem, parseRssItems, type RssItem } from "./rss";
import { dayInWindow, utcDay, type AirWindow } from "./window";


export interface YoutubeSpotVideo {
  videoId: string;
  channelId: string;
  publishedAt: string;
  durationSeconds: number | null;
}

export interface YoutubeAircheckClient {
  recentLongForm(channelId: string): Promise<
    Array<{ videoId: string; publishedAt: string; durationSeconds: number | null }>
  >;
  videoById(videoId: string): Promise<YoutubeSpotVideo | null>;
}

export interface FoundEpisode {
  episodeIdentifier: string;
  audioUrl: string | null;
  durationSeconds: number | null;
  source: "rss" | "youtube";
  note: string | null;
}

export function youtubeVideoId(value: string | null | undefined): string | null {
  const raw = value?.trim() ?? "";
  if (!raw) return null;
  if (/^[a-zA-Z0-9_-]{11}$/.test(raw)) return raw;
  try {
    const url = new URL(raw);
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    if (host === "youtu.be") {
      const id = url.pathname.split("/").filter(Boolean)[0] ?? "";
      return /^[a-zA-Z0-9_-]{11}$/.test(id) ? id : null;
    }
    if (host === "youtube.com" || host === "m.youtube.com" || host === "music.youtube.com") {
      const fromQuery = url.searchParams.get("v") ?? "";
      if (/^[a-zA-Z0-9_-]{11}$/.test(fromQuery)) return fromQuery;
      const parts = url.pathname.split("/").filter(Boolean);
      if (parts[0] === "shorts" || parts[0] === "live" || parts[0] === "embed") {
        const id = parts[1] ?? "";
        return /^[a-zA-Z0-9_-]{11}$/.test(id) ? id : null;
      }
    }
  } catch {
    return null;
  }
  return null;
}

export function youtubeClientAdapter(client: YouTubeClient): YoutubeAircheckClient {
  return {
    async recentLongForm(channelId) {
      const stats = await client.recentUploadsStats(channelId);
      return stats.videos.map((video) => ({
        videoId: video.videoId,
        publishedAt: video.publishedAt,
        durationSeconds: null,
      }));
    },
    async videoById(videoId) {
      const video = await client.getVideo(videoId);
      if (!video) return null;
      return {
        videoId: video.videoId,
        channelId: video.channelId,
        publishedAt: video.publishedAt,
        durationSeconds: video.durationSeconds,
      };
    },
  };
}

export function youtubeClientFromEnv(): YoutubeAircheckClient | null {
  const client = getYouTubeClientSafe();
  if (!client) return null;
  return youtubeClientAdapter(client);
}

function closestItem(items: RssItem[], postDate: string, window: AirWindow): RssItem | null {
  const inWindow = items.filter((item) => {
    if (!item.enclosureUrl) return false;
    return dayInWindow(utcDay(item.pubDate ?? ""), window);
  });
  if (inWindow.length === 0) return null;
  const target = Date.parse(`${postDate}T00:00:00.000Z`);
  let best = inWindow[0];
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const item of inWindow) {
    const day = utcDay(item.pubDate ?? "");
    const parsed = day ? Date.parse(`${day}T00:00:00.000Z`) : Number.NaN;
    const distance = Number.isNaN(parsed) ? Number.POSITIVE_INFINITY : Math.abs(parsed - target);
    if (distance < bestDistance) {
      best = item;
      bestDistance = distance;
    }
  }
  return best;
}

async function fetchRss(rssUrl: string): Promise<{ xml: string | null; error: string | null }> {
  const body = await fetchCapped(
    rssUrl,
    { headers: { Accept: "application/rss+xml, application/xml, text/xml, */*" } },
    { kind: "rss", maxBytes: RSS_MAX_BYTES, timeoutMs: DEFAULT_FETCH_TIMEOUT_MS }
  );
  if (!body.ok) return { xml: null, error: body.error };
  const xml = new TextDecoder().decode(body.bytes);
  if (!xml.trim()) return { xml: null, error: "RSS feed was empty" };
  return { xml, error: null };
}

export async function findPodcastEpisode(input: {
  rssUrl: string | null;
  episodeUrl: string | null;
  postDate: string;
  window: AirWindow;
}): Promise<FoundEpisode | { error: string }> {
  const rssUrl = input.rssUrl?.trim() || null;
  const episodeUrl = input.episodeUrl?.trim() || null;
  if (episodeUrl && looksLikeAudioUrl(episodeUrl)) {
    return {
      episodeIdentifier: episodeUrl,
      audioUrl: episodeUrl,
      durationSeconds: null,
      source: "rss",
      note: null,
    };
  }
  if (!rssUrl) {
    return { error: "Show has no rss_url for this booked spot" };
  }
  const rss = await fetchRss(rssUrl);
  if (!rss.xml) return { error: rss.error ?? "RSS fetch failed" };
  const items = parseRssItems(rss.xml);
  const named = episodeUrl ? matchRssItem(items, episodeUrl, null) : null;
  const item = named ?? closestItem(items, input.postDate, input.window);
  if (!item) {
    return {
      error: episodeUrl
        ? "Show RSS did not list the episode named on this IO line"
        : "Show RSS did not list an episode inside this air window",
    };
  }
  if (!item.enclosureUrl) {
    return { error: "RSS item matched the spot but has no enclosure" };
  }
  return {
    episodeIdentifier: item.guid || item.link || item.enclosureUrl,
    audioUrl: item.enclosureUrl,
    durationSeconds: item.durationSeconds,
    source: "rss",
    note: null,
  };
}

function closestVideo(
  videos: Array<{ videoId: string; publishedAt: string; durationSeconds: number | null }>,
  postDate: string,
  window: AirWindow
) {
  const inWindow = videos.filter((video) => dayInWindow(utcDay(video.publishedAt), window));
  if (inWindow.length === 0) return null;
  const target = Date.parse(`${postDate}T00:00:00.000Z`);
  let best = inWindow[0];
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const video of inWindow) {
    const day = utcDay(video.publishedAt);
    const parsed = day ? Date.parse(`${day}T00:00:00.000Z`) : Number.NaN;
    const distance = Number.isNaN(parsed) ? Number.POSITIVE_INFINITY : Math.abs(parsed - target);
    if (distance < bestDistance) {
      best = video;
      bestDistance = distance;
    }
  }
  return best;
}

export async function findYoutubeEpisode(input: {
  channelId: string | null;
  episodeUrl: string | null;
  postDate: string;
  window: AirWindow;
  client: YoutubeAircheckClient | null;
}): Promise<FoundEpisode | { error: string }> {
  const directAudio =
    input.episodeUrl && looksLikeAudioUrl(input.episodeUrl) ? input.episodeUrl : null;
  const videoId = youtubeVideoId(input.episodeUrl);
  if (!input.client) {
    if (directAudio) {
      return {
        episodeIdentifier: videoId ?? directAudio,
        audioUrl: directAudio,
        durationSeconds: null,
        source: "youtube",
        note: null,
      };
    }
    return { error: "YOUTUBE_API_KEY is not set, so this YouTube spot was skipped" };
  }

  if (videoId) {
    const video = await input.client.videoById(videoId);
    if (!video) return { error: `YouTube video ${videoId} was not found` };
    return {
      episodeIdentifier: video.videoId,
      audioUrl: directAudio,
      durationSeconds: video.durationSeconds,
      source: "youtube",
      note: directAudio
        ? null
        : `YouTube video ${video.videoId} is the episode for this spot. The Data API does not return an audio file, so it was not transcribed.`,
    };
  }

  const channelId = input.channelId?.trim() || null;
  if (!channelId) return { error: "Show has no YouTube channel id for this booked spot" };
  const videos = await input.client.recentLongForm(channelId);
  const video = closestVideo(videos, input.postDate, input.window);
  if (!video) {
    return { error: "This channel's recent uploads had no long-form video inside the air window" };
  }
  return {
    episodeIdentifier: video.videoId,
    audioUrl: directAudio,
    durationSeconds: video.durationSeconds,
    source: "youtube",
    note: directAudio
      ? null
      : `YouTube video ${video.videoId} is the episode in this air window. The Data API does not return an audio file, so it was not transcribed.`,
  };
}
