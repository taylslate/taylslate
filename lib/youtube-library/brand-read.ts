// Brand and agency read model for public YouTube channel fields.
// youtube_channels stays service_role only. Filter columns are selected
// here and stripped before anything is returned. Do not log the search
// text or a row.

import { supabaseAdmin } from "@/lib/supabase/admin";
import { libraryRowIsMadeForKids } from "./kids";
import { channelPassesLibraryFloors } from "./read";
import { isMissingLibraryTable, isMissingMadeForKidsColumn, statsFreshCutoff } from "./store";

export const LIBRARY_CREATOR_LIMIT = 20;
export const LIBRARY_CREATOR_FETCH = 60;
const SEARCH_MAX = 100;
const DESCRIPTION_MAX = 300;

/**
 * Public fields plus the columns the floors, the show link, and the
 * made-for-kids check need. topic_categories and made_for_kids are
 * selected here and stripped before anything is returned.
 * SAFE_COLUMNS_BEFORE_095 is the same list without made_for_kids, used
 * when migration 095 is not applied yet.
 */
export const SAFE_COLUMNS_BEFORE_095 =
  "channel_id, title, thumbnail_url, country, subscriber_count, video_count, avg_recent_views, niche_tags, description, total_view_count, avg_views_method, stats_refreshed_at, show_id, passed_market_filter, brand_flag, topic_categories";

export const SAFE_COLUMNS = `${SAFE_COLUMNS_BEFORE_095}, made_for_kids`;

const KIDS_SQL_FILTER = "made_for_kids.is.null,made_for_kids.eq.false";

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
  topic_categories?: unknown;
  made_for_kids?: unknown;
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

function readMadeForKids(value: unknown): boolean | null {
  if (value === true || value === "true") return true;
  if (value === false || value === "false") return false;
  return null;
}

function excludedAsKids(row: LibraryRow): boolean {
  return libraryRowIsMadeForKids({
    made_for_kids: readMadeForKids(row.made_for_kids),
    topic_categories: asTags(row.topic_categories),
    niche_tags: asTags(row.niche_tags),
  });
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

type BrandQuery = {
  eq: (column: string, value: unknown) => BrandQuery;
  is: (column: string, value: unknown) => BrandQuery;
  gte: (column: string, value: unknown) => BrandQuery;
  ilike: (column: string, pattern: string) => BrandQuery;
  or: (filters: string) => BrandQuery;
  order: (column: string, options?: { ascending?: boolean; nullsFirst?: boolean }) => BrandQuery;
  limit: (count: number) => BrandQuery;
  maybeSingle: () => PromiseLike<{ data: unknown; error: DbError }>;
  then: PromiseLike<{ data: unknown; error: DbError }>["then"];
};

function startBrandQuery(columns: string, filterKids: boolean): BrandQuery {
  let query = supabaseAdmin.from("youtube_channels").select(columns) as unknown as BrandQuery;
  if (filterKids) query = query.or(KIDS_SQL_FILTER);
  return query;
}

/**
 * Select with made_for_kids. If that column is not in the database yet,
 * retry without it. A missing table stays a miss. Adult rows still return.
 */
async function loadBrandRows(
  run: (columns: string, filterKids: boolean) => Promise<{ data: unknown; error: DbError }>
): Promise<"missing" | unknown> {
  const first = await run(SAFE_COLUMNS, true);
  if (!first.error) return first.data;
  if (isMissingMadeForKidsColumn(first.error)) {
    const second = await run(SAFE_COLUMNS_BEFORE_095, false);
    if (!second.error) return second.data;
    if (isMissingLibraryTable(second.error)) return "missing";
    failRead();
  }
  if (isMissingLibraryTable(first.error)) return "missing";
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
  const loaded = await loadBrandRows(async (columns, filterKids) => {
    const query = startBrandQuery(columns, filterKids)
      .eq("passed_market_filter", true)
      .is("brand_flag", null)
      .is("show_id", null)
      .gte("stats_refreshed_at", cutoff)
      .ilike("title", `%${escaped}%`)
      .order("avg_recent_views", { ascending: false, nullsFirst: false })
      .limit(LIBRARY_CREATOR_FETCH);
    return query;
  });
  if (loaded === "missing") return [];
  const rows = ((loaded ?? []) as LibraryRow[]).filter((row) => passesFloors(row) && !excludedAsKids(row));
  const open = await excludeLinked(rows);
  return open.slice(0, limit).map(toCreator);
}

export async function getLibraryCreator(
  channelId: string,
  now: Date = new Date()
): Promise<LibraryCreatorProfile | null> {
  if (!CHANNEL_ID.test(channelId)) return null;

  const cutoff = statsFreshCutoff(now);
  const loaded = await loadBrandRows(async (columns, filterKids) => {
    const query = startBrandQuery(columns, filterKids)
      .eq("channel_id", channelId)
      .eq("passed_market_filter", true)
      .is("brand_flag", null)
      .is("show_id", null)
      .gte("stats_refreshed_at", cutoff);
    return query.maybeSingle();
  });
  if (loaded === "missing") return null;
  const row = loaded as LibraryRow | null;
  if (!row || !passesFloors(row) || excludedAsKids(row)) return null;
  const open = await excludeLinked([row]);
  if (open.length === 0) return null;
  return toProfile(open[0]);
}
