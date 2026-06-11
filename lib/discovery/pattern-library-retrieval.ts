// Pattern library retrieval — Layer 1 of Wave 14 Phase 2A.
//
// Given a brief (AOV bucket + product category), returns up to 10 prior
// campaigns the LLM should reason over as analogs at brief interpretation
// time. Phase 2A uses keyword matching (AOV bucket pre-filter + bidirectional
// case-insensitive substring on category). The embedding-based upgrade
// ships post-launch — the BriefInput signature is intentionally narrow so
// the call site at the interpretation endpoint doesn't move when retrieval
// evolves.
//
// Fail-soft contract matches lib/data/reasoning-log.ts and event-log.ts:
// empty library is a valid result, query errors return [], thrown
// exceptions return []. Never throws, never blocks the caller.

import { supabaseAdmin } from "@/lib/supabase/admin";
import type { AovBucket, CampaignPatternRow } from "@/lib/data/types";

const MAX_RESULTS = 10;
// Bound the in-app filter set. AOV bucket pre-filter already keeps this
// small in practice; the ceiling exists so a misconfigured library
// (thousands of rows in one bucket) doesn't pull megabytes.
const FETCH_CEILING = 100;

export interface BriefInput {
  aovBucket: AovBucket;
  category: string;
  /**
   * Exclude the calling campaign's own pattern rows — re-interpretation
   * after a brief edit must not cite the stale prior interpretation of the
   * same campaign as an analog.
   */
  excludeCampaignId?: string;
}

export async function retrieveAnalogCampaigns(
  brief: BriefInput
): Promise<CampaignPatternRow[]> {
  if (!brief?.aovBucket || !brief.category?.trim()) return [];

  try {
    let query = supabaseAdmin
      .from("campaign_patterns")
      .select("*")
      .eq("aov_bucket", brief.aovBucket);
    if (brief.excludeCampaignId) {
      // NULL-safe exclusion: seeded library rows have campaign_id NULL and
      // a bare .neq() would drop them (SQL NULL <> x is not true).
      query = query.or(
        `campaign_id.is.null,campaign_id.neq.${brief.excludeCampaignId}`
      );
    }
    const { data, error } = await query
      .order("created_at", { ascending: false })
      .limit(FETCH_CEILING);

    if (error || !data) {
      console.warn(
        "[pattern-library-retrieval.retrieveAnalogCampaigns] query failed:",
        error?.message
      );
      return [];
    }

    const briefCat = brief.category.toLowerCase().trim();
    const matches: CampaignPatternRow[] = [];
    for (const row of data as CampaignPatternRow[]) {
      const priorCat = readCategory(row.product_attributes);
      if (!priorCat) continue;
      if (priorCat.includes(briefCat) || briefCat.includes(priorCat)) {
        matches.push(row);
        if (matches.length === MAX_RESULTS) break;
      }
    }
    return matches;
  } catch (err) {
    console.warn(
      "[pattern-library-retrieval.retrieveAnalogCampaigns] threw:",
      err instanceof Error ? err.message : err
    );
    return [];
  }
}

function readCategory(
  attrs: Record<string, unknown> | null | undefined
): string {
  if (!attrs) return "";
  const cat = (attrs as { category?: unknown }).category;
  return typeof cat === "string" ? cat.toLowerCase().trim() : "";
}
