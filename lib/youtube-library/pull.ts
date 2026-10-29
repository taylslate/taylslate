// Daily category and seed pull. Stops at YOUTUBE_LIBRARY_PULL_BUDGET
// (8,000 units) or at YOUTUBE_LIBRARY_PULL_TIME_BUDGET_MS (240 seconds),
// and leaves the rest of the queue pending. search.list is 100.
// channels.list is 1 per batch of 50. playlistItems.list is 1 per channel.
// videos.list is 1 per batch of 50 video ids. The API key is never logged.

import { readFileSync } from "node:fs";
import {
  chunk,
  getYouTubeClientSafe,
  UPLOADS_STATS_MAX_RESULTS,
  YOUTUBE_CALL_TIMEOUT_MS,
  YOUTUBE_IDS_PER_CALL,
  type YouTubeChannelDetails,
  type YouTubeClient,
} from "@/lib/enrichment/youtube";
import { passesYouTubeMarketFilter, youtubeBrandMatch } from "@/lib/discovery/discover-shows";
import { redactSecretParams } from "@/lib/discovery/redact-secrets";
import { categoryQueueValues } from "./categories";
import { parseChannelRef, parseYoutubeSeedCsv, YOUTUBE_SEEDS_PATH } from "./seeds";
import {
  CHANNELS_LIST_UNITS,
  draftToRecord,
  getYoutubeLibraryStore,
  isMissingLibraryTable,
  SEARCH_UNITS,
  UPLOADS_STATS_UNITS,
  YoutubeLibraryTableMissing,
  YOUTUBE_LIBRARY_PULL_BUDGET,
  type ChannelDraft,
  type QueueItem,
  type YoutubeChannelRecord,
  type YoutubeLibraryStore,
} from "./store";

export { SEARCH_UNITS, CHANNELS_LIST_UNITS, YOUTUBE_LIBRARY_PULL_BUDGET, UPLOADS_STATS_UNITS };

const MAX_ATTEMPTS = 3;
const YOUTUBE_API_BASE = "https://www.googleapis.com/youtube/v3";
/** Stop starting new work at 240 seconds so the 300 second function limit is not hit. */
export const YOUTUBE_LIBRARY_PULL_TIME_BUDGET_MS = 240_000;
const CHANNEL_CHUNK_SIZE = 10;
const READ_CONCURRENCY = 4;
const STATS_FRESH_MS = 24 * 60 * 60 * 1000;

export type UploadsStatsFetch =
  | { kind: "skip" }
  | { kind: "uploads"; averageViews: number }
  | { kind: "estimate" };

export interface UploadsBatchFetch {
  results: UploadsStatsFetch[];
  playlistCalls: number;
  videoListCalls: number;
}

export interface LibraryYoutubeApi {
  search(query: string): Promise<string[]>;
  list(ids: string[]): Promise<{ found: YouTubeChannelDetails[]; missing: string[] }>;
  seedLookupCost(value: string): number;
  lookupSeed(value: string): Promise<{ channelId: string | null; notFound: boolean }>;
  /** Uploads-playlist recent views. 2 units when it does not return skip. Refresh still uses this. */
  recentUploads?(channelId: string): Promise<UploadsStatsFetch>;
  /** Pull path. One playlist call per channel, then videos.list in groups of 50. */
  recentUploadsBatch?(channelIds: string[]): Promise<UploadsBatchFetch>;
}

export interface YoutubePullReport {
  skipped: boolean;
  reason?: "missing_table" | "no_api_key";
  seeded: number;
  units: number;
  upserted: number;
  done: number;
  pending: number;
  stopped: "budget" | "quota" | "time" | null;
  elapsedMs: number;
  searched: number;
  chunks: number;
}

export function scrubYoutubeError(err: unknown): Error {
  const message = err instanceof Error ? err.message : "";
  const status = message.match(/YouTube API error (\d{3})/)?.[1] ?? "";
  const reason = message.match(/\b(quotaExceeded|dailyLimitExceeded|rateLimitExceeded)\b/)?.[1] ?? "";
  if (!status) return new Error("YouTube API error");
  return new Error(`YouTube API error ${status}${reason ? `: ${reason}` : ""}`);
}

/** Stored and logged text. A key query value is removed. A status is kept. */
export function queueErrorText(message: string): string {
  const redacted = redactSecretParams(message);
  if (/timed out/i.test(redacted)) return "YouTube call timed out";
  if (/YouTube API error \d{3}/.test(redacted)) {
    return redactSecretParams(scrubYoutubeError(new Error(redacted)).message).slice(0, 500);
  }
  return redacted.slice(0, 500);
}

export function isQuotaError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : "";
  return /\b(quotaExceeded|dailyLimitExceeded)\b/.test(message);
}

export function isNotFoundError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : "";
  return /YouTube API error 404\b/.test(message);
}

/**
 * Worst case for one stats chunk: one playlistItems.list per channel,
 * plus videos.list calls for 15 uploads each, packed at 50 ids.
 */
export function uploadsBatchWorstCaseUnits(channelCount: number): number {
  if (channelCount <= 0) return 0;
  const videoCalls = Math.ceil((channelCount * UPLOADS_STATS_MAX_RESULTS) / YOUTUBE_IDS_PER_CALL);
  return channelCount + videoCalls;
}

/** Run `worker` over `items` with at most `limit` in flight. Output matches input order. */
export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  if (items.length === 0) return results;
  let cursor = 0;
  const runners = Math.min(Math.max(1, limit), items.length);
  async function run(): Promise<void> {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: runners }, () => run()));
  return results;
}

export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("YouTube call timed out")), ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

function rethrowYoutube(err: unknown): never {
  const message = err instanceof Error ? err.message : "";
  if (/timed out/i.test(message)) throw new Error("YouTube call timed out");
  throw scrubYoutubeError(err);
}

function uniqueIds(ids: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const id of ids) {
    const trimmed = id.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

function extractReason(body: unknown): string {
  if (!body || typeof body !== "object") return "";
  const reason = (body as { error?: { errors?: { reason?: string }[] } }).error?.errors?.[0]?.reason ?? "";
  return /^[A-Za-z0-9_]{1,64}$/.test(reason) ? reason : "";
}

async function youtubeGet(
  path: string,
  params: Record<string, string>,
  timeoutMs: number
): Promise<{ status: number; body: unknown }> {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) throw new Error("YOUTUBE_API_KEY is not set");
  const url = new URL(`${YOUTUBE_API_BASE}${path}`);
  url.searchParams.set("key", key);
  for (const [name, value] of Object.entries(params)) {
    if (value) url.searchParams.set(name, value);
  }
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error("YouTube call timed out"));
    }, timeoutMs);
  });
  try {
    const work = (async () => {
      const res = await fetch(url.toString(), { signal: controller.signal });
      const text = await res.text();
      let body: unknown = null;
      if (text) {
        try {
          body = JSON.parse(text);
        } catch {
          body = null;
        }
      }
      if (!res.ok) {
        const reason = extractReason(body);
        throw new Error(`YouTube API error ${res.status}${reason ? `: ${reason}` : ""}`);
      }
      return { status: res.status, body };
    })();
    work.catch(() => undefined);
    return await Promise.race([work, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function toUploadsFetch(method: string, meanViews: number): UploadsStatsFetch {
  if (method === "uploads") return { kind: "uploads", averageViews: meanViews };
  return { kind: "estimate" };
}

export function createLibraryYoutubeApi(client?: YouTubeClient | null): LibraryYoutubeApi {
  const youtube = client === undefined ? getYouTubeClientSafe() : client;

  return {
    async search(query: string) {
      if (!youtube) throw new Error("YOUTUBE_API_KEY is not set");
      try {
        const hits = await withTimeout(youtube.searchVideos(query, 50, "relevance"), YOUTUBE_CALL_TIMEOUT_MS);
        return uniqueIds(hits.map((hit) => hit.channelId));
      } catch (err) {
        rethrowYoutube(err);
      }
    },
    async list(ids: string[]) {
      if (!youtube) throw new Error("YOUTUBE_API_KEY is not set");
      if (ids.length === 0) return { found: [], missing: [] };
      try {
        const found = await withTimeout(youtube.getMultipleChannelDetails(ids), YOUTUBE_CALL_TIMEOUT_MS);
        const present = new Set(found.map((row) => row.channelId));
        return { found, missing: ids.filter((id) => !present.has(id)) };
      } catch (err) {
        rethrowYoutube(err);
      }
    },
    seedLookupCost(value: string) {
      const parsed = parseChannelRef(value);
      if (!parsed) return 0;
      return parsed.kind === "id" ? 0 : CHANNELS_LIST_UNITS;
    },
    async recentUploads(channelId: string) {
      if (!youtube || typeof youtube.recentUploadsStats !== "function") {
        return { kind: "skip" as const };
      }
      try {
        const stats = await withTimeout(youtube.recentUploadsStats(channelId), YOUTUBE_CALL_TIMEOUT_MS);
        if (stats.method === "uploads") {
          return { kind: "uploads" as const, averageViews: stats.meanViews };
        }
        return { kind: "estimate" as const };
      } catch (err) {
        const message = err instanceof Error ? err.message : "unknown error";
        throw new Error(redactSecretParams(message));
      }
    },
    async recentUploadsBatch(channelIds: string[]) {
      if (!youtube || typeof youtube.recentUploadsStatsBatch !== "function" || channelIds.length === 0) {
        return {
          results: channelIds.map(() => ({ kind: "skip" as const })),
          playlistCalls: 0,
          videoListCalls: 0,
        };
      }
      try {
        const batch = await youtube.recentUploadsStatsBatch(channelIds);
        return {
          results: batch.results.map((stats) => toUploadsFetch(stats.method, stats.meanViews)),
          playlistCalls: batch.playlistCalls,
          videoListCalls: batch.videoListCalls,
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : "unknown error";
        throw new Error(redactSecretParams(message));
      }
    },
    async lookupSeed(value: string) {
      const parsed = parseChannelRef(value);
      if (!parsed) return { channelId: null, notFound: true };
      if (parsed.kind === "id") return { channelId: parsed.value, notFound: false };
      const params: Record<string, string> =
        parsed.kind === "handle"
          ? { part: "id", forHandle: parsed.value }
          : { part: "id", forUsername: parsed.value };
      try {
        const { body } = await youtubeGet("/channels", params, YOUTUBE_CALL_TIMEOUT_MS);
        const id = (body as { items?: { id?: string }[] } | null)?.items?.[0]?.id?.trim() ?? "";
        if (!id) return { channelId: null, notFound: true };
        return { channelId: id, notFound: false };
      } catch (err) {
        const message = err instanceof Error ? err.message : "";
        if (/timed out/i.test(message)) throw new Error("YouTube call timed out");
        const scrubbed = scrubYoutubeError(err);
        if (isNotFoundError(scrubbed)) return { channelId: null, notFound: true };
        throw scrubbed;
      }
    },
  };
}

export function seedQueueItems(csvText: string): { kind: "category_query" | "seed_channel"; value: string }[] {
  const categories = categoryQueueValues().map((value) => ({ kind: "category_query" as const, value }));
  const seeds = parseYoutubeSeedCsv(csvText).map((value) => ({ kind: "seed_channel" as const, value }));
  return [...categories, ...seeds];
}

export function readSeedCsvText(): string {
  try {
    return readFileSync(YOUTUBE_SEEDS_PATH, "utf8");
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return "channel_url,channel_id\n";
    throw err;
  }
}

function statsAreFresh(row: YoutubeChannelRecord | null | undefined, nowMs: number): boolean {
  if (!row?.avg_views_method) return false;
  const refreshed = Date.parse(row.stats_refreshed_at);
  if (!Number.isFinite(refreshed)) return false;
  return nowMs - refreshed <= STATS_FRESH_MS;
}

async function failItem(
  store: YoutubeLibraryStore,
  item: QueueItem,
  message: string,
  log: (line: string) => void
): Promise<void> {
  const safe = queueErrorText(message);
  log(`[youtube-library] queue item failed: ${safe}`);
  const attempts = item.attempts + 1;
  await store.markQueueAttempt(item.id, attempts, safe, attempts >= MAX_ATTEMPTS ? "error" : "pending");
}

async function processChunk(input: {
  store: YoutubeLibraryStore;
  api: LibraryYoutubeApi;
  found: YouTubeChannelDetails[];
  source: ChannelDraft["source"];
  sourceQuery: string;
  now: string;
  clock: () => number;
  unitsLeft: number;
  log: (line: string) => void;
}): Promise<{ upserted: number; units: number; stopped: "budget" | null }> {
  if (input.found.length === 0) return { upserted: 0, units: 0, stopped: null };

  const ids = input.found.map((details) => details.channelId);
  const existingRows = await input.store.getChannels(ids);
  const existingById = new Map(existingRows.map((row) => [row.channel_id, row]));
  const nowMs = input.clock();
  const needsStats = input.found.filter((details) => !statsAreFresh(existingById.get(details.channelId), nowMs));
  const canStats = typeof input.api.recentUploadsBatch === "function";
  const worst = canStats ? uploadsBatchWorstCaseUnits(needsStats.length) : 0;
  if (worst > 0 && input.unitsLeft < worst) {
    return { upserted: 0, units: 0, stopped: "budget" };
  }

  const showIds = await mapLimit(input.found, READ_CONCURRENCY, async (details) => {
    try {
      return await input.store.uniqueShowId(details.channelId, details.customUrl);
    } catch (err) {
      if (isMissingLibraryTable(err)) throw err;
      return null;
    }
  });

  const statsById = new Map<string, UploadsStatsFetch>();
  let units = 0;
  if (needsStats.length > 0 && canStats) {
    try {
      const batch = await input.api.recentUploadsBatch!(needsStats.map((details) => details.channelId));
      units += batch.playlistCalls + batch.videoListCalls;
      needsStats.forEach((details, index) => {
        statsById.set(details.channelId, batch.results[index] ?? { kind: "estimate" });
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "unknown error";
      const safe = queueErrorText(message);
      input.log(`[youtube-library] uploads stats failed: ${safe}`);
      units += worst;
      for (const details of needsStats) statsById.set(details.channelId, { kind: "estimate" });
    }
  }

  const rows = input.found.map((details, index) => {
    const existing = existingById.get(details.channelId) ?? null;
    const fresh = statsAreFresh(existing, nowMs);
    const draft: ChannelDraft = {
      details,
      passedMarketFilter: passesYouTubeMarketFilter(details),
      brandFlag: youtubeBrandMatch(details),
      source: input.source,
      sourceQuery: input.sourceQuery,
      now: input.now,
    };
    const stats = statsById.get(details.channelId);
    if (!fresh && stats && stats.kind !== "skip") {
      if (stats.kind === "uploads") {
        draft.averageViews = stats.averageViews;
        draft.viewsMethod = "recent";
      } else {
        draft.viewsMethod = "estimated";
      }
    }
    const record = draftToRecord(existing, draft, showIds[index]);
    if (fresh && existing) {
      record.avg_recent_views = existing.avg_recent_views;
      record.avg_views_method = existing.avg_views_method;
      record.stats_refreshed_at = existing.stats_refreshed_at;
    }
    return { record, existing };
  });

  await mapLimit(rows, READ_CONCURRENCY, async (row) => {
    await input.store.saveChannel(row.record, row.existing);
  });
  return { upserted: rows.length, units, stopped: null };
}

/**
 * Work pending queue rows until the unit budget or the time budget is spent.
 * category_query uses video search (100) then channels.list batches (1 each).
 * seed_channel resolves a handle or URL, then fetches details. A row that
 * does not finish stays pending. A time stop is a normal result.
 */
export async function runPullQueue(input: {
  store: YoutubeLibraryStore;
  api: LibraryYoutubeApi;
  budget?: number;
  now?: Date;
  csvText?: string;
  seed?: boolean;
  log?: (line: string) => void;
  /** Epoch ms. Default is the clock at start plus YOUTUBE_LIBRARY_PULL_TIME_BUDGET_MS. */
  deadlineMs?: number;
  /** Injectable clock. Default is Date.now. */
  clock?: () => number;
  callTimeoutMs?: number;
}): Promise<YoutubePullReport> {
  const budget = input.budget ?? YOUTUBE_LIBRARY_PULL_BUDGET;
  const clock = input.clock ?? Date.now;
  const startedMs = clock();
  const deadlineMs = input.deadlineMs ?? startedMs + YOUTUBE_LIBRARY_PULL_TIME_BUDGET_MS;
  const pastDeadline = () => clock() >= deadlineMs;
  const recordNow = (input.now ?? new Date(startedMs)).toISOString();
  const log = input.log ?? ((line: string) => console.log(line));
  const callTimeoutMs = input.callTimeoutMs ?? YOUTUBE_CALL_TIMEOUT_MS;
  let seeded = 0;
  if (input.seed !== false) {
    seeded = await input.store.enqueue(seedQueueItems(input.csvText ?? readSeedCsvText()));
  }

  let units = 0;
  let upserted = 0;
  let done = 0;
  let searched = 0;
  let chunks = 0;
  let stopped: YoutubePullReport["stopped"] = null;
  const left = () => budget - units;

  const pending = await input.store.pendingQueue();
  for (const item of pending) {
    if (stopped) break;
    if (pastDeadline()) {
      stopped = "time";
      break;
    }

    if (item.kind === "category_query") {
      if (left() < SEARCH_UNITS) {
        stopped = "budget";
        break;
      }
      if (pastDeadline()) {
        stopped = "time";
        break;
      }
      let ids: string[];
      try {
        ids = await withTimeout(input.api.search(item.value), callTimeoutMs);
        units += SEARCH_UNITS;
        searched += 1;
      } catch (err) {
        units += SEARCH_UNITS;
        searched += 1;
        if (isQuotaError(err)) {
          stopped = "quota";
          break;
        }
        await failItem(input.store, item, err instanceof Error ? err.message : "YouTube API error", log);
        continue;
      }

      let incomplete = false;
      for (const slice of chunk(ids, YOUTUBE_IDS_PER_CALL)) {
        if (pastDeadline()) {
          incomplete = true;
          stopped = "time";
          break;
        }
        if (left() < CHANNELS_LIST_UNITS) {
          incomplete = true;
          stopped = "budget";
          break;
        }
        try {
          const listed = await withTimeout(input.api.list(slice), callTimeoutMs);
          units += CHANNELS_LIST_UNITS;
          for (const group of chunk(listed.found, CHANNEL_CHUNK_SIZE)) {
            if (pastDeadline()) {
              incomplete = true;
              stopped = "time";
              break;
            }
            const saved = await processChunk({
              store: input.store,
              api: input.api,
              found: group,
              source: "category",
              sourceQuery: item.value,
              now: recordNow,
              clock,
              unitsLeft: left(),
              log,
            });
            if (saved.stopped) {
              incomplete = true;
              stopped = saved.stopped;
              break;
            }
            upserted += saved.upserted;
            units += saved.units;
            chunks += 1;
          }
        } catch (err) {
          units += CHANNELS_LIST_UNITS;
          if (isQuotaError(err)) {
            stopped = "quota";
            incomplete = true;
            break;
          }
          await failItem(input.store, item, err instanceof Error ? err.message : "YouTube API error", log);
          incomplete = true;
          break;
        }
        if (stopped) break;
      }
      if (stopped) break;
      if (incomplete) continue;
      await input.store.markQueueDone(item.id, recordNow);
      done += 1;
      continue;
    }

    const parsed = parseChannelRef(item.value);
    if (!parsed) {
      await input.store.markQueueAttempt(item.id, item.attempts + 1, "unrecognized seed", "error");
      continue;
    }
    const lookupCost = input.api.seedLookupCost(item.value);
    if (left() < lookupCost + CHANNELS_LIST_UNITS) {
      stopped = "budget";
      break;
    }
    if (pastDeadline()) {
      stopped = "time";
      break;
    }

    let channelId = parsed.kind === "id" ? parsed.value : null;
    if (lookupCost > 0) {
      try {
        const looked = await withTimeout(input.api.lookupSeed(item.value), callTimeoutMs);
        units += lookupCost;
        if (looked.notFound || !looked.channelId) {
          await input.store.markQueueAttempt(item.id, item.attempts + 1, "not found", "error");
          continue;
        }
        channelId = looked.channelId;
      } catch (err) {
        units += lookupCost;
        if (isQuotaError(err)) {
          stopped = "quota";
          break;
        }
        await failItem(input.store, item, err instanceof Error ? err.message : "YouTube API error", log);
        continue;
      }
    }

    if (!channelId) {
      await input.store.markQueueAttempt(item.id, item.attempts + 1, "not found", "error");
      continue;
    }
    if (pastDeadline()) {
      stopped = "time";
      break;
    }
    if (left() < CHANNELS_LIST_UNITS) {
      stopped = "budget";
      break;
    }
    try {
      const listed = await withTimeout(input.api.list([channelId]), callTimeoutMs);
      units += CHANNELS_LIST_UNITS;
      if (listed.found.length === 0) {
        await input.store.markQueueAttempt(item.id, item.attempts + 1, "not found", "error");
        continue;
      }
      let seedIncomplete = false;
      for (const group of chunk(listed.found, CHANNEL_CHUNK_SIZE)) {
        if (pastDeadline()) {
          seedIncomplete = true;
          stopped = "time";
          break;
        }
        const saved = await processChunk({
          store: input.store,
          api: input.api,
          found: group,
          source: "seed",
          sourceQuery: item.value,
          now: recordNow,
          clock,
          unitsLeft: left(),
          log,
        });
        if (saved.stopped) {
          seedIncomplete = true;
          stopped = saved.stopped;
          break;
        }
        upserted += saved.upserted;
        units += saved.units;
        chunks += 1;
      }
      if (stopped || seedIncomplete) break;
      await input.store.markQueueDone(item.id, recordNow);
      done += 1;
    } catch (err) {
      units += CHANNELS_LIST_UNITS;
      if (isQuotaError(err) || isNotFoundError(err)) {
        if (isQuotaError(err)) {
          stopped = "quota";
          break;
        }
        await input.store.markQueueAttempt(item.id, item.attempts + 1, "not found", "error");
        continue;
      }
      await failItem(input.store, item, err instanceof Error ? err.message : "YouTube API error", log);
    }
  }

  const stillPending = (await input.store.pendingQueue()).length;
  const elapsedMs = Math.max(0, clock() - startedMs);
  log(
    `[youtube-library] pull units=${units} upserted=${upserted} seeded=${seeded} done=${done} pending=${stillPending} elapsedMs=${elapsedMs} searched=${searched} chunks=${chunks}`
  );
  return {
    skipped: false,
    seeded,
    units,
    upserted,
    done,
    pending: stillPending,
    stopped,
    elapsedMs,
    searched,
    chunks,
  };
}

function skippedReport(
  reason: "missing_table" | "no_api_key",
  extra: { seeded?: number; pending?: number; elapsedMs: number }
): YoutubePullReport {
  return {
    skipped: true,
    reason,
    seeded: extra.seeded ?? 0,
    units: 0,
    upserted: 0,
    done: 0,
    pending: extra.pending ?? 0,
    stopped: null,
    elapsedMs: extra.elapsedMs,
    searched: 0,
    chunks: 0,
  };
}

export async function runYoutubeLibraryPull(input?: {
  store?: YoutubeLibraryStore;
  api?: LibraryYoutubeApi;
  now?: Date;
  log?: (line: string) => void;
  deadlineMs?: number;
  clock?: () => number;
}): Promise<YoutubePullReport> {
  const store = input?.store ?? getYoutubeLibraryStore();
  const log = input?.log ?? ((line: string) => console.log(line));
  const clock = input?.clock ?? Date.now;
  const startedMs = clock();
  const elapsed = () => Math.max(0, clock() - startedMs);
  try {
    await store.ensureReady();
  } catch (err) {
    if (isMissingLibraryTable(err)) {
      log("[youtube-library] pull skipped: missing_table");
      return skippedReport("missing_table", { elapsedMs: elapsed() });
    }
    throw err;
  }

  if (!process.env.YOUTUBE_API_KEY) {
    const seeded = await store.enqueue(seedQueueItems(readSeedCsvText()));
    log("[youtube-library] pull skipped: no_api_key");
    return skippedReport("no_api_key", {
      seeded,
      pending: (await store.pendingQueue()).length,
      elapsedMs: elapsed(),
    });
  }

  const api = input?.api ?? createLibraryYoutubeApi();
  try {
    return await runPullQueue({
      store,
      api,
      now: input?.now,
      log,
      deadlineMs: input?.deadlineMs,
      clock,
    });
  } catch (err) {
    if (err instanceof YoutubeLibraryTableMissing || isMissingLibraryTable(err)) {
      log("[youtube-library] pull skipped: missing_table");
      return skippedReport("missing_table", { elapsedMs: elapsed() });
    }
    throw err;
  }
}
