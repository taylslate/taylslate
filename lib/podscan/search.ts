// ============================================================
// GET /podcasts/search
// Full-text search for podcasts with filtering.
// ============================================================

import type { PodscanClient } from "./client";
import type { PodscanSearchResponse } from "./types";

export interface PodcastSearchParams {
  query?: string;
  categoryIds?: string;
  perPage?: number;
  page?: number;
  orderBy?:
    | "best_match"
    | "name"
    | "created_at"
    | "episode_count"
    | "rating"
    | "audience_size"
    | "last_posted_at";
  orderDir?: "asc" | "desc";
  searchFields?: string; // comma-separated: "name", "description", "website", "publisher_name"
  language?: string;
  region?: string;
  minAudienceSize?: number;
  maxAudienceSize?: number;
  minEpisodeCount?: number;
  maxEpisodeCount?: number;
  hasGuests?: boolean;
  hasSponsors?: boolean;
  minLastEpisodePostedAt?: string;
  maxLastEpisodePostedAt?: string;
}

/**
 * Search for podcasts by name, description, or other fields.
 * Returns paginated results with full podcast objects including reach data.
 */
export async function searchPodcasts(
  client: PodscanClient,
  params: PodcastSearchParams
): Promise<PodscanSearchResponse> {
  return client.get<PodscanSearchResponse>("/podcasts/search", {
    query: params.query,
    category_ids: params.categoryIds,
    per_page: params.perPage ?? 25,
    page: params.page,
    order_by: params.orderBy ?? "audience_size",
    order_dir: params.orderDir ?? "desc",
    search_fields: params.searchFields,
    language: params.language,
    region: params.region,
    min_audience_size: params.minAudienceSize,
    max_audience_size: params.maxAudienceSize,
    min_episode_count: params.minEpisodeCount,
    max_episode_count: params.maxEpisodeCount,
    has_guests: params.hasGuests,
    has_sponsors: params.hasSponsors,
    min_last_episode_posted_at: params.minLastEpisodePostedAt,
    max_last_episode_posted_at: params.maxLastEpisodePostedAt,
  });
}
