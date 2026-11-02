// Service-role writes for one automated aircheck. The upsert key is
// io_line_item_id. Payment columns and io_line_items.verified are not written.

import { supabaseAdmin } from "@/lib/supabase/admin";
import type { AircheckMatchEvidence, AircheckMatchResult, AircheckSegment, AircheckStatus } from "./types";

export interface AircheckPersist {
  io_line_item_id: string;
  episode_identifier?: string | null;
  audio_url?: string | null;
  transcript_text?: string | null;
  provider?: string | null;
  status: AircheckStatus;
  error: string | null;
  transcript_segments?: AircheckSegment[] | null;
  duration_seconds?: number | null;
  audio_minutes?: number | null;
  estimated_cost_usd?: number | null;
  window_start?: string | null;
  window_end?: string | null;
  ready_for_review?: boolean;
  confidence?: number | null;
  ad_start_seconds?: number | null;
  ad_end_seconds?: number | null;
  match_reasons?: string[] | null;
  match_result?: AircheckMatchResult | null;
  match_evidence?: AircheckMatchEvidence | null;
  matched_at?: string | null;
}

export async function saveAircheckRun(row: AircheckPersist): Promise<{ id: string }> {
  const { data, error } = await supabaseAdmin
    .from("airchecks")
    .upsert(row, { onConflict: "io_line_item_id" })
    .select("id")
    .single();
  if (error || !data) {
    throw new Error(`aircheck save failed: ${error?.message ?? "no row returned"}`);
  }
  return { id: (data as { id: string }).id };
}
