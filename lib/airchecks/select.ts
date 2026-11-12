// Booked IO spots whose air window is open. One row per line.
// A show with no booked line is never selected.

import { BOOKED_DEAL_STATUSES } from "@/lib/discovery/market-signals";
import { isMissingLibraryTable } from "@/lib/youtube-library/store";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { talkingPointsFromPitch } from "./locate";
import type { AircheckBuy } from "./types";
import {
  AIRCHECK_SPOTS_PER_RUN,
  airWindow,
  spotIsDue,
  utcDay,
  type AirWindow,
} from "./window";

/** Stop retrying a spot after this many stored failures. */
export const AIRCHECK_MAX_ATTEMPTS = 5;
/** First failure waits this long. Each later failure doubles the wait. */
export const AIRCHECK_FAIL_BACKOFF_MS = 6 * 60 * 60 * 1000;

export interface DueSpot {
  ioLineItemId: string;
  dealId: string;
  showId: string;
  format: "podcast" | "youtube";
  postDate: string;
  window: AirWindow;
  episodeUrl: string | null;
  placement: string | null;
  rssUrl: string | null;
  youtubeChannelId: string | null;
  buy: AircheckBuy;
  /** Failures already stored for this line. The next save adds one. */
  existingAttempt: number;
  /** A previous run failed. These sort after spots that have not failed. */
  priorFailure: boolean;
  /** Transcribed text already stored. The runner matches it and does not download again. */
  existingTranscript: string | null;
}

interface DealRow {
  id: string;
  status: string;
  cancelled_at: string | null;
  show_id: string;
  promo_code: string | null;
  brand_profile_id: string | null;
  outreach_id: string | null;
}

interface IoRow {
  id: string;
  deal_id: string;
  advertiser_name: string | null;
  status: string;
}

interface LineRow {
  id: string;
  io_id: string;
  format: string;
  post_date: string;
  episode_url: string | null;
  placement: string | null;
}

interface ShowRow {
  id: string;
  rss_url: string | null;
  youtube_channel_id: string | null;
}

interface BrandRow {
  id: string;
  brand_name: string | null;
  brand_website: string | null;
}

interface PitchRow {
  id: string;
  pitch_body: string | null;
}

interface AircheckExisting {
  io_line_item_id: string;
  status: string;
  transcript_text: string | null;
  ready_for_review: boolean | null;
  match_result: string | null;
  review_decision?: string | null;
  error?: string | null;
  updated_at?: string | null;
}

export function attemptCount(error: string | null | undefined, status: string | null | undefined): number {
  const match = /^attempt=(\d+);/.exec(error ?? "");
  if (match) return Number(match[1]);
  return status === "failed" ? 1 : 0;
}

function retryLater(row: AircheckExisting, nowMs: number): boolean {
  if (row.status !== "failed") return false;
  const attempts = attemptCount(row.error, row.status);
  if (attempts >= AIRCHECK_MAX_ATTEMPTS) return true;
  const updated = Date.parse(row.updated_at ?? "");
  if (!Number.isFinite(updated)) return false;
  const wait = AIRCHECK_FAIL_BACKOFF_MS * 2 ** Math.max(0, attempts - 1);
  return nowMs - updated < wait;
}

function names(...values: Array<string | null | undefined>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const trimmed = value?.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out;
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Caption channel order from migration 089 (`order by yc.channel_id limit 1`).
 * Live collation is ICU en_US.UTF-8, which is not JS byte order:
 * "UCa" sorts before "UCB" here, and the opposite under `<`.
 */
export function compareCaptionChannelId(a: string, b: string): number {
  return a.localeCompare(b, "en-US");
}

function libraryChannelByShow(
  rows: { show_id: string; channel_id: string }[]
): Map<string, string> {
  const sorted = rows
    .filter((row) => row.show_id && row.channel_id)
    .slice()
    .sort((a, b) => compareCaptionChannelId(a.channel_id, b.channel_id));
  const library = new Map<string, string>();
  for (const row of sorted) {
    if (!library.has(row.show_id)) library.set(row.show_id, row.channel_id);
  }
  return library;
}

export function buildDueSpots(input: {
  today: string;
  nowMs?: number;
  deals: DealRow[];
  ios: IoRow[];
  lines: LineRow[];
  shows: ShowRow[];
  brands: BrandRow[];
  pitches: PitchRow[];
  airchecks: AircheckExisting[];
  libraryChannels: { show_id: string; channel_id: string }[];
}): DueSpot[] {
  const today = utcDay(input.today);
  if (!today) return [];
  const nowMs = input.nowMs ?? Date.parse(`${today}T00:00:00.000Z`);
  const deals = new Map(
    input.deals
      .filter(
        (deal) =>
          BOOKED_DEAL_STATUSES.has(deal.status) &&
          !deal.cancelled_at &&
          deal.show_id
      )
      .map((deal) => [deal.id, deal])
  );
  const ios = new Map(
    input.ios
      .filter((io) => io.status !== "cancelled" && deals.has(io.deal_id))
      .map((io) => [io.id, io])
  );
  const shows = new Map(input.shows.map((show) => [show.id, show]));
  const brands = new Map(input.brands.map((brand) => [brand.id, brand]));
  const pitches = new Map(input.pitches.map((pitch) => [pitch.id, pitch]));
  const airchecks = new Map(
    input.airchecks.map((row) => [row.io_line_item_id, row])
  );
  const library = libraryChannelByShow(input.libraryChannels);

  const spots: DueSpot[] = [];
  for (const line of input.lines) {
    const io = ios.get(line.io_id);
    if (!io) continue;
    const deal = deals.get(io.deal_id);
    if (!deal) continue;
    const postDate = utcDay(line.post_date);
    if (!postDate || !spotIsDue(postDate, today)) continue;
    const window = airWindow(postDate);
    if (!window) continue;
    const existing = airchecks.get(line.id);
    if (existing?.ready_for_review) continue;
    if (existing?.review_decision === "confirmed" || existing?.review_decision === "rejected") {
      continue;
    }
    if (existing && retryLater(existing, nowMs)) continue;
    if (
      existing?.status === "transcribed" &&
      existing.transcript_text?.trim() &&
      (existing.match_result === "matched" || existing.match_result === "not_matched")
    ) {
      continue;
    }
    const format = line.format === "youtube" ? "youtube" : "podcast";
    const show = shows.get(deal.show_id);
    const brand = deal.brand_profile_id ? brands.get(deal.brand_profile_id) : undefined;
    const pitch = deal.outreach_id ? pitches.get(deal.outreach_id) : undefined;
    const channel =
      show?.youtube_channel_id?.trim() || library.get(deal.show_id) || null;
    const buy: AircheckBuy = {
      brandNames: names(io.advertiser_name, brand?.brand_name),
      promoCode: deal.promo_code?.trim() || null,
      url: brand?.brand_website?.trim() || null,
      placement: line.placement?.trim() || null,
      talkingPoints: talkingPointsFromPitch(pitch?.pitch_body),
    };
    spots.push({
      ioLineItemId: line.id,
      dealId: deal.id,
      showId: deal.show_id,
      format,
      postDate,
      window,
      episodeUrl: line.episode_url?.trim() || null,
      placement: line.placement?.trim() || null,
      rssUrl: show?.rss_url?.trim() || null,
      youtubeChannelId: channel,
      buy,
      existingAttempt: existing ? attemptCount(existing.error, existing.status) : 0,
      priorFailure: existing?.status === "failed",
      existingTranscript:
        existing?.status === "transcribed" && existing.transcript_text?.trim()
          ? existing.transcript_text
          : null,
    });
  }

  spots.sort((a, b) => {
    if (a.priorFailure !== b.priorFailure) return a.priorFailure ? 1 : -1;
    return a.postDate.localeCompare(b.postDate) || a.ioLineItemId.localeCompare(b.ioLineItemId);
  });
  return spots.slice(0, AIRCHECK_SPOTS_PER_RUN);
}

async function selectIn<T>(table: string, column: string, ids: string[], columns: string): Promise<T[]> {
  const rows: T[] = [];
  for (const group of chunk(ids, 100)) {
    if (group.length === 0) continue;
    const { data, error } = await supabaseAdmin.from(table).select(columns).in(column, group);
    if (error) throw new Error(`${table} lookup failed: ${error.message}`);
    rows.push(...((data ?? []) as T[]));
  }
  return rows;
}

export async function aircheckColumnsReady(): Promise<boolean> {
  const { error } = await supabaseAdmin
    .from("airchecks")
    .select("ready_for_review")
    .limit(1);
  if (!error) return true;
  const message = error.message ?? "";
  if (/ready_for_review|42703|PGRST204/i.test(message)) return false;
  throw new Error(`airchecks probe failed: ${message}`);
}

export async function loadDueSpots(now: Date): Promise<DueSpot[]> {
  const today = utcDay(now) ?? now.toISOString().slice(0, 10);
  const { data: dealRows, error: dealError } = await supabaseAdmin
    .from("deals")
    .select("id, status, cancelled_at, show_id, promo_code, brand_profile_id, outreach_id")
    .in("status", [...BOOKED_DEAL_STATUSES])
    .is("cancelled_at", null);
  if (dealError) throw new Error(`deals lookup failed: ${dealError.message}`);
  const deals = (dealRows ?? []) as DealRow[];
  if (deals.length === 0) return [];

  const ios = await selectIn<IoRow>(
    "insertion_orders",
    "deal_id",
    deals.map((deal) => deal.id),
    "id, deal_id, advertiser_name, status"
  );
  const lines = await selectIn<LineRow>(
    "io_line_items",
    "io_id",
    ios.map((io) => io.id),
    "id, io_id, format, post_date, episode_url, placement"
  );
  const showIds = [...new Set(deals.map((deal) => deal.show_id).filter(Boolean))];
  const shows = await selectIn<ShowRow>(
    "shows",
    "id",
    showIds,
    "id, rss_url, youtube_channel_id"
  );
  const brandIds = [
    ...new Set(deals.map((deal) => deal.brand_profile_id).filter((id): id is string => Boolean(id))),
  ];
  const brands = await selectIn<BrandRow>(
    "brand_profiles",
    "id",
    brandIds,
    "id, brand_name, brand_website"
  );
  const pitchIds = [
    ...new Set(deals.map((deal) => deal.outreach_id).filter((id): id is string => Boolean(id))),
  ];
  const pitches = await selectIn<PitchRow>("outreaches", "id", pitchIds, "id, pitch_body");
  const airchecks = await selectIn<AircheckExisting>(
    "airchecks",
    "io_line_item_id",
    lines.map((line) => line.id),
    "io_line_item_id, status, transcript_text, ready_for_review, match_result, review_decision, error, updated_at"
  );

  let libraryChannels: { show_id: string; channel_id: string }[] = [];
  if (showIds.length > 0) {
    try {
      libraryChannels = await selectIn<{ show_id: string; channel_id: string }>(
        "youtube_channels",
        "show_id",
        showIds,
        "show_id, channel_id"
      );
    } catch (err) {
      if (!isMissingLibraryTable(err)) throw err;
    }
  }

  return buildDueSpots({
    today,
    nowMs: now.getTime(),
    deals,
    ios,
    lines,
    shows,
    brands,
    pitches,
    airchecks,
    libraryChannels,
  });
}
