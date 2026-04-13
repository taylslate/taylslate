// ============================================================
// GET /podcasts/rankings
// Podcasts ranked by Podscan Reach Score (PRS), 0-100.
// ============================================================

import type { PodscanClient } from "./client";
import type { PodscanRankingsResponse } from "./types";

export interface RankingsParams {
  /** Minimum PRS score (0-100). Default: 0. */
  minScore?: number;
  /** Maximum PRS score (0-100). Default: 100. */
  maxScore?: number;
  /** Sort order. Default: "desc" (highest first). */
  order?: "asc" | "desc";
  /** Max results (up to 1000). Default: 250. */
  limit?: number;
}

/**
 * Get podcasts ranked by Podscan Reach Score (PRS).
 * PRS is a 0-100 metric indicating potential reach and influence
 * based on ratings, reviews, and audience size.
 *
 * Includes global PRS distribution statistics.
 */
export async function getPodcastRankings(
  client: PodscanClient,
  params?: RankingsParams
): Promise<PodscanRankingsResponse> {
  return client.get<PodscanRankingsResponse>("/podcasts/rankings", {
    min_score: params?.minScore,
    max_score: params?.maxScore,
    order: params?.order ?? "desc",
    limit: params?.limit ?? 250,
  });
}
