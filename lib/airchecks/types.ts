// Stored transcript for one IO line. Column names match public.airchecks
// (migration 038). Step 1 only — no match score, no pass/fail.

export type AircheckStatus = "pending" | "transcribed" | "failed";

export interface AircheckRow {
  id: string;
  io_line_item_id: string;
  episode_identifier: string | null;
  audio_url: string | null;
  transcript_text: string | null;
  provider: string | null;
  status: AircheckStatus;
  error: string | null;
  created_at: string;
  updated_at: string;
}

export interface AircheckWrite {
  io_line_item_id: string;
  episode_identifier: string | null;
  audio_url: string | null;
  transcript_text: string | null;
  provider: string | null;
  status: AircheckStatus;
  error: string | null;
}
