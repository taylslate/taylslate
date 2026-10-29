// Service-role access to youtube_channels and youtube_pull_queue.
// A missing table is YoutubeLibraryTableMissing. Callers no-op.
// This module never inserts a shows row.

import { UPLOADS_STATS_UNITS, type YouTubeChannelDetails } from "@/lib/enrichment/youtube";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { linkResolvesToChannel } from "./seeds";
import { deterministicNicheTags, filterNicheTags, NICHE_TAGS_VERSION } from "./tags";

export const YOUTUBE_STATS_MAX_AGE_DAYS = 30;
export const YOUTUBE_LIBRARY_PULL_BUDGET = 8000;
export const SEARCH_UNITS = 100;
export const CHANNELS_LIST_UNITS = 1;
export { UPLOADS_STATS_UNITS };

export type AvgViewsMethod = "uploads" | "estimate" | "recent" | "estimated";

const AVG_VIEWS_METHODS = new Set<string>(["uploads", "estimate", "recent", "estimated"]);

/** True when one uploads-playlist read (2 units) still fits in the budget. */
export function uploadsStatsAffordable(unitsSpent: number, budget: number): boolean {
  return unitsSpent + UPLOADS_STATS_UNITS <= budget;
}

const MISSING_RELATION = /does not exist|schema cache|42P01|PGRST205|could not find the table/i;

export class YoutubeLibraryTableMissing extends Error {
  constructor() {
    super("youtube library tables are not available");
    this.name = "YoutubeLibraryTableMissing";
  }
}

export function isMissingLibraryTable(err: unknown): boolean {
  if (err instanceof YoutubeLibraryTableMissing) return true;
  const message = err instanceof Error ? err.message : String(err ?? "");
  const code = (err as { code?: string } | null)?.code ?? "";
  return code === "42P01" || code === "PGRST205" || MISSING_RELATION.test(message);
}

export function statsFreshCutoff(now: Date): string {
  return new Date(now.getTime() - YOUTUBE_STATS_MAX_AGE_DAYS * 24 * 60 * 60 * 1000).toISOString();
}

export function libraryConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

export type YoutubeChannelSource = "category" | "seed" | "discovery";
export type QueueKind = "category_query" | "seed_channel";
export type QueueStatus = "pending" | "done" | "error";

export interface YoutubeChannelRecord {
  channel_id: string;
  title: string | null;
  description: string | null;
  thumbnail_url: string | null;
  country: string | null;
  default_language: string | null;
  subscriber_count: number | null;
  video_count: number | null;
  total_view_count: number | null;
  avg_recent_views: number | null;
  avg_views_method: AvgViewsMethod | null;
  topic_categories: string[];
  keywords: string[];
  niche_tags: string[];
  niche_tags_version: number;
  tagged_at: string | null;
  passed_market_filter: boolean;
  brand_flag: string | null;
  show_id: string | null;
  source: YoutubeChannelSource;
  source_query: string | null;
  first_seen_at: string;
  stats_refreshed_at: string;
  created_at: string;
  updated_at: string;
  custom_url?: string | null;
}

export interface ChannelDraft {
  details: YouTubeChannelDetails;
  passedMarketFilter: boolean;
  brandFlag: string | null;
  source: YoutubeChannelSource;
  sourceQuery: string | null;
  averageViews?: number | null;
  /** "uploads" when the playlist measurement is real. "estimate" on fallback. */
  viewsMethod?: "uploads" | "estimate" | null;
  now: string;
}

export interface QueueItem {
  id: string;
  kind: QueueKind;
  value: string;
  status: QueueStatus;
  attempts: number;
  last_error: string | null;
  done_at: string | null;
}

export interface ShowLinkCandidate {
  id: string;
  platform: string | null;
  youtube_channel_id: string | null;
  surfaces: {
    youtube?: {
      youtube_channel_id?: string | null;
      links?: { channel?: string | null };
    };
  } | null;
}

export interface YoutubeLibraryStore {
  ensureReady(): Promise<void>;
  enqueue(items: { kind: QueueKind; value: string }[]): Promise<number>;
  pendingQueue(): Promise<QueueItem[]>;
  markQueueDone(id: string, at: string): Promise<void>;
  markQueueAttempt(id: string, attempts: number, error: string, status: "pending" | "error"): Promise<void>;
  getChannel(channelId: string): Promise<YoutubeChannelRecord | null>;
  saveChannel(record: YoutubeChannelRecord): Promise<"inserted" | "updated">;
  uniqueShowId(channelId: string, customUrl?: string | null): Promise<string | null>;
  oldestChannels(limit: number): Promise<YoutubeChannelRecord[]>;
  deleteChannels(ids: string[]): Promise<void>;
  nullStaleYoutubeFields(channelId: string): Promise<void>;
  listStale(cutoffIso: string): Promise<{ channel_id: string; show_id: string | null }[]>;
  listEligible(cutoffIso: string): Promise<YoutubeChannelRecord[]>;
  listNeedsTags(limit: number, version: number): Promise<YoutubeChannelRecord[]>;
  saveTags(channelId: string, tags: string[], version: number, taggedAt: string): Promise<void>;
}

export function emptyYoutubeFields(): Pick<
  YoutubeChannelRecord,
  | "title"
  | "description"
  | "thumbnail_url"
  | "country"
  | "default_language"
  | "subscriber_count"
  | "video_count"
  | "total_view_count"
  | "avg_recent_views"
  | "avg_views_method"
  | "topic_categories"
  | "keywords"
  | "passed_market_filter"
  | "brand_flag"
> {
  return {
    title: null,
    description: null,
    thumbnail_url: null,
    country: null,
    default_language: null,
    subscriber_count: null,
    video_count: null,
    total_view_count: null,
    avg_recent_views: null,
    avg_views_method: null,
    topic_categories: [],
    keywords: [],
    passed_market_filter: false,
    brand_flag: null,
  };
}

/**
 * One show id, or null. A direct youtube_channel_id match counts.
 * A podcast show also counts when its stored YouTube link resolves to
 * this channel. Zero matches and two or more matches stay unlinked.
 */
export function pickUniqueShowId(
  channelId: string,
  customUrl: string | null | undefined,
  shows: ShowLinkCandidate[]
): string | null {
  const ids = new Set<string>();
  for (const show of shows) {
    if (show.youtube_channel_id && show.youtube_channel_id === channelId) ids.add(show.id);
    const surfaceId = show.surfaces?.youtube?.youtube_channel_id;
    if (surfaceId && surfaceId === channelId) ids.add(show.id);
    const platform = (show.platform ?? "").toLowerCase();
    const link = show.surfaces?.youtube?.links?.channel;
    if (platform === "podcast" && link && linkResolvesToChannel(link, channelId, customUrl)) {
      ids.add(show.id);
    }
  }
  if (ids.size !== 1) return null;
  return [...ids][0];
}

function asCount(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  return Math.round(value);
}

export function draftToRecord(
  existing: YoutubeChannelRecord | null,
  draft: ChannelDraft,
  showId: string | null
): YoutubeChannelRecord {
  const details = draft.details;
  const videos = details.videoCount;
  const hasMeasured = typeof draft.averageViews === "number" && Number.isFinite(draft.averageViews);
  const estimated = videos > 0 ? Math.round(details.totalViewCount / videos) : null;
  const measured = hasMeasured ? Math.round(draft.averageViews as number) : null;
  // uploads: playlist measurement. estimate: this call fell back.
  // estimated: no uploads call (older rows, or the 2 units did not fit).
  // Migration 074's check allows only recent and estimated. uploads and
  // estimate need that check widened before a hosted write can succeed.
  let avg: number | null;
  let method: AvgViewsMethod | null;
  if (draft.viewsMethod === "uploads" && measured != null) {
    avg = measured;
    method = "uploads";
  } else if (draft.viewsMethod === "estimate" || (draft.viewsMethod === "uploads" && measured == null)) {
    avg = estimated;
    method = estimated == null ? null : "estimate";
  } else if (measured != null) {
    avg = measured;
    method = "uploads";
  } else {
    avg = estimated;
    method = estimated == null ? null : "estimated";
  }
  const deterministic = deterministicNicheTags({
    topicCategories: details.topicCategories,
    keywords: details.keywords,
  });
  const alreadyTagged =
    existing != null &&
    existing.niche_tags_version >= NICHE_TAGS_VERSION &&
    existing.tagged_at != null;
  const nicheTags = alreadyTagged
    ? filterNicheTags([...(existing?.niche_tags ?? []), ...deterministic])
    : deterministic;
  const taggedAt = alreadyTagged
    ? existing.tagged_at
    : nicheTags.length > 0
      ? draft.now
      : null;
  const version = alreadyTagged
    ? existing.niche_tags_version
    : nicheTags.length > 0
      ? NICHE_TAGS_VERSION
      : 0;

  return {
    channel_id: details.channelId,
    title: details.title ?? null,
    description: details.description ?? null,
    thumbnail_url: details.thumbnailUrl ?? null,
    country: details.country ?? null,
    default_language: details.defaultLanguage ?? null,
    subscriber_count: asCount(details.subscriberCount),
    video_count: asCount(details.videoCount),
    total_view_count: asCount(details.totalViewCount),
    avg_recent_views: avg,
    avg_views_method: method,
    topic_categories: [...(details.topicCategories ?? [])],
    keywords: [...(details.keywords ?? [])],
    niche_tags: nicheTags,
    niche_tags_version: version,
    tagged_at: taggedAt,
    passed_market_filter: draft.passedMarketFilter,
    brand_flag: draft.brandFlag,
    show_id: showId,
    source: existing?.source ?? draft.source,
    source_query: existing?.source_query ?? draft.sourceQuery,
    first_seen_at: existing?.first_seen_at ?? draft.now,
    stats_refreshed_at: draft.now,
    created_at: existing?.created_at ?? draft.now,
    updated_at: draft.now,
    custom_url: details.customUrl ?? existing?.custom_url ?? null,
  };
}

function pendingInEnqueueOrder(items: QueueItem[]): QueueItem[] {
  return items.filter((row) => row.status === "pending");
}

export function createMemoryYoutubeStore(shows: ShowLinkCandidate[] = []): YoutubeLibraryStore & {
  channels: Map<string, YoutubeChannelRecord>;
  queue: QueueItem[];
  shows: ShowLinkCandidate[];
} {
  const channels = new Map<string, YoutubeChannelRecord>();
  const queue: QueueItem[] = [];
  let queueSeq = 0;

  return {
    channels,
    queue,
    shows,
    async ensureReady() {},
    async enqueue(items) {
      let inserted = 0;
      for (const item of items) {
        const value = item.value.trim();
        if (!value) continue;
        if (queue.some((row) => row.kind === item.kind && row.value === value)) continue;
        queueSeq += 1;
        queue.push({
          id: `q-${queueSeq}`,
          kind: item.kind,
          value,
          status: "pending",
          attempts: 0,
          last_error: null,
          done_at: null,
        });
        inserted += 1;
      }
      return inserted;
    },
    async pendingQueue() {
      return pendingInEnqueueOrder(queue);
    },
    async markQueueDone(id, at) {
      const row = queue.find((item) => item.id === id);
      if (!row) return;
      row.status = "done";
      row.done_at = at;
      row.last_error = null;
    },
    async markQueueAttempt(id, attempts, error, status) {
      const row = queue.find((item) => item.id === id);
      if (!row) return;
      row.attempts = attempts;
      row.last_error = error;
      row.status = status;
    },
    async getChannel(channelId) {
      return channels.get(channelId) ?? null;
    },
    async saveChannel(record) {
      const inserted = !channels.has(record.channel_id);
      channels.set(record.channel_id, { ...record });
      return inserted ? "inserted" : "updated";
    },
    async uniqueShowId(channelId, customUrl) {
      return pickUniqueShowId(channelId, customUrl, shows);
    },
    async oldestChannels(limit) {
      return [...channels.values()]
        .sort((a, b) => a.stats_refreshed_at.localeCompare(b.stats_refreshed_at) || a.channel_id.localeCompare(b.channel_id))
        .slice(0, limit);
    },
    async deleteChannels(ids) {
      for (const id of ids) channels.delete(id);
    },
    async nullStaleYoutubeFields(channelId) {
      const row = channels.get(channelId);
      if (!row) return;
      channels.set(channelId, { ...row, ...emptyYoutubeFields(), updated_at: row.updated_at });
    },
    async listStale(cutoffIso) {
      return [...channels.values()]
        .filter((row) => row.stats_refreshed_at < cutoffIso)
        .map((row) => ({ channel_id: row.channel_id, show_id: row.show_id }));
    },
    async listEligible(cutoffIso) {
      return [...channels.values()].filter(
        (row) =>
          row.passed_market_filter &&
          !row.brand_flag &&
          row.stats_refreshed_at >= cutoffIso
      );
    },
    async listNeedsTags(limit, version) {
      return [...channels.values()]
        .filter((row) => row.niche_tags_version < version || row.tagged_at == null)
        .sort((a, b) => a.channel_id.localeCompare(b.channel_id))
        .slice(0, limit);
    },
    async saveTags(channelId, tags, version, taggedAt) {
      const row = channels.get(channelId);
      if (!row) return;
      channels.set(channelId, {
        ...row,
        niche_tags: filterNicheTags(tags),
        niche_tags_version: version,
        tagged_at: taggedAt,
        updated_at: taggedAt,
      });
    },
  };
}

type DbError = { message?: string; code?: string } | null;

function throwIfMissing(error: DbError): void {
  if (!error) return;
  if (isMissingLibraryTable(error)) throw new YoutubeLibraryTableMissing();
  throw new Error(error.message || "youtube library query failed");
}

function asRecord(row: Record<string, unknown>): YoutubeChannelRecord {
  const method = row.avg_views_method;
  return {
    channel_id: String(row.channel_id),
    title: (row.title as string | null) ?? null,
    description: (row.description as string | null) ?? null,
    thumbnail_url: (row.thumbnail_url as string | null) ?? null,
    country: (row.country as string | null) ?? null,
    default_language: (row.default_language as string | null) ?? null,
    subscriber_count: row.subscriber_count == null ? null : Number(row.subscriber_count),
    video_count: row.video_count == null ? null : Number(row.video_count),
    total_view_count: row.total_view_count == null ? null : Number(row.total_view_count),
    avg_recent_views: row.avg_recent_views == null ? null : Number(row.avg_recent_views),
    avg_views_method:
      typeof method === "string" && AVG_VIEWS_METHODS.has(method) ? (method as AvgViewsMethod) : null,
    topic_categories: Array.isArray(row.topic_categories) ? (row.topic_categories as string[]) : [],
    keywords: Array.isArray(row.keywords) ? (row.keywords as string[]) : [],
    niche_tags: Array.isArray(row.niche_tags) ? (row.niche_tags as string[]) : [],
    niche_tags_version: Number(row.niche_tags_version ?? 0),
    tagged_at: (row.tagged_at as string | null) ?? null,
    passed_market_filter: Boolean(row.passed_market_filter),
    brand_flag: (row.brand_flag as string | null) ?? null,
    show_id: (row.show_id as string | null) ?? null,
    source: row.source as YoutubeChannelSource,
    source_query: (row.source_query as string | null) ?? null,
    first_seen_at: String(row.first_seen_at),
    stats_refreshed_at: String(row.stats_refreshed_at),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

function toDbRow(record: YoutubeChannelRecord): Record<string, unknown> {
  return {
    channel_id: record.channel_id,
    title: record.title,
    description: record.description,
    thumbnail_url: record.thumbnail_url,
    country: record.country,
    default_language: record.default_language,
    subscriber_count: record.subscriber_count,
    video_count: record.video_count,
    total_view_count: record.total_view_count,
    avg_recent_views: record.avg_recent_views,
    avg_views_method: record.avg_views_method,
    topic_categories: record.topic_categories,
    keywords: record.keywords,
    niche_tags: record.niche_tags,
    niche_tags_version: record.niche_tags_version,
    tagged_at: record.tagged_at,
    passed_market_filter: record.passed_market_filter,
    brand_flag: record.brand_flag,
    show_id: record.show_id,
    source: record.source,
    source_query: record.source_query,
    first_seen_at: record.first_seen_at,
    stats_refreshed_at: record.stats_refreshed_at,
    created_at: record.created_at,
    updated_at: record.updated_at,
  };
}

const CHANNEL_COLUMNS =
  "channel_id, title, description, thumbnail_url, country, default_language, subscriber_count, video_count, total_view_count, avg_recent_views, avg_views_method, topic_categories, keywords, niche_tags, niche_tags_version, tagged_at, passed_market_filter, brand_flag, show_id, source, source_query, first_seen_at, stats_refreshed_at, created_at, updated_at";

export function createSupabaseYoutubeStore(): YoutubeLibraryStore {
  return {
    async ensureReady() {
      const { error } = await supabaseAdmin.from("youtube_channels").select("channel_id").limit(1);
      throwIfMissing(error);
      const queue = await supabaseAdmin.from("youtube_pull_queue").select("id").limit(1);
      throwIfMissing(queue.error);
    },
    async enqueue(items) {
      if (items.length === 0) return 0;
      const base = Date.now();
      const rows = items
        .map((item, index) => ({
          kind: item.kind,
          value: item.value.trim(),
          status: "pending" as const,
          attempts: 0,
          created_at: new Date(base + index).toISOString(),
        }))
        .filter((item) => item.value);
      if (rows.length === 0) return 0;
      const { data, error } = await supabaseAdmin
        .from("youtube_pull_queue")
        .upsert(rows, { onConflict: "kind,value", ignoreDuplicates: true })
        .select("id");
      throwIfMissing(error);
      return data?.length ?? 0;
    },
    async pendingQueue() {
      const { data, error } = await supabaseAdmin
        .from("youtube_pull_queue")
        .select("id, kind, value, status, attempts, last_error, done_at")
        .eq("status", "pending")
        .order("created_at", { ascending: true })
        .order("id", { ascending: true });
      throwIfMissing(error);
      return (data ?? []) as QueueItem[];
    },
    async markQueueDone(id, at) {
      const { error } = await supabaseAdmin
        .from("youtube_pull_queue")
        .update({ status: "done", done_at: at, last_error: null })
        .eq("id", id);
      throwIfMissing(error);
    },
    async markQueueAttempt(id, attempts, errorMessage, status) {
      const { error } = await supabaseAdmin
        .from("youtube_pull_queue")
        .update({ attempts, last_error: errorMessage.slice(0, 500), status })
        .eq("id", id);
      throwIfMissing(error);
    },
    async getChannel(channelId) {
      const { data, error } = await supabaseAdmin
        .from("youtube_channels")
        .select(CHANNEL_COLUMNS)
        .eq("channel_id", channelId)
        .maybeSingle();
      throwIfMissing(error);
      return data ? asRecord(data as Record<string, unknown>) : null;
    },
    async saveChannel(record) {
      const existing = await this.getChannel(record.channel_id);
      const { error } = await supabaseAdmin
        .from("youtube_channels")
        .upsert(toDbRow(record), { onConflict: "channel_id" });
      throwIfMissing(error);
      return existing ? "updated" : "inserted";
    },
    async uniqueShowId(channelId, customUrl) {
      const shows = await loadShowLinkCandidates(channelId, customUrl);
      return pickUniqueShowId(channelId, customUrl, shows);
    },
    async oldestChannels(limit) {
      const { data, error } = await supabaseAdmin
        .from("youtube_channels")
        .select(CHANNEL_COLUMNS)
        .order("stats_refreshed_at", { ascending: true })
        .order("channel_id", { ascending: true })
        .limit(limit);
      throwIfMissing(error);
      return (data ?? []).map((row) => asRecord(row as Record<string, unknown>));
    },
    async deleteChannels(ids) {
      if (ids.length === 0) return;
      const { error } = await supabaseAdmin.from("youtube_channels").delete().in("channel_id", ids);
      throwIfMissing(error);
    },
    async nullStaleYoutubeFields(channelId) {
      const blank = emptyYoutubeFields();
      const { error } = await supabaseAdmin
        .from("youtube_channels")
        .update({ ...blank, topic_categories: [], keywords: [] })
        .eq("channel_id", channelId);
      throwIfMissing(error);
    },
    async listStale(cutoffIso) {
      const rows: { channel_id: string; show_id: string | null }[] = [];
      const page = 1000;
      for (let from = 0; from < 50000; from += page) {
        const { data, error } = await supabaseAdmin
          .from("youtube_channels")
          .select("channel_id, show_id, stats_refreshed_at")
          .lt("stats_refreshed_at", cutoffIso)
          .order("channel_id", { ascending: true })
          .range(from, from + page - 1);
        throwIfMissing(error);
        const batch = data ?? [];
        for (const row of batch) {
          rows.push({
            channel_id: String(row.channel_id),
            show_id: (row.show_id as string | null) ?? null,
          });
        }
        if (batch.length < page) break;
      }
      return rows;
    },
    async listEligible(cutoffIso) {
      const rows: YoutubeChannelRecord[] = [];
      const page = 1000;
      for (let from = 0; from < 50000; from += page) {
        const { data, error } = await supabaseAdmin
          .from("youtube_channels")
          .select(CHANNEL_COLUMNS)
          .eq("passed_market_filter", true)
          .is("brand_flag", null)
          .gte("stats_refreshed_at", cutoffIso)
          .order("channel_id", { ascending: true })
          .range(from, from + page - 1);
        throwIfMissing(error);
        const batch = data ?? [];
        rows.push(...batch.map((row) => asRecord(row as Record<string, unknown>)));
        if (batch.length < page) break;
      }
      return rows;
    },
    async listNeedsTags(limit, version) {
      const { data, error } = await supabaseAdmin
        .from("youtube_channels")
        .select(CHANNEL_COLUMNS)
        .or(`niche_tags_version.lt.${version},tagged_at.is.null`)
        .order("channel_id", { ascending: true })
        .limit(limit);
      throwIfMissing(error);
      return (data ?? []).map((row) => asRecord(row as Record<string, unknown>));
    },
    async saveTags(channelId, tags, version, taggedAt) {
      const { error } = await supabaseAdmin
        .from("youtube_channels")
        .update({
          niche_tags: filterNicheTags(tags),
          niche_tags_version: version,
          tagged_at: taggedAt,
          updated_at: taggedAt,
        })
        .eq("channel_id", channelId);
      throwIfMissing(error);
    },
  };
}

async function loadShowLinkCandidates(
  channelId: string,
  customUrl?: string | null
): Promise<ShowLinkCandidate[]> {
  const select = "id, platform, youtube_channel_id, surfaces";
  const byId = await supabaseAdmin
    .from("shows")
    .select(select)
    .eq("youtube_channel_id", channelId)
    .limit(5);
  throwIfMissing(byId.error);

  const bySurface = await supabaseAdmin
    .from("shows")
    .select(select)
    .filter("surfaces->youtube->>youtube_channel_id", "eq", channelId)
    .limit(5);
  throwIfMissing(bySurface.error);

  const byLink = await supabaseAdmin
    .from("shows")
    .select(select)
    .eq("platform", "podcast")
    .filter("surfaces->youtube->links->>channel", "ilike", `%${channelId}%`)
    .limit(5);
  throwIfMissing(byLink.error);

  const batches = [byId.data ?? [], bySurface.data ?? [], byLink.data ?? []];
  const handle = customUrl?.trim().replace(/^@/, "");
  if (handle && handle.length >= 3 && !/[%_,]/.test(handle)) {
    const byHandle = await supabaseAdmin
      .from("shows")
      .select(select)
      .eq("platform", "podcast")
      .filter("surfaces->youtube->links->>channel", "ilike", `%@${handle}%`)
      .limit(5);
    throwIfMissing(byHandle.error);
    batches.push(byHandle.data ?? []);
  }

  const seen = new Set<string>();
  const shows: ShowLinkCandidate[] = [];
  for (const batch of batches) {
    for (const row of batch) {
      const id = String((row as { id: string }).id);
      if (seen.has(id)) continue;
      seen.add(id);
      const record = row as {
        id: string;
        platform: string | null;
        youtube_channel_id: string | null;
        surfaces: ShowLinkCandidate["surfaces"];
      };
      shows.push({
        id: record.id,
        platform: record.platform,
        youtube_channel_id: record.youtube_channel_id,
        surfaces: record.surfaces,
      });
    }
  }
  return shows;
}

let supabaseStore: YoutubeLibraryStore | null = null;

export function getYoutubeLibraryStore(): YoutubeLibraryStore {
  if (!supabaseStore) supabaseStore = createSupabaseYoutubeStore();
  return supabaseStore;
}
