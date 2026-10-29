// ============================================================
// YOUTUBE DATA API v3 CLIENT
// Enriches YouTube show records with channel and video stats.
// Docs: https://developers.google.com/youtube/v3
// ============================================================

import { redactSecretParams } from "@/lib/discovery/redact-secrets";

const YOUTUBE_API_BASE = "https://www.googleapis.com/youtube/v3";

/** playlistItems.list (1) plus videos.list (1). */
export const UPLOADS_STATS_UNITS = 2;
export const UPLOADS_STATS_MAX_RESULTS = 15;
export const UPLOADS_STATS_WINDOW_DAYS = 90;
/** Videos of this many seconds or less are Shorts and stay out of the average. */
export const SHORTS_MAX_DURATION_SECONDS = 60;

// ---- Types ----

export interface YouTubeChannelSnippet {
  title: string;
  description: string;
  customUrl?: string;
  publishedAt: string;
  country?: string;
  /** ISO 639-1, sometimes with a region subtag (en, en-US). */
  defaultLanguage?: string;
  thumbnails: {
    default?: { url: string; width: number; height: number };
    medium?: { url: string; width: number; height: number };
    high?: { url: string; width: number; height: number };
  };
}

export interface YouTubeChannelStatistics {
  viewCount: string;
  subscriberCount: string;
  hiddenSubscriberCount: boolean;
  videoCount: string;
}

export interface YouTubeChannelTopicDetails {
  topicCategories?: string[]; // Wikipedia URLs like "https://en.wikipedia.org/wiki/Entertainment"
}

export interface YouTubeChannelBrandingSettings {
  channel?: {
    /** Space-separated. Quoted phrases group words. */
    keywords?: string;
  };
}

export interface YouTubeChannel {
  id: string;
  snippet: YouTubeChannelSnippet;
  statistics: YouTubeChannelStatistics;
  topicDetails?: YouTubeChannelTopicDetails;
  brandingSettings?: YouTubeChannelBrandingSettings;
}

export interface YouTubeVideoStatistics {
  viewCount: string;
  likeCount?: string;
  commentCount?: string;
}

export interface YouTubeVideo {
  id: string;
  snippet: {
    title: string;
    publishedAt: string;
    channelId: string;
  };
  statistics: YouTubeVideoStatistics;
}

export interface YouTubeChannelDetails {
  channelId: string;
  title: string;
  description: string;
  customUrl?: string;
  country?: string;
  publishedAt: string;
  thumbnailUrl?: string;
  subscriberCount: number;
  videoCount: number;
  totalViewCount: number;
  /** Readable topic labels. Wikipedia URLs are converted before this is set. */
  topicCategories: string[];
  /** brandingSettings.channel.keywords, split into phrases. Empty when unset. */
  keywords?: string[];
  defaultLanguage?: string;
}

export interface YouTubeVideoStats {
  videoId: string;
  title: string;
  publishedAt: string;
  viewCount: number;
  likeCount: number;
  commentCount: number;
}

export interface YouTubeRecentStats {
  videos: YouTubeVideoStats[];
  averageViews: number;
  averageLikes: number;
  averageComments: number;
  totalVideosAnalyzed: number;
}

/** Recent long-form views from the channel uploads playlist. */
export interface YouTubeUploadsStats extends YouTubeRecentStats {
  /** Mean of the qualifying view counts. Same number as averageViews. */
  meanViews: number;
  medianViews: number;
  /** Long-form videos in the window, among the playlist page that was read. */
  uploadCount: number;
  method: "uploads" | "estimate";
}

export interface UploadedVideoSample {
  videoId: string;
  publishedAt: string;
  durationSeconds: number | null;
  viewCount: number;
  likeCount?: number;
  commentCount?: number;
  title?: string;
}

// snippet + topicDetails + brandingSettings, plus statistics for the
// existing video-count and view filters.
const CHANNEL_DETAIL_PARTS = "snippet,statistics,topicDetails,brandingSettings";

/**
 * Wikipedia topic URL to a readable label.
 * https://en.wikipedia.org/wiki/Physical_fitness → "Physical fitness"
 */
export function wikipediaTopicUrlToLabel(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) return "";
  let slug = trimmed;
  const wiki = trimmed.match(/\/wiki\/([^?#]+)/);
  if (wiki) {
    slug = wiki[1];
  } else if (trimmed.includes("/")) {
    const parts = trimmed.split("/").filter(Boolean);
    slug = parts[parts.length - 1] ?? "";
  }
  slug = slug.replace(/\/+$/, "");
  try {
    slug = decodeURIComponent(slug.replace(/\+/g, "%20"));
  } catch {
    // Keep the raw slug when it is not valid percent-encoding.
  }
  return slug.replace(/_/g, " ").trim();
}

/** Split brandingSettings.channel.keywords. Quoted phrases stay together. */
export function parseYouTubeChannelKeywords(raw: string | undefined | null): string[] {
  if (!raw) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  const re = /"([^"]*)"|(\S+)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(raw)) !== null) {
    const term = (match[1] ?? match[2] ?? "").trim();
    if (!term) continue;
    const key = term.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(term);
  }
  return out;
}

/**
 * Uploads playlist id. A known contentDetails.relatedPlaylists.uploads
 * value wins. Otherwise the channel id with its UC prefix replaced by UU.
 */
export function uploadsPlaylistId(channelId: string, knownUploadsId?: string | null): string {
  const provided = knownUploadsId?.trim();
  if (provided) return provided;
  if (channelId.startsWith("UC")) return `UU${channelId.slice(2)}`;
  return channelId;
}

/** ISO-8601 duration (PT#H#M#S) to seconds. Null when the value is missing or not a duration. */
export function parseIso8601DurationSeconds(iso: string | undefined | null): number | null {
  if (!iso) return null;
  const match = iso
    .trim()
    .match(/^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/);
  if (!match) return null;
  if (!match[1] && !iso.includes("T")) return null;
  const days = Number(match[1] ?? 0);
  const hours = Number(match[2] ?? 0);
  const minutes = Number(match[3] ?? 0);
  const seconds = Number(match[4] ?? 0);
  if (![days, hours, minutes, seconds].every((value) => Number.isFinite(value))) return null;
  return Math.round(days * 86400 + hours * 3600 + minutes * 60 + seconds);
}

export function isShortFormDuration(durationSeconds: number | null): boolean {
  return durationSeconds != null && durationSeconds <= SHORTS_MAX_DURATION_SECONDS;
}

/** Median. An even count averages the two middle values. */
export function medianNumber(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid];
  return (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Long-form videos published in the last `windowDays` days.
 * Shorts (duration of 60 seconds or less) and rows with no duration are left out.
 */
export function summarizeLongFormUploads(
  samples: UploadedVideoSample[],
  now: Date,
  windowDays = UPLOADS_STATS_WINDOW_DAYS
): {
  videos: YouTubeVideoStats[];
  meanViews: number;
  medianViews: number;
  uploadCount: number;
} {
  const windowStart = now.getTime() - windowDays * 24 * 60 * 60 * 1000;
  const videos: YouTubeVideoStats[] = [];
  for (const sample of samples) {
    const published = Date.parse(sample.publishedAt);
    if (!Number.isFinite(published) || published < windowStart) continue;
    if (sample.durationSeconds == null || isShortFormDuration(sample.durationSeconds)) continue;
    videos.push({
      videoId: sample.videoId,
      title: sample.title ?? "",
      publishedAt: sample.publishedAt,
      viewCount: sample.viewCount,
      likeCount: sample.likeCount ?? 0,
      commentCount: sample.commentCount ?? 0,
    });
  }
  const counts = videos.map((video) => video.viewCount);
  const uploadCount = videos.length;
  const meanViews =
    uploadCount === 0 ? 0 : Math.round(counts.reduce((sum, value) => sum + value, 0) / uploadCount);
  return {
    videos,
    meanViews,
    medianViews: uploadCount === 0 ? 0 : medianNumber(counts),
    uploadCount,
  };
}

function uploadsStatsFromSummary(
  summary: ReturnType<typeof summarizeLongFormUploads>,
  method: "uploads" | "estimate",
  fallbackAverage?: number | null
): YouTubeUploadsStats {
  const fallback =
    fallbackAverage != null && Number.isFinite(fallbackAverage) ? Math.round(fallbackAverage) : 0;
  const measured = method === "uploads";
  const meanViews = measured ? summary.meanViews : fallback;
  const medianViews = measured ? summary.medianViews : fallback;
  const videos = measured ? summary.videos : [];
  const count = videos.length;
  const averageLikes =
    count === 0 ? 0 : Math.round(videos.reduce((sum, video) => sum + video.likeCount, 0) / count);
  const averageComments =
    count === 0 ? 0 : Math.round(videos.reduce((sum, video) => sum + video.commentCount, 0) / count);
  return {
    videos,
    averageViews: meanViews,
    meanViews,
    medianViews,
    averageLikes,
    averageComments,
    totalVideosAnalyzed: measured ? summary.uploadCount : 0,
    uploadCount: measured ? summary.uploadCount : 0,
    method,
  };
}

function mapYouTubeChannel(channel: YouTubeChannel): YouTubeChannelDetails {
  const topicCategories = (channel.topicDetails?.topicCategories ?? [])
    .map((url) => wikipediaTopicUrlToLabel(url))
    .filter(Boolean);

  return {
    channelId: channel.id,
    title: channel.snippet.title,
    description: channel.snippet.description,
    customUrl: channel.snippet.customUrl,
    country: channel.snippet.country,
    defaultLanguage: channel.snippet.defaultLanguage,
    publishedAt: channel.snippet.publishedAt,
    thumbnailUrl: channel.snippet.thumbnails?.high?.url ?? channel.snippet.thumbnails?.medium?.url,
    subscriberCount: parseInt(channel.statistics.subscriberCount, 10) || 0,
    videoCount: parseInt(channel.statistics.videoCount, 10) || 0,
    totalViewCount: parseInt(channel.statistics.viewCount, 10) || 0,
    topicCategories,
    keywords: parseYouTubeChannelKeywords(channel.brandingSettings?.channel?.keywords),
  };
}

// ---- Client ----

export class YouTubeClient {
  private apiKey: string;

  constructor(apiKey?: string) {
    const key = apiKey ?? process.env.YOUTUBE_API_KEY;
    if (!key) {
      throw new Error("YOUTUBE_API_KEY is not set");
    }
    this.apiKey = key;
  }

  private async request<T>(path: string, params: Record<string, string | number | boolean>): Promise<T> {
    const url = new URL(`${YOUTUBE_API_BASE}${path}`);
    url.searchParams.set("key", this.apiKey);
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== "") {
        url.searchParams.set(key, String(value));
      }
    }

    const res = await fetch(url.toString(), {
      next: { revalidate: 3600 },
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`YouTube API error ${res.status}: ${body}`);
    }

    return res.json() as Promise<T>;
  }

  /**
   * Search videos in the last 12 months, then read each video's channel.
   * search.list type=video matches titles people watch. type=channel matches
   * channel names, which is how niche phrases return small channels.
   * Costs 100 quota units, the same as searchChannels.
   * publishedAfter is 12 months before this call. order defaults to relevance.
   * Pass viewCount when the caller wants popular videos first.
   */
  async searchVideos(
    query: string,
    maxResults = 50,
    order: "relevance" | "viewCount" = "relevance"
  ): Promise<{ channelId: string; videoId: string; title: string; description: string }[]> {
    const publishedAfter = new Date();
    publishedAfter.setUTCMonth(publishedAfter.getUTCMonth() - 12);

    const res = await this.request<{
      items?: {
        id?: { videoId?: string };
        snippet?: { channelId?: string; title?: string; description?: string };
      }[];
    }>("/search", {
      part: "snippet",
      q: query,
      type: "video",
      order,
      videoDuration: "medium",
      publishedAfter: publishedAfter.toISOString(),
      regionCode: "US",
      relevanceLanguage: "en",
      maxResults,
    });

    const hits: { channelId: string; videoId: string; title: string; description: string }[] = [];
    for (const item of res.items ?? []) {
      const channelId = item.snippet?.channelId?.trim() ?? "";
      if (!channelId) continue;
      hits.push({
        channelId,
        videoId: item.id?.videoId ?? "",
        title: item.snippet?.title ?? "",
        description: item.snippet?.description ?? "",
      });
    }
    return hits;
  }

  /**
   * Search for YouTube channels by name.
   * Returns channel IDs and basic info.
   * Enrichment still uses this. Discovery uses searchVideos.
   */
  async searchChannels(query: string, maxResults = 5): Promise<{ channelId: string; title: string; description: string }[]> {
    const res = await this.request<{
      items?: { id: { channelId: string }; snippet: { title: string; description: string } }[];
    }>("/search", {
      part: "snippet",
      q: query,
      type: "channel",
      maxResults,
      // Enrichment looks a channel up by name. These bias that search to the US/English market.
      regionCode: "US",
      relevanceLanguage: "en",
    });

    return (res.items ?? []).map((item) => ({
      channelId: item.id.channelId,
      title: item.snippet.title,
      description: item.snippet.description,
    }));
  }

  /**
   * Get full channel details: subscriber count, video count, description, thumbnails, topics.
   * statistics stays in the part list because video count and view count feed the existing filters.
   */
  async getChannelDetails(channelId: string): Promise<YouTubeChannelDetails | null> {
    const res = await this.request<{ items?: YouTubeChannel[] }>("/channels", {
      part: CHANNEL_DETAIL_PARTS,
      id: channelId,
    });

    const channel = res.items?.[0];
    if (!channel) return null;
    return mapYouTubeChannel(channel);
  }

  /**
   * Get details for multiple channels in a single API call.
   * YouTube Data API natively supports comma-separated channel IDs (max 50).
   */
  async getMultipleChannelDetails(channelIds: string[]): Promise<YouTubeChannelDetails[]> {
    if (channelIds.length === 0) return [];

    const res = await this.request<{ items?: YouTubeChannel[] }>("/channels", {
      part: CHANNEL_DETAIL_PARTS,
      id: channelIds.join(","),
    });

    return (res.items ?? []).map((channel) => mapYouTubeChannel(channel));
  }

  /**
   * Get view/like/comment counts for recent videos. Calculates average views.
   * audience_size for YouTube shows = average views per video.
   */
  async getRecentVideoStats(channelId: string, maxVideos = 10): Promise<YouTubeRecentStats> {
    // Step 1: Get recent video IDs via search
    const searchRes = await this.request<{
      items?: { id: { videoId: string } }[];
    }>("/search", {
      part: "id",
      channelId,
      type: "video",
      order: "date",
      maxResults: maxVideos,
      regionCode: "US",
      relevanceLanguage: "en",
    });

    const videoIds = (searchRes.items ?? []).map((item) => item.id.videoId).filter(Boolean);
    if (videoIds.length === 0) {
      return { videos: [], averageViews: 0, averageLikes: 0, averageComments: 0, totalVideosAnalyzed: 0 };
    }

    // Step 2: Get statistics for those videos
    const statsRes = await this.request<{ items?: YouTubeVideo[] }>("/videos", {
      part: "snippet,statistics",
      id: videoIds.join(","),
    });

    const videos: YouTubeVideoStats[] = (statsRes.items ?? []).map((v) => ({
      videoId: v.id,
      title: v.snippet.title,
      publishedAt: v.snippet.publishedAt,
      viewCount: parseInt(v.statistics.viewCount, 10) || 0,
      likeCount: parseInt(v.statistics.likeCount ?? "0", 10) || 0,
      commentCount: parseInt(v.statistics.commentCount ?? "0", 10) || 0,
    }));

    const totalViews = videos.reduce((s, v) => s + v.viewCount, 0);
    const totalLikes = videos.reduce((s, v) => s + v.likeCount, 0);
    const totalComments = videos.reduce((s, v) => s + v.commentCount, 0);
    const count = videos.length || 1;

    return {
      videos,
      averageViews: Math.round(totalViews / count),
      averageLikes: Math.round(totalLikes / count),
      averageComments: Math.round(totalComments / count),
      totalVideosAnalyzed: videos.length,
    };
  }

  /**
   * Recent long-form views from the uploads playlist.
   * playlistItems.list (max 15) then one videos.list for statistics and contentDetails.
   * About 2 quota units. On error, returns the catalog fallback with method "estimate".
   */
  async recentUploadsStats(
    channelId: string,
    options?: {
      uploadsPlaylistId?: string | null;
      fallbackAverage?: number | null;
      now?: Date;
    }
  ): Promise<YouTubeUploadsStats> {
    const now = options?.now ?? new Date();
    const playlistId = uploadsPlaylistId(channelId, options?.uploadsPlaylistId);
    try {
      const playlist = await this.request<{
        items?: {
          contentDetails?: { videoId?: string; videoPublishedAt?: string };
        }[];
      }>("/playlistItems", {
        part: "contentDetails",
        playlistId,
        maxResults: UPLOADS_STATS_MAX_RESULTS,
      });

      const listed = (playlist.items ?? [])
        .map((item) => ({
          videoId: item.contentDetails?.videoId?.trim() ?? "",
          publishedAt: item.contentDetails?.videoPublishedAt ?? "",
        }))
        .filter((item) => item.videoId);

      if (listed.length === 0) {
        return uploadsStatsFromSummary(summarizeLongFormUploads([], now), "uploads");
      }

      const statsRes = await this.request<{
        items?: {
          id?: string;
          contentDetails?: { duration?: string };
          statistics?: { viewCount?: string; likeCount?: string; commentCount?: string };
        }[];
      }>("/videos", {
        part: "statistics,contentDetails",
        id: listed.map((item) => item.videoId).join(","),
      });

      const byId = new Map((statsRes.items ?? []).map((item) => [item.id ?? "", item]));
      const samples: UploadedVideoSample[] = listed.map((item) => {
        const video = byId.get(item.videoId);
        return {
          videoId: item.videoId,
          publishedAt: item.publishedAt,
          durationSeconds: parseIso8601DurationSeconds(video?.contentDetails?.duration),
          viewCount: parseInt(video?.statistics?.viewCount ?? "0", 10) || 0,
          likeCount: parseInt(video?.statistics?.likeCount ?? "0", 10) || 0,
          commentCount: parseInt(video?.statistics?.commentCount ?? "0", 10) || 0,
        };
      });
      return uploadsStatsFromSummary(summarizeLongFormUploads(samples, now), "uploads");
    } catch (err) {
      const message = err instanceof Error ? err.message : "unknown error";
      console.warn(`[youtube] recent uploads stats failed: ${redactSecretParams(message)}`);
      return uploadsStatsFromSummary(
        summarizeLongFormUploads([], now),
        "estimate",
        options?.fallbackAverage
      );
    }
  }
}

// ---- Singleton ----

let _client: YouTubeClient | null = null;

/**
 * Returns null if YOUTUBE_API_KEY is not configured.
 */
export function getYouTubeClientSafe(): YouTubeClient | null {
  if (!process.env.YOUTUBE_API_KEY) {
    console.log("YOUTUBE_API_KEY not configured — skipping YouTube enrichment");
    return null;
  }
  if (!_client) {
    _client = new YouTubeClient();
  }
  return _client;
}
