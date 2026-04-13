// ============================================================
// GET /episodes/{id}/engagement
// Listener engagement metrics per episode.
// Requires the paid listener engagement add-on ($100/month).
// Returns null gracefully when the add-on is not enabled (403).
// ============================================================

import type { PodscanClient } from "./client";
import type { PodscanEpisodeEngagement } from "./types";

/**
 * Get listener engagement data for a specific episode.
 * Includes completion rates, ad engagement, skip behavior,
 * geographic breakdowns, and podcast-level benchmarks.
 *
 * Returns null if the engagement add-on is not enabled (403)
 * or the episode has no engagement data (404).
 */
export async function getEpisodeEngagement(
  client: PodscanClient,
  episodeId: string
): Promise<PodscanEpisodeEngagement | null> {
  try {
    return await client.get<PodscanEpisodeEngagement>(
      `/episodes/${episodeId}/engagement`
    );
  } catch (err) {
    if (err instanceof Error && "status" in err) {
      const status = (err as { status: number }).status;
      // 403 = add-on not enabled, 404 = no data
      if (status === 403 || status === 404) {
        return null;
      }
    }
    throw err;
  }
}
