// Daily category and seed pull. Stops at YOUTUBE_LIBRARY_PULL_BUDGET
// (8,000 units) and leaves the rest of the queue pending. search.list
// is 100. channels.list is 1 per batch of 50. The API key is never logged.

import { readFileSync } from "node:fs";
import {
  getYouTubeClientSafe,
  type YouTubeChannelDetails,
  type YouTubeClient,
} from "@/lib/enrichment/youtube";
import { passesYouTubeMarketFilter, youtubeBrandMatch } from "@/lib/discovery/discover-shows";
import { categoryQueueValues } from "./categories";
import { parseChannelRef, parseYoutubeSeedCsv, YOUTUBE_SEEDS_PATH } from "./seeds";
import {
  CHANNELS_LIST_UNITS,
  draftToRecord,
  getYoutubeLibraryStore,
  isMissingLibraryTable,
  SEARCH_UNITS,
  YoutubeLibraryTableMissing,
  YOUTUBE_LIBRARY_PULL_BUDGET,
  type ChannelDraft,
  type QueueItem,
  type YoutubeLibraryStore,
} from "./store";

export { SEARCH_UNITS, CHANNELS_LIST_UNITS, YOUTUBE_LIBRARY_PULL_BUDGET };

const MAX_ATTEMPTS = 3;
const YOUTUBE_API_BASE = "https://www.googleapis.com/youtube/v3";

export interface LibraryYoutubeApi {
  search(query: string): Promise<string[]>;
  list(ids: string[]): Promise<{ found: YouTubeChannelDetails[]; missing: string[] }>;
  seedLookupCost(value: string): number;
  lookupSeed(value: string): Promise<{ channelId: string | null; notFound: boolean }>;
}

export interface YoutubePullReport {
  skipped: boolean;
  reason?: "missing_table" | "no_api_key";
  seeded: number;
  units: number;
  upserted: number;
  done: number;
  pending: number;
  stopped: "budget" | "quota" | null;
}

export function scrubYoutubeError(err: unknown): Error {
  const message = err instanceof Error ? err.message : "";
  const status = message.match(/YouTube API error (\d{3})/)?.[1] ?? "";
  const reason = message.match(/\b(quotaExceeded|dailyLimitExceeded|rateLimitExceeded)\b/)?.[1] ?? "";
  if (!status) return new Error("YouTube API error");
  return new Error(`YouTube API error ${status}${reason ? `: ${reason}` : ""}`);
}

export function isQuotaError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : "";
  return /\b(quotaExceeded|dailyLimitExceeded)\b/.test(message);
}

export function isNotFoundError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : "";
  return /YouTube API error 404\b/.test(message);
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

async function youtubeGet(path: string, params: Record<string, string>): Promise<{ status: number; body: unknown }> {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) throw new Error("YOUTUBE_API_KEY is not set");
  const url = new URL(`${YOUTUBE_API_BASE}${path}`);
  url.searchParams.set("key", key);
  for (const [name, value] of Object.entries(params)) {
    if (value) url.searchParams.set(name, value);
  }
  const res = await fetch(url.toString());
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
}

export function createLibraryYoutubeApi(client?: YouTubeClient | null): LibraryYoutubeApi {
  const youtube = client === undefined ? getYouTubeClientSafe() : client;

  return {
    async search(query: string) {
      if (!youtube) throw new Error("YOUTUBE_API_KEY is not set");
      try {
        const hits = await youtube.searchVideos(query, 50, "relevance");
        return uniqueIds(hits.map((hit) => hit.channelId));
      } catch (err) {
        throw scrubYoutubeError(err);
      }
    },
    async list(ids: string[]) {
      if (!youtube) throw new Error("YOUTUBE_API_KEY is not set");
      if (ids.length === 0) return { found: [], missing: [] };
      try {
        const found = await youtube.getMultipleChannelDetails(ids);
        const present = new Set(found.map((row) => row.channelId));
        return { found, missing: ids.filter((id) => !present.has(id)) };
      } catch (err) {
        throw scrubYoutubeError(err);
      }
    },
    seedLookupCost(value: string) {
      const parsed = parseChannelRef(value);
      if (!parsed) return 0;
      return parsed.kind === "id" ? 0 : CHANNELS_LIST_UNITS;
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
        const { body } = await youtubeGet("/channels", params);
        const id = (body as { items?: { id?: string }[] } | null)?.items?.[0]?.id?.trim() ?? "";
        if (!id) return { channelId: null, notFound: true };
        return { channelId: id, notFound: false };
      } catch (err) {
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

async function upsertFound(
  store: YoutubeLibraryStore,
  details: YouTubeChannelDetails,
  source: ChannelDraft["source"],
  sourceQuery: string,
  now: string
): Promise<number> {
  let showId: string | null = null;
  try {
    showId = await store.uniqueShowId(details.channelId, details.customUrl);
  } catch (err) {
    if (isMissingLibraryTable(err)) throw err;
    showId = null;
  }
  const existing = await store.getChannel(details.channelId);
  const draft: ChannelDraft = {
    details,
    passedMarketFilter: passesYouTubeMarketFilter(details),
    brandFlag: youtubeBrandMatch(details),
    source,
    sourceQuery,
    now,
  };
  const record = draftToRecord(existing, draft, showId);
  await store.saveChannel(record);
  return 1;
}

async function failItem(store: YoutubeLibraryStore, item: QueueItem, message: string): Promise<void> {
  const attempts = item.attempts + 1;
  await store.markQueueAttempt(item.id, attempts, message, attempts >= MAX_ATTEMPTS ? "error" : "pending");
}

/**
 * Work pending queue rows until the budget is spent. category_query uses
 * video search (100) then channels.list batches (1 each). seed_channel
 * resolves a handle or URL, then fetches details. A row that does not
 * finish stays pending.
 */
export async function runPullQueue(input: {
  store: YoutubeLibraryStore;
  api: LibraryYoutubeApi;
  budget?: number;
  now?: Date;
  csvText?: string;
  seed?: boolean;
  log?: (line: string) => void;
}): Promise<YoutubePullReport> {
  const budget = input.budget ?? YOUTUBE_LIBRARY_PULL_BUDGET;
  const now = (input.now ?? new Date()).toISOString();
  const log = input.log ?? ((line: string) => console.log(line));
  let seeded = 0;
  if (input.seed !== false) {
    seeded = await input.store.enqueue(seedQueueItems(input.csvText ?? readSeedCsvText()));
  }

  let units = 0;
  let upserted = 0;
  let done = 0;
  let stopped: YoutubePullReport["stopped"] = null;
  const left = () => budget - units;

  const pending = await input.store.pendingQueue();
  for (const item of pending) {
    if (stopped) break;

    if (item.kind === "category_query") {
      if (left() < SEARCH_UNITS) {
        stopped = "budget";
        break;
      }
      let ids: string[];
      try {
        ids = await input.api.search(item.value);
        units += SEARCH_UNITS;
      } catch (err) {
        units += SEARCH_UNITS;
        if (isQuotaError(err)) {
          stopped = "quota";
          break;
        }
        await failItem(input.store, item, scrubYoutubeError(err).message);
        continue;
      }

      let incomplete = false;
      for (let i = 0; i < ids.length; i += 50) {
        if (left() < CHANNELS_LIST_UNITS) {
          incomplete = true;
          stopped = "budget";
          break;
        }
        const slice = ids.slice(i, i + 50);
        try {
          const listed = await input.api.list(slice);
          units += CHANNELS_LIST_UNITS;
          for (const details of listed.found) {
            upserted += await upsertFound(input.store, details, "category", item.value, now);
          }
        } catch (err) {
          units += CHANNELS_LIST_UNITS;
          if (isQuotaError(err)) {
            stopped = "quota";
            incomplete = true;
            break;
          }
          await failItem(input.store, item, scrubYoutubeError(err).message);
          incomplete = true;
          break;
        }
      }
      if (stopped) break;
      if (incomplete) continue;
      await input.store.markQueueDone(item.id, now);
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

    let channelId = parsed.kind === "id" ? parsed.value : null;
    if (lookupCost > 0) {
      try {
        const looked = await input.api.lookupSeed(item.value);
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
        await failItem(input.store, item, scrubYoutubeError(err).message);
        continue;
      }
    }

    if (!channelId) {
      await input.store.markQueueAttempt(item.id, item.attempts + 1, "not found", "error");
      continue;
    }
    if (left() < CHANNELS_LIST_UNITS) {
      stopped = "budget";
      break;
    }
    try {
      const listed = await input.api.list([channelId]);
      units += CHANNELS_LIST_UNITS;
      if (listed.found.length === 0) {
        await input.store.markQueueAttempt(item.id, item.attempts + 1, "not found", "error");
        continue;
      }
      for (const details of listed.found) {
        upserted += await upsertFound(input.store, details, "seed", item.value, now);
      }
      await input.store.markQueueDone(item.id, now);
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
      await failItem(input.store, item, scrubYoutubeError(err).message);
    }
  }

  const stillPending = (await input.store.pendingQueue()).length;
  log(`[youtube-library] pull units=${units} upserted=${upserted} seeded=${seeded} done=${done} pending=${stillPending}`);
  return {
    skipped: false,
    seeded,
    units,
    upserted,
    done,
    pending: stillPending,
    stopped,
  };
}

export async function runYoutubeLibraryPull(input?: {
  store?: YoutubeLibraryStore;
  api?: LibraryYoutubeApi;
  now?: Date;
  log?: (line: string) => void;
}): Promise<YoutubePullReport> {
  const store = input?.store ?? getYoutubeLibraryStore();
  const log = input?.log ?? ((line: string) => console.log(line));
  try {
    await store.ensureReady();
  } catch (err) {
    if (isMissingLibraryTable(err)) {
      log("[youtube-library] pull skipped: missing_table");
      return {
        skipped: true,
        reason: "missing_table",
        seeded: 0,
        units: 0,
        upserted: 0,
        done: 0,
        pending: 0,
        stopped: null,
      };
    }
    throw err;
  }

  if (!process.env.YOUTUBE_API_KEY) {
    const seeded = await store.enqueue(seedQueueItems(readSeedCsvText()));
    log("[youtube-library] pull skipped: no_api_key");
    return {
      skipped: true,
      reason: "no_api_key",
      seeded,
      units: 0,
      upserted: 0,
      done: 0,
      pending: (await store.pendingQueue()).length,
      stopped: null,
    };
  }

  const api = input?.api ?? createLibraryYoutubeApi();
  try {
    return await runPullQueue({ store, api, now: input?.now, log });
  } catch (err) {
    if (err instanceof YoutubeLibraryTableMissing || isMissingLibraryTable(err)) {
      log("[youtube-library] pull skipped: missing_table");
      return {
        skipped: true,
        reason: "missing_table",
        seeded: 0,
        units: 0,
        upserted: 0,
        done: 0,
        pending: 0,
        stopped: null,
      };
    }
    throw err;
  }
}
