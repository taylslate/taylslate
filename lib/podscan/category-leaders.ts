// ============================================================
// POST /category-leaders/search
// Top shows per category, ranked by Podscan Reach Score (PRS).
// Primary pool-building source for the scoring engine.
// Professional plan: up to 500 results per request.
// ============================================================

import type { PodscanClient } from "./client";
import type {
  PodscanCategoryLeaderSelection,
  PodscanCategoryLeadersResponse,
} from "./types";

export interface CategoryLeadersParams {
  /** One or more category selections to search across */
  selections: PodscanCategoryLeaderSelection[];
  /** Max results to return. Professional plan cap: 500. */
  limit?: number;
}

/**
 * Search for top podcasts in selected categories, ranked by PRS.
 * Categories can be Podscan categories, IAB categories, or chart categories.
 *
 * Example:
 * ```
 * const result = await searchCategoryLeaders(client, {
 *   selections: [
 *     { type: "category", id: "ct_abc123" },
 *     { type: "iab", id: "IAB1-1" },
 *   ],
 *   limit: 100,
 * });
 * ```
 */
export async function searchCategoryLeaders(
  client: PodscanClient,
  params: CategoryLeadersParams
): Promise<PodscanCategoryLeadersResponse> {
  return client.post<PodscanCategoryLeadersResponse>(
    "/category-leaders/search",
    {
      selections: params.selections,
      limit: params.limit ?? 500,
    }
  );
}
