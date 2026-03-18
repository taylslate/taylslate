// ============================================================
// YOUTUBE DATA API v3 CLIENT
// Enriches YouTube show records with channel and video stats.
// Docs: https://developers.google.com/youtube/v3
// ============================================================

const YOUTUBE_API_BASE = "https://www.googleapis.com/youtube/v3";

// ---- Types ----

export interface YouTubeChannelSnippet {
  title: string;
  description: string;
  customUrl?: string;
  publishedAt: string;
  country?: string;
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

export interface YouTubeChannel {
  id: string;
  snippet: YouTubeChannelSnippet;
  statistics: YouTubeChannelStatistics;
  topicDetails?: YouTubeChannelTopicDetails;
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
  topicCategories: string[];
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
   * Search for YouTube channels by name.
   * Returns channel IDs and basic info.
   */
  async searchChannels(query: string, maxResults = 5): Promise<{ channelId: string; title: string; description: string }[]> {
    const res = await this.request<{
      items?: { id: { channelId: string }; snippet: { title: string; description: string } }[];
    }>("/search", {
      part: "snippet",
      q: query,
      type: "channel",
      maxResults,
    });

    return (res.items ?? []).map((item) => ({
      channelId: item.id.channelId,
      title: item.snippet.title,
      description: item.snippet.description,
    }));
  }

  /**
   * Get full channel details: subscriber count, video count, description, thumbnails, topics.
   */
  async getChannelDetails(channelId: string): Promise<YouTubeChannelDetails | null> {
    const res = await this.request<{ items?: YouTubeChannel[] }>("/channels", {
      part: "snippet,statistics,topicDetails",
      id: channelId,
    });

    const channel = res.items?.[0];
    if (!channel) return null;

    // Extract topic names from Wikipedia URLs
    const topicCategories = (channel.topicDetails?.topicCategories ?? []).map((url) => {
      const parts = url.split("/");
      return parts[parts.length - 1].replace(/_/g, " ");
    });

    return {
      channelId: channel.id,
      title: channel.snippet.title,
      description: channel.snippet.description,
      customUrl: channel.snippet.customUrl,
      country: channel.snippet.country,
      publishedAt: channel.snippet.publishedAt,
      thumbnailUrl: channel.snippet.thumbnails.high?.url ?? channel.snippet.thumbnails.medium?.url,
      subscriberCount: parseInt(channel.statistics.subscriberCount, 10) || 0,
      videoCount: parseInt(channel.statistics.videoCount, 10) || 0,
      totalViewCount: parseInt(channel.statistics.viewCount, 10) || 0,
      topicCategories,
    };
  }

  /**
   * Get details for multiple channels in a single API call.
   * YouTube Data API natively supports comma-separated channel IDs.
   */
  async getMultipleChannelDetails(channelIds: string[]): Promise<YouTubeChannelDetails[]> {
    if (channelIds.length === 0) return [];

    const res = await this.request<{ items?: YouTubeChannel[] }>("/channels", {
      part: "snippet,statistics,topicDetails",
      id: channelIds.join(","),
    });

    return (res.items ?? []).map((channel) => {
      const topicCategories = (channel.topicDetails?.topicCategories ?? []).map((url) => {
        const parts = url.split("/");
        return parts[parts.length - 1].replace(/_/g, " ");
      });

      return {
        channelId: channel.id,
        title: channel.snippet.title,
        description: channel.snippet.description,
        customUrl: channel.snippet.customUrl,
        country: channel.snippet.country,
        publishedAt: channel.snippet.publishedAt,
        thumbnailUrl: channel.snippet.thumbnails.high?.url ?? channel.snippet.thumbnails.medium?.url,
        subscriberCount: parseInt(channel.statistics.subscriberCount, 10) || 0,
        videoCount: parseInt(channel.statistics.videoCount, 10) || 0,
        totalViewCount: parseInt(channel.statistics.viewCount, 10) || 0,
        topicCategories,
      };
    });
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
