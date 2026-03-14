// ============================================================
// PODSCAN API CLIENT
// REST client for Podscan.fm podcast intelligence API.
// Docs: https://podscan.fm/docs/api
// ============================================================

const PODSCAN_BASE_URL = "https://podscan.fm/api/v1";

// ---- Types ----

export interface PodscanPagination {
  total: number;
  per_page: number;
  current_page: number;
  last_page: number;
}

export interface PodscanPodcast {
  podcast_id: string;
  podcast_guid?: string;
  podcast_name: string;
  podcast_url?: string;
  podcast_description?: string;
  podcast_image_url?: string;
  podcast_categories?: string[];
  podcast_has_guests?: boolean;
  podcast_has_sponsors?: boolean;
  publisher_name?: string;
  reach?: number;
  podcast_reach_score?: number | null;
  rss_url?: string;
  rss_url_normalized?: string;
  is_active?: boolean;
  episode_count?: number;
  language?: string;
  region?: string;
  last_posted_at?: string;
  last_scanned_at?: string;
  created_at?: string;
  updated_at?: string;
}

export interface PodscanEpisode {
  episode_id: string;
  episode_guid?: string;
  episode_title: string;
  episode_description?: string;
  episode_url?: string;
  episode_image_url?: string;
  episode_duration?: number;
  posted_at?: string;
  transcription?: string;
  transcription_excerpt?: string;
  topics?: PodscanTopic[];
  // Nested podcast (when show_full_podcast=true)
  podcast_id?: string;
  podcast_name?: string;
  podcast_url?: string;
  podcast?: PodscanPodcast;
}

export interface PodscanTopic {
  topic_id: string;
  topic_name: string;
  topic_name_normalized?: string;
}

export interface PodscanEntity {
  entity_id: string;
  name: string;
  type: "person" | "organization" | "place" | "thing";
  company?: string;
  occupation?: string;
  industry?: string;
  description?: string;
  total_appearances?: number;
  hosts_count?: number;
  guests_count?: number;
  mentions_count?: number;
  sponsors_count?: number;
}

export interface PodscanEntityAppearance {
  episode_id: string;
  episode_title: string;
  podcast_id: string;
  podcast_name: string;
  role: "host" | "guest" | "sponsor" | "producer" | "mention";
  posted_at?: string;
}

export interface PodscanChartEntry {
  rank: number;
  podcast_id: string;
  podcast_name: string;
  publisher_name?: string;
  movement?: number;
}

// ---- Error Handling ----

export class PodscanError extends Error {
  constructor(
    message: string,
    public status: number,
    public rateLimitRemaining?: number
  ) {
    super(message);
    this.name = "PodscanError";
  }
}

// ---- Client ----

export class PodscanClient {
  private apiKey: string;

  constructor(apiKey?: string) {
    const key = apiKey ?? process.env.PODSCAN_API_KEY;
    if (!key) {
      throw new Error("PODSCAN_API_KEY is not set");
    }
    this.apiKey = key;
  }

  // ---- Private Helpers ----

  private async request<T>(
    path: string,
    params?: Record<string, string | number | boolean | undefined>,
    retries = 2
  ): Promise<T> {
    const url = new URL(`${PODSCAN_BASE_URL}${path}`);
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== "") {
          url.searchParams.set(key, String(value));
        }
      }
    }

    const res = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      next: { revalidate: 3600 }, // Cache for 1 hour
    });

    if (res.status === 429 && retries > 0) {
      // Rate limited — wait and retry (Podscan trial: 10 req/min)
      const retryAfter = res.headers.get("Retry-After");
      const waitMs = retryAfter ? parseInt(retryAfter, 10) * 1000 : 7000;
      await new Promise((resolve) => setTimeout(resolve, waitMs));
      return this.request<T>(path, params, retries - 1);
    }

    if (!res.ok) {
      const rateLimitRemaining = res.headers.get("X-RateLimit-Remaining");
      throw new PodscanError(
        `Podscan API error: ${res.status} ${res.statusText}`,
        res.status,
        rateLimitRemaining ? parseInt(rateLimitRemaining, 10) : undefined
      );
    }

    return res.json() as Promise<T>;
  }

  // ---- Podcast Search ----

  /**
   * Search for podcasts by querying episode transcripts and metadata.
   * Returns episodes with full podcast data attached.
   * This is the primary way to find podcasts in Podscan — there is no
   * dedicated /podcasts/search endpoint.
   */
  async searchPodcasts(options: {
    query: string;
    perPage?: number;
    categoryIds?: string;
    podcastLanguage?: string;
    minAudienceSize?: number;
    maxAudienceSize?: number;
    hasSponsors?: boolean;
    orderBy?: "best_match" | "created_at" | "posted_at" | "podcast_rating";
  }): Promise<{ data: PodscanEpisode[]; pagination: PodscanPagination }> {
    const res = await this.request<{
      data: PodscanEpisode[];
      pagination: PodscanPagination;
    }>("/episodes/search", {
      query: options.query,
      per_page: options.perPage ?? 10,
      show_full_podcast: true,
      exclude_transcript: true, // Save bandwidth — we just want podcast metadata
      category_ids: options.categoryIds,
      podcast_language: options.podcastLanguage,
      min_podcast_audience_size: options.minAudienceSize,
      max_podcast_audience_size: options.maxAudienceSize,
      has_sponsors: options.hasSponsors,
      order_by: options.orderBy ?? "best_match",
      show_only_fully_processed: true,
    });
    return res;
  }

  /**
   * Search for a specific podcast by name. Returns the best-matching
   * podcast data by searching episode titles for the show name.
   */
  async findPodcastByName(
    name: string
  ): Promise<PodscanPodcast | null> {
    const res = await this.searchPodcasts({
      query: name,
      perPage: 5,
      orderBy: "best_match",
    });

    if (!res.data || res.data.length === 0) return null;

    // Find the episode whose podcast name best matches the query
    const normalizedQuery = name.toLowerCase().trim();
    const match = res.data.find((ep) => {
      const podName = (ep.podcast?.podcast_name ?? ep.podcast_name ?? "")
        .toLowerCase()
        .trim();
      return podName === normalizedQuery || podName.includes(normalizedQuery);
    });

    if (match?.podcast) return match.podcast;
    // Fallback: return first result's podcast
    const first = res.data[0];
    return first.podcast ?? null;
  }

  // ---- Episode Transcript Search ----

  /**
   * Full-text search across episode transcripts.
   * Useful for finding brand mentions, ad reads, and sponsor segments.
   */
  async searchTranscripts(options: {
    query: string;
    podcastIds?: string;
    perPage?: number;
    since?: string;
    before?: string;
    searchFields?: string; // "transcription" | "title" | "description"
    minDuration?: number;
    maxDuration?: number;
    hasSponsors?: boolean;
  }): Promise<{ data: PodscanEpisode[]; pagination: PodscanPagination }> {
    const res = await this.request<{
      data: PodscanEpisode[];
      pagination: PodscanPagination;
    }>("/episodes/search", {
      query: options.query,
      podcast_ids: options.podcastIds,
      per_page: options.perPage ?? 10,
      since: options.since,
      before: options.before,
      search_fields: options.searchFields ?? "transcription",
      min_duration: options.minDuration,
      max_duration: options.maxDuration,
      has_sponsors: options.hasSponsors,
      show_full_podcast: true,
      remove_speaker_labels: false,
      transcript_formatter: "paragraph",
    });
    return res;
  }

  // ---- Sponsor Detection ----

  /**
   * Detect sponsors for a podcast by searching for entities with the
   * "sponsor" role that have appeared on the show.
   */
  async getSponsorsForPodcast(
    podcastId: string
  ): Promise<PodscanEntity[]> {
    // Get recent episodes, then pull entities from them
    const episodes = await this.request<{
      data: PodscanEpisode[];
      pagination: PodscanPagination;
    }>("/episodes/search", {
      podcast_ids: podcastId,
      per_page: 20,
      show_full_podcast: false,
      exclude_transcript: true,
      order_by: "posted_at",
      order_dir: "desc",
      has_sponsors: true,
      show_only_fully_processed: true,
    });

    if (!episodes.data || episodes.data.length === 0) return [];

    // Pull sponsor entities from each episode
    const sponsorMap = new Map<string, PodscanEntity>();
    for (const ep of episodes.data.slice(0, 10)) {
      try {
        const entities = await this.request<{
          sponsors?: PodscanEntity[];
        }>(`/episodes/${ep.episode_id}/entities`, {
          role: "sponsor",
        });
        if (entities.sponsors) {
          for (const sponsor of entities.sponsors) {
            if (!sponsorMap.has(sponsor.entity_id)) {
              sponsorMap.set(sponsor.entity_id, sponsor);
            }
          }
        }
      } catch {
        // Skip episodes that error — rate limits, etc.
        continue;
      }
    }

    return Array.from(sponsorMap.values());
  }

  /**
   * Search for a specific brand/entity across all podcasts.
   * Returns entity details with appearance counts.
   */
  async searchEntity(options: {
    query: string;
    type?: "person" | "organization" | "place" | "thing";
    role?: "host" | "guest" | "sponsor" | "producer" | "mention";
    minAppearances?: number;
    perPage?: number;
  }): Promise<{ data: PodscanEntity[]; pagination: PodscanPagination }> {
    const res = await this.request<{
      data: PodscanEntity[];
      pagination: PodscanPagination;
    }>("/entities/search", {
      query: options.query,
      type: options.type,
      role: options.role,
      min_appearances: options.minAppearances,
      per_page: options.perPage ?? 25,
      order_by: "best_match",
    });
    return res;
  }

  /**
   * Get all appearances for an entity — useful for finding which podcasts
   * a brand has sponsored.
   */
  async getEntityAppearances(
    entityId: string,
    options?: {
      role?: "host" | "guest" | "sponsor" | "producer" | "mention";
      from?: string;
      to?: string;
      podcastId?: string;
    }
  ): Promise<{ data: PodscanEntityAppearance[] }> {
    const res = await this.request<{
      data: PodscanEntityAppearance[];
    }>(`/entities/${entityId}/appearances`, {
      role: options?.role,
      from: options?.from,
      to: options?.to,
      podcast_id: options?.podcastId,
    });
    return res;
  }

  // ---- Contact Info ----

  /**
   * Retrieve host/producer entities for a podcast, which may include
   * contact-adjacent info (name, company, occupation).
   * Podscan doesn't expose direct email/phone — contact info comes from
   * entity metadata and RSS publisher fields.
   */
  async getShowContacts(
    podcastId: string
  ): Promise<{ hosts: PodscanEntity[]; producers: PodscanEntity[] }> {
    // Get a recent episode to pull host/producer entities
    const episodes = await this.request<{
      data: PodscanEpisode[];
    }>("/episodes/search", {
      podcast_ids: podcastId,
      per_page: 1,
      exclude_transcript: true,
      show_only_fully_processed: true,
      order_by: "posted_at",
      order_dir: "desc",
    });

    if (!episodes.data || episodes.data.length === 0) {
      return { hosts: [], producers: [] };
    }

    const ep = episodes.data[0];
    try {
      const entities = await this.request<{
        hosts?: PodscanEntity[];
        producers?: PodscanEntity[];
      }>(`/episodes/${ep.episode_id}/entities`);
      return {
        hosts: entities.hosts ?? [],
        producers: entities.producers ?? [],
      };
    } catch {
      return { hosts: [], producers: [] };
    }
  }

  // ---- Charts & Rankings ----

  /**
   * Get chart rankings for a country/category — useful for identifying
   * trending shows to add to the database.
   */
  async getCharts(
    platform: "apple" | "spotify",
    countryCode: string,
    category: string,
    options?: { limit?: number }
  ): Promise<PodscanChartEntry[]> {
    const res = await this.request<PodscanChartEntry[]>(
      `/charts/${platform}/${countryCode}/${category}/top`,
      { limit: options?.limit ?? 50 }
    );
    return res;
  }

  /**
   * Get trending podcasts in a country.
   */
  async getTrending(
    countryCode: string = "us"
  ): Promise<
    {
      podcast_id: string;
      podcast_name: string;
      trending_score: number;
      platform: string;
      best_category: string;
    }[]
  > {
    const res = await this.request<
      {
        podcast_id: string;
        podcast_name: string;
        trending_score: number;
        platform: string;
        best_category: string;
      }[]
    >(`/charts/countries/${countryCode}/trending`);
    return res;
  }

  // ---- Categories ----

  async getCategories(): Promise<
    { category_id: string; category_name: string; category_display_name: string }[]
  > {
    const res = await this.request<
      { category_id: string; category_name: string; category_display_name: string }[]
    >("/categories");
    return res;
  }

  // ---- Recent Episodes ----

  /**
   * Get recently published episodes, optionally filtered by podcast.
   * Useful for checking if a show is still active.
   */
  async getRecentEpisodes(options?: {
    podcastIds?: string;
    since?: string;
    limit?: number;
    categoryIds?: string;
    hasSponsors?: boolean;
  }): Promise<{ data: PodscanEpisode[] }> {
    const res = await this.request<{ data: PodscanEpisode[] }>(
      "/episodes/recent",
      {
        podcast_ids: options?.podcastIds,
        since: options?.since,
        limit: options?.limit ?? 10,
        category_ids: options?.categoryIds,
        has_sponsors: options?.hasSponsors,
        exclude_transcript: true,
        show_full_podcast: true,
      }
    );
    return res;
  }
}

// ---- Singleton ----

let _client: PodscanClient | null = null;

export function getPodscanClient(): PodscanClient {
  if (!_client) {
    _client = new PodscanClient();
  }
  return _client;
}

/**
 * Safe version that returns null instead of throwing if the API key is missing.
 */
export function getPodscanClientSafe(): PodscanClient | null {
  if (!process.env.PODSCAN_API_KEY) {
    console.log("PODSCAN_API_KEY not configured — skipping Podscan enrichment");
    return null;
  }
  return getPodscanClient();
}

// ---- Helper: getPodcastDetails ----

/**
 * Convenience wrapper that finds a podcast by name and returns
 * full details including sponsors and contacts.
 */
export async function getPodcastDetails(client: PodscanClient, name: string): Promise<{
  podcast: PodscanPodcast | null;
  sponsors: PodscanEntity[];
  hosts: PodscanEntity[];
}> {
  const podcast = await client.findPodcastByName(name);
  if (!podcast) return { podcast: null, sponsors: [], hosts: [] };

  const [sponsorResult, contactResult] = await Promise.allSettled([
    client.getSponsorsForPodcast(podcast.podcast_id),
    client.getShowContacts(podcast.podcast_id),
  ]);

  return {
    podcast,
    sponsors: sponsorResult.status === "fulfilled" ? sponsorResult.value : [],
    hosts: contactResult.status === "fulfilled" ? contactResult.value.hosts : [],
  };
}
