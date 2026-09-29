// Stored transcript and match judgment for one IO line.
// Column names match public.airchecks (migrations 038 and 039).
// A match is data only: it does not mark the line delivered and does not charge.

export type AircheckStatus = "pending" | "transcribed" | "failed";

export type AircheckMatchResult = "matched" | "not_matched" | "skipped";

/** Whether one buy field showed up in the transcript. */
export type AircheckFieldCheck = "found" | "missing";

export interface AircheckMatchEvidence {
  excerpt: string | null;
  /** Set when the row was skipped. Null when the transcript was judged. */
  reason: string | null;
  brand: AircheckFieldCheck;
  code_or_url: AircheckFieldCheck;
  position: AircheckFieldCheck;
  /** No IO column stores read length, so this stays missing. */
  length: AircheckFieldCheck;
}

export interface AircheckRow {
  id: string;
  io_line_item_id: string;
  episode_identifier: string | null;
  audio_url: string | null;
  transcript_text: string | null;
  provider: string | null;
  status: AircheckStatus;
  error: string | null;
  match_result: AircheckMatchResult | null;
  match_evidence: AircheckMatchEvidence | null;
  matched_at: string | null;
  created_at: string;
  updated_at: string;
}

/** Transcript fields only. A retry must not clear a match written earlier in the same call. */
export interface AircheckWrite {
  io_line_item_id: string;
  episode_identifier: string | null;
  audio_url: string | null;
  transcript_text: string | null;
  provider: string | null;
  status: AircheckStatus;
  error: string | null;
}

/**
 * The buy a transcript is compared to. Assembled from columns that already
 * exist. Talking points are not stored anywhere on the line, the IO, or the
 * deal, so that field is null from the loader.
 */
export interface AircheckBuy {
  /** insertion_orders.advertiser_name and brand_profiles.brand_name. */
  brandNames: string[];
  /** deals.promo_code */
  promoCode: string | null;
  /** brand_profiles.brand_website — the URL a host would say. */
  url: string | null;
  /** io_line_items.placement: pre-roll, mid-roll, or post-roll. */
  placement: string | null;
  /** Not a column. Null unless a caller already has the script text. */
  talkingPoints: string | null;
}

export interface AircheckJudgment {
  match_result: AircheckMatchResult;
  match_evidence: AircheckMatchEvidence;
}
