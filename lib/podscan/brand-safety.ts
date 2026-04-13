// ============================================================
// GET /podcasts/{id}/brand-safety
// GARM brand safety assessment aggregated from recent episodes.
// 12 standard categories with risk levels and evidence.
// ============================================================

import type { PodscanClient } from "./client";
import type { PodscanBrandSafetyResponse } from "./types";

/**
 * Get detailed GARM brand safety assessment for a podcast.
 * Aggregated from typically the last 10 episodes with brand safety data.
 *
 * Per CLAUDE.md: brand safety is displayed as context but never used to
 * exclude shows from results. The brand decides.
 *
 * Returns null if the podcast has no brand safety data.
 */
export async function getPodcastBrandSafety(
  client: PodscanClient,
  podcastId: string
): Promise<PodscanBrandSafetyResponse | null> {
  try {
    return await client.get<PodscanBrandSafetyResponse>(
      `/podcasts/${podcastId}/brand-safety`
    );
  } catch (err) {
    if (err instanceof Error && "status" in err && (err as { status: number }).status === 404) {
      return null;
    }
    throw err;
  }
}
