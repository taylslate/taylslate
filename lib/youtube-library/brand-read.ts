// Brand and agency read model for public YouTube channel fields.
// youtube_channels stays service_role only. Filter columns are selected
// here and stripped before anything is returned. Do not log the search
// text or a row.

import { supabaseAdmin } from "@/lib/supabase/admin";
import { channelPassesLibraryFloors } from "./read";
import { isMissingLibraryTable, statsFreshCutoff } from "./store";

export const LIBRARY_CREATOR_LIMIT = 20;
export const LIBRARY_CREATOR_FETCH = 60;
const SEARCH_MAX = 100;
const DESCRIPTION_MAX = 300;

/** Public fields plus the columns the floors and the show link need. */
export const SAFE_COLUMNS =
  "channel_id, title, thumbnail_url, country, subscriber_count, video_count, avg_recent_views, niche_tags, description, total_view_count, avg_views_method, stats_refreshed_at, show_id, passed_market_filter, brand_flag";

const CHANNEL_ID = /^UC[A-Za-z0-9_-]{22}$/;
const LIKE_ESCAPED = /\\([\\%_])/g;
const LIKE_SPECIAL = /[\\%_]/g;

export interface LibraryCreator {
  channelId: string;
  title: string;
  thumbnailUrl: string | null;
  country: string | null;
  subscriberCount: number | null;
  videoCount: number | null;
  averageViews: number | null;
  averageViewsLabel: "recent" | "average";
  nicheTags: string[];
  youtubeUrl: string;
}

export interface LibraryCreatorProfile extends LibraryCreator {
  description: string;
}

interface LibraryRow {
  channel_id?: unknown;
  title?: unknown;
  thumbnail_url?: unknown;
  country?: unknown;
  subscriber_count?: unknown;
  video_count?: unknown;
  avg_recent_views?: unknown;
  niche_tags?: unknown;
  description?: unknown;
  total_view_count?: unknown;
  avg_views_method?: unknown;
  show_id?: unknown;
  passed_market_filter?: unknown;
  brand_flag?: unknown;
}

type DbError = { message?: string; code?: string } | null;

function failRead(): never {
  throw new Error("Could not read library creators.");
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function asText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function asHttpUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return trimmed;
  } catch {
    return null;
  }
}

function asTags(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const tags: string[] = [];
  for (const tag of value) {
    if (typeof tag !== "string") continue;
    const trimmed = tag.trim();
    if (trimmed) tags.push(trimmed);
  }
  return tags;
}

function cutText(value: string, max: number): string {
  const chars = Array.from(value);
  if (chars.length <= max) return value;
  return chars.slice(0, max).join("");
}

function clampLimit(limit: number | undefined): number {
  if (limit == null || !Number.isFinite(limit)) return LIBRARY_CREATOR_LIMIT;
  return Math.min(LIBRARY_CREATOR_LIMIT, Math.max(0, Math.floor(limit)));
}

/**
 * Trim, drop every *, undo one escape pass so an already escaped term
 * is not escaped twice, cap at 100 characters, then escape \, %, and _.
 * PostgREST treats * as % and a backslash does not escape it.
 */
export function escapeLibrarySearch(raw: string): string {
  const stripped = raw.trim().replace(/\*/g, "");
  if (!stripped) return "";
  const plain = stripped.replace(LIKE_ESCAPED, "$1").slice(0, SEARCH_MAX);
  return plain.replace(LIKE_SPECIAL, (char) => `\\${char}`);
}

function passesFloors(row: LibraryRow): boolean {
  const channelId = typeof row.channel_id === "string" ? row.channel_id : "";
  if (!CHANNEL_ID.test(channelId)) return false;
  return channelPassesLibraryFloors({
    video_count: asNumber(row.video_count),
    total_view_count: asNumber(row.total_view_count),
    avg_recent_views: asNumber(row.avg_recent_views),
    avg_views_method: typeof row.avg_views_method === "string" ? row.avg_views_method : null,
  });
}

function toCreator(row: LibraryRow): LibraryCreator {
  const channelId = String(row.channel_id);
  return {
    channelId,
    title: asText(row.title) ?? "",
    thumbnailUrl: asHttpUrl(row.thumbnail_url),
    country: asText(row.country),
    subscriberCount: asNumber(row.subscriber_count),
    videoCount: asNumber(row.video_count),
    averageViews: asNumber(row.avg_recent_views),
    averageViewsLabel: row.avg_views_method === "recent" ? "recent" : "average",
    nicheTags: asTags(row.niche_tags),
    youtubeUrl: `https://www.youtube.com/channel/${channelId}`,
  };
}

function toProfile(row: LibraryRow): LibraryCreatorProfile {
  const description = typeof row.description === "string" ? row.description : "";
  return {
    ...toCreator(row),
    description: cutText(description, DESCRIPTION_MAX),
  };
}

async function excludeLinked(rows: LibraryRow[]): Promise<LibraryRow[]> {
  const ids = rows.map((row) => String(row.channel_id));
  if (ids.length === 0) return [];
  const { data, error } = await supabaseAdmin
    .from("shows")
    .select("youtube_channel_id")
    .in("youtube_channel_id", ids);
  if (error) failRead();
  const linked = new Set<string>();
  for (const show of data ?? []) {
    const id = (show as { youtube_channel_id?: unknown }).youtube_channel_id;
    if (typeof id === "string" && id) linked.add(id);
  }
  return rows.filter((row) => !linked.has(String(row.channel_id)));
}

function missingOrThrow(error: DbError): "missing" | null {
  if (!error) return null;
  if (isMissingLibraryTable(error)) return "missing";
  failRead();
}

export async function searchLibraryCreators(input: {
  query: string;
  limit?: number;
  now?: Date;
}): Promise<LibraryCreator[]> {
  const limit = clampLimit(input.limit);
  if (limit < 1) return [];
  const escaped = escapeLibrarySearch(input.query ?? "");
  if (!escaped) return [];

  const cutoff = statsFreshCutoff(input.now ?? new Date());
  const { data, error } = await supabaseAdmin
    .from("youtube_channels")
    .select(SAFE_COLUMNS)
    .eq("passed_market_filter", true)
    .is("brand_flag", null)
    .is("show_id", null)
    .gte("stats_refreshed_at", cutoff)
    .ilike("title", `%${escaped}%`)
    .order("avg_recent_views", { ascending: false, nullsFirst: false })
    .limit(LIBRARY_CREATOR_FETCH);

  if (missingOrThrow(error) === "missing") return [];
  const rows = ((data ?? []) as LibraryRow[]).filter(passesFloors);
  const open = await excludeLinked(rows);
  return open.slice(0, limit).map(toCreator);
}

export async function getLibraryCreator(
  channelId: string,
  now: Date = new Date()
): Promise<LibraryCreatorProfile | null> {
  if (!CHANNEL_ID.test(channelId)) return null;

  const cutoff = statsFreshCutoff(now);
  const { data, error } = await supabaseAdmin
    .from("youtube_channels")
    .select(SAFE_COLUMNS)
    .eq("channel_id", channelId)
    .eq("passed_market_filter", true)
    .is("brand_flag", null)
    .is("show_id", null)
    .gte("stats_refreshed_at", cutoff)
    .maybeSingle();

  if (missingOrThrow(error) === "missing") return null;
  const row = (data ?? null) as LibraryRow | null;
  if (!row || !passesFloors(row)) return null;
  const open = await excludeLinked([row]);
  if (open.length === 0) return null;
  return toProfile(open[0]);
}
