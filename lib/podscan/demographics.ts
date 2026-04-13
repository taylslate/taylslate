// ============================================================
// GET /podcasts/{id}/demographics
// Aggregated demographics from recent episodes.
// Premium+ endpoint.
// ============================================================

import type { PodscanClient } from "./client";
import type { PodscanDemographics } from "./types";

/**
 * Get aggregated demographics data for a podcast.
 * Includes gender skew, age distribution, purchasing power, education,
 * geography, professional industry, technology adoption, content consumption,
 * political leaning, family status, urban/rural, and brand affinity.
 *
 * Returns null if the podcast has no demographics data.
 */
export async function getPodcastDemographics(
  client: PodscanClient,
  podcastId: string
): Promise<PodscanDemographics | null> {
  try {
    return await client.get<PodscanDemographics>(
      `/podcasts/${podcastId}/demographics`
    );
  } catch (err) {
    // 404 = no demographics data available for this podcast
    if (err instanceof Error && "status" in err && (err as { status: number }).status === 404) {
      return null;
    }
    throw err;
  }
}
