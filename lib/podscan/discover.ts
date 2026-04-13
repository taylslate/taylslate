// ============================================================
// GET /podcasts/{id}/discover
// Multi-index vector similarity for podcast discovery.
// Finds shows similar across content, demographics, and commercial dimensions.
// ============================================================

import type { PodscanClient } from "./client";
import type { PodscanDiscoverResponse } from "./types";

export type DiscoverIndex = "content" | "demographics" | "commercial";

export interface DiscoverParams {
  /** Podscan podcast ID to find similar shows for */
  podcastId: string;
  /** Which similarity indices to query. Defaults to ["content"]. */
  indices?: DiscoverIndex[];
  /** Weights (0.0-1.0) for each index, same order as indices. Defaults to equal weights. */
  weights?: number[];
  /** Max results (1-50). Defaults to 20. */
  limit?: number;
}

/**
 * Discover podcasts similar to a given podcast using vector similarity.
 * Supports blending across content, demographics, and commercial indices.
 *
 * Example:
 * ```
 * const result = await discoverSimilar(client, {
 *   podcastId: "pd_abc123",
 *   indices: ["content", "demographics"],
 *   weights: [0.6, 0.4],
 *   limit: 30,
 * });
 * ```
 */
export async function discoverSimilar(
  client: PodscanClient,
  params: DiscoverParams
): Promise<PodscanDiscoverResponse> {
  const indices = params.indices ?? ["content"];
  const weights = params.weights ?? indices.map(() => 1.0 / indices.length);

  // Build query params — Podscan uses indices[] and weights[] array notation
  const queryParams: Record<string, string | number | boolean | undefined> = {
    limit: params.limit ?? 20,
  };

  // Add array params as repeated keys: indices[]=content&indices[]=demographics
  indices.forEach((idx, i) => {
    queryParams[`indices[${i}]`] = idx;
  });
  weights.forEach((w, i) => {
    queryParams[`weights[${i}]`] = w;
  });

  return client.get<PodscanDiscoverResponse>(
    `/podcasts/${params.podcastId}/discover`,
    queryParams
  );
}
