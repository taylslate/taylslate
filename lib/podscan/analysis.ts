// ============================================================
// GET /podcasts/{id}/analysis
// Podcast analysis: guest history, sponsor history, hosts.
// Key for sponsor retention scoring in Wave 5.
// ============================================================

import type { PodscanClient } from "./client";
import type { PodscanAnalysisResponse } from "./types";

/**
 * Get analysis data for a podcast including:
 * - Guest history (up to 50 most frequent guests with episode counts)
 * - Sponsor history (up to 50 most frequent sponsors with episode counts)
 * - Hosts
 * - Catchup summary from most recent episode
 *
 * Sponsor episode_count is the strongest conversion proxy until
 * Taylslate has its own transaction data (per CLAUDE.md).
 */
export async function getPodcastAnalysis(
  client: PodscanClient,
  podcastId: string
): Promise<PodscanAnalysisResponse | null> {
  try {
    return await client.get<PodscanAnalysisResponse>(
      `/podcasts/${podcastId}/analysis`
    );
  } catch (err) {
    if (err instanceof Error && "status" in err && (err as { status: number }).status === 404) {
      return null;
    }
    throw err;
  }
}
