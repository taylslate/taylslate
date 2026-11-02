// Daily stats refresh, oldest stats_refreshed_at first.
// Stops at YOUTUBE_LIBRARY_REFRESH_BUDGET (1,000 units) or at the
// pass budget (200 seconds) so the sweep and tagging keep about 40
// seconds inside the 240 second route budget. A row this run did not
// reach keeps its old stats_refreshed_at. A time, quota, or error
// estimate does not replace a stored recent average or stamp
// stats_refreshed_at. The 30-day sweep costs no YouTube units. It runs
// whenever the sweep clock still has room, including after a budget,
// cap, or quota stop. A clock already past that deadline skips it.
// A time stop is a normal result.
// Batch tagging runs here, under its own daily cap and the same clock.

import { chunk, type YouTubeChannelDetails } from "@/lib/enrichment/youtube";
import { passesYouTubeMarketFilter, youtubeBrandMatch } from "@/lib/discovery/discover-shows";
import { redactSecretParams } from "@/lib/discovery/redact-secrets";
import {
  createLibraryYoutubeApi,
  isNotFoundError,
  isQuotaError,
  mapLimit,
  queueErrorText,
  uploadsBatchWorstCaseUnits,
  withTimeout,
  YOUTUBE_LIBRARY_PULL_CHUNK_STATS_MS,
  type LibraryYoutubeApi,
  type UploadsStatsFetch,
} from "./pull";
import {
  CHANNELS_LIST_UNITS,
  draftToRecord,
  emptyYoutubeFields,
  getYoutubeLibraryStore,
  isMissingLibraryTable,
  statsFreshCutoff,
  UPLOADS_STATS_UNITS,
  uploadsStatsAffordable,
  type YoutubeChannelRecord,
  type YoutubeLibraryStore,
} from "./store";
import { openLibraryQuota, quotaLogLine, type QuotaSpend } from "./quota";
import { NICHE_TAGS_VERSION, runNicheTagBatches, TAG_DAILY_CAP, type TagBatchResult } from "./tags";

export const YOUTUBE_LIBRARY_REFRESH_BUDGET = 1000;
/** Sweep and tagging stop here so the 300 second function limit is not hit. */
export const YOUTUBE_LIBRARY_REFRESH_TIME_BUDGET_MS = 240_000;
/** Stop starting refresh work here so the sweep and tagging keep about 40 seconds. */
export const YOUTUBE_LIBRARY_REFRESH_PASS_BUDGET_MS = 200_000;

const CHANNEL_CHUNK_SIZE = 10;
const READ_CONCURRENCY = 4;
const SWEEP_BATCH = 50;
/** Backstop around a stats batch if the client ignores its deadline. Matches the pull. */
const CHUNK_STATS_BACKSTOP_MS = 45_000;
/** Do not start a tag call that cannot finish. */
const TAG_MIN_REMAINING_MS = 15_000;

export interface YoutubeRefreshReport {
  skipped: boolean;
  reason?: "missing_table" | "no_api_key";
  units: number;
  refreshed: number;
  deleted: number;
  nulled: number;
  stopped: "budget" | "quota" | "error" | "time" | "cap" | null;
  tagging: TagBatchResult | null;
  elapsedMs: number;
  chunks: number;
}

type RefreshStop = YoutubeRefreshReport["stopped"];

function measuredFrom(stats: UploadsStatsFetch | undefined): {
  averageViews?: number;
  viewsMethod?: "recent" | "estimated";
  keepExistingStats?: boolean;
} {
  if (!stats || stats.kind === "skip") return {};
  if (stats.kind === "keep") return { keepExistingStats: true };
  if (stats.kind === "uploads") {
    return { averageViews: stats.averageViews, viewsMethod: "recent" };
  }
  return { viewsMethod: "estimated" };
}

async function refreshOne(
  store: YoutubeLibraryStore,
  details: YouTubeChannelDetails,
  existing: YoutubeChannelRecord,
  showId: string | null,
  now: string,
  measured?: { averageViews?: number; viewsMethod?: "recent" | "estimated"; keepExistingStats?: boolean }
): Promise<void> {
  const record = draftToRecord(
    existing,
    {
      details,
      passedMarketFilter: passesYouTubeMarketFilter(details),
      brandFlag: youtubeBrandMatch(details),
      source: existing.source,
      sourceQuery: existing.source_query,
      averageViews: measured?.averageViews,
      viewsMethod: measured?.viewsMethod,
      keepExistingStats: measured?.keepExistingStats,
      now,
    },
    showId
  );
  record.source = existing.source;
  record.source_query = existing.source_query;
  record.first_seen_at = existing.first_seen_at;
  record.created_at = existing.created_at;
  await store.saveChannel(record, existing);
}

function logStatsFailure(log: (line: string) => void, err: unknown): void {
  const message = err instanceof Error ? err.message : "unknown error";
  log(`[youtube-library] uploads stats failed: ${redactSecretParams(message)}`);
}

async function refreshChunk(input: {
  store: YoutubeLibraryStore;
  api: LibraryYoutubeApi;
  group: YouTubeChannelDetails[];
  existingById: Map<string, YoutubeChannelRecord>;
  now: string;
  clock: () => number;
  passDeadlineMs: number;
  unitsSpent: number;
  budget: number;
  log: (line: string) => void;
}): Promise<{ refreshed: number; units: number; stopped: RefreshStop; kept: string[] }> {
  const hasBatch = typeof input.api.recentUploadsBatch === "function";
  const hasSingle = typeof input.api.recentUploads === "function";
  const showIds = await mapLimit(input.group, READ_CONCURRENCY, async (details) => {
    const existing = input.existingById.get(details.channelId);
    try {
      return await input.store.uniqueShowId(details.channelId, details.customUrl ?? existing?.custom_url);
    } catch (err) {
      if (isMissingLibraryTable(err)) throw err;
      return existing?.show_id ?? null;
    }
  });

  const statsById = new Map<string, UploadsStatsFetch>();
  let units = 0;
  let stopped: RefreshStop = null;

  if (hasBatch) {
    const chunkStart = input.clock();
    const chunkBudgetMs = Math.min(
      Math.max(0, input.passDeadlineMs - chunkStart),
      YOUTUBE_LIBRARY_PULL_CHUNK_STATS_MS
    );
    const ids = input.group.map((details) => details.channelId);
    if (chunkBudgetMs <= 0) {
      for (const details of input.group) statsById.set(details.channelId, { kind: "keep" });
      stopped = "time";
    } else {
      try {
        const batch = await withTimeout(
          input.api.recentUploadsBatch!(ids, {
            deadlineMs: chunkStart + chunkBudgetMs,
            clock: input.clock,
          }),
          Math.min(CHUNK_STATS_BACKSTOP_MS, chunkBudgetMs + 5_000)
        );
        units += (batch.playlistCalls || 0) + (batch.videoListCalls || 0);
        input.group.forEach((details, index) => {
          statsById.set(details.channelId, batch.results[index] ?? { kind: "estimate" });
        });
      } catch (err) {
        logStatsFailure(input.log, err);
        units += uploadsBatchWorstCaseUnits(input.group.length);
        for (const details of input.group) statsById.set(details.channelId, { kind: "keep" });
        if (isQuotaError(err)) stopped = "quota";
      }
    }
  } else if (hasSingle) {
    for (const details of input.group) {
      if (input.clock() >= input.passDeadlineMs) {
        stopped = "time";
        break;
      }
      if (!uploadsStatsAffordable(input.unitsSpent + units, input.budget)) {
        stopped = "budget";
        break;
      }
      units += UPLOADS_STATS_UNITS;
      try {
        const result = await input.api.recentUploads!(details.channelId);
        if (result.kind === "skip") {
          units -= UPLOADS_STATS_UNITS;
        }
        statsById.set(details.channelId, result);
      } catch (err) {
        statsById.set(details.channelId, { kind: "keep" });
        logStatsFailure(input.log, err);
        if (isQuotaError(err)) {
          stopped = "quota";
          break;
        }
      }
    }
  }

  const toSave =
    hasBatch || !hasSingle
      ? input.group
      : input.group.filter((details) => statsById.has(details.channelId));
  const rows: { details: YouTubeChannelDetails; existing: YoutubeChannelRecord; showId: string | null }[] = [];
  toSave.forEach((details) => {
    const existing = input.existingById.get(details.channelId);
    if (!existing) return;
    const index = input.group.indexOf(details);
    rows.push({ details, existing, showId: showIds[index] ?? existing.show_id });
  });

  await mapLimit(rows, READ_CONCURRENCY, async (row) => {
    await refreshOne(
      input.store,
      row.details,
      row.existing,
      row.showId,
      input.now,
      measuredFrom(statsById.get(row.details.channelId))
    );
  });

  const kept = input.group
    .filter((details) => statsById.get(details.channelId)?.kind === "keep")
    .map((details) => details.channelId);
  return { refreshed: rows.length, units, stopped, kept };
}

export async function runRefreshQueue(input: {
  store: YoutubeLibraryStore;
  api: LibraryYoutubeApi;
  budget?: number;
  now?: Date;
  log?: (line: string) => void;
  /** Stop starting refresh work at this epoch ms. Default is the pass budget. */
  deadlineMs?: number;
  /** Stop the 30-day sweep at this epoch ms. Default is the 240 second budget. */
  timeDeadlineMs?: number;
  clock?: () => number;
  quota?: QuotaSpend;
}): Promise<Omit<YoutubeRefreshReport, "tagging"> & { skipped: false; tagging?: undefined }> {
  const budget = input.budget ?? YOUTUBE_LIBRARY_REFRESH_BUDGET;
  const clock = input.clock ?? Date.now;
  const startedMs = clock();
  const passDeadlineMs = input.deadlineMs ?? startedMs + YOUTUBE_LIBRARY_REFRESH_PASS_BUDGET_MS;
  const timeDeadlineMs = input.timeDeadlineMs ?? startedMs + YOUTUBE_LIBRARY_REFRESH_TIME_BUDGET_MS;
  const pastPass = () => clock() >= passDeadlineMs;
  const pastTime = () => clock() >= timeDeadlineMs;
  const nowDate = input.now ?? new Date(startedMs);
  const now = nowDate.toISOString();
  const log = input.log ?? ((line: string) => console.log(line));
  let units = 0;
  let refreshed = 0;
  let deleted = 0;
  let nulled = 0;
  let chunks = 0;
  let stopped: RefreshStop = null;
  const seen = new Set<string>();
  const keptIds = new Set<string>();
  const usesStats =
    typeof input.api.recentUploadsBatch === "function" || typeof input.api.recentUploads === "function";

  async function overCap(cost: number): Promise<boolean> {
    if (!input.quota || cost <= 0) return false;
    const used = await input.quota.ledger.used(input.quota.day);
    return used + cost > input.quota.spendCap;
  }

  async function commit(cost: number): Promise<void> {
    if (!input.quota || cost <= 0) return;
    await input.quota.ledger.commit(input.quota.day, cost, input.quota.job, input.quota.cap);
  }

  while (!stopped) {
    if (pastPass()) {
      stopped = "time";
      break;
    }
    const oldest = (await input.store.oldestChannels(50)).filter((row) => !seen.has(row.channel_id));
    if (oldest.length === 0) break;
    const ids = oldest.map((row) => row.channel_id);
    // A new group spends 1 unit on channels.list. Stop before the call when it does not fit.
    if (await overCap(CHANNELS_LIST_UNITS)) {
      stopped = "cap";
      break;
    }
    if (units + CHANNELS_LIST_UNITS > budget) {
      stopped = "budget";
      break;
    }
    for (const id of ids) seen.add(id);

    let listed: { found: YouTubeChannelDetails[]; missing: string[] };
    try {
      listed = await input.api.list(ids);
      units += CHANNELS_LIST_UNITS;
      await commit(CHANNELS_LIST_UNITS);
    } catch (err) {
      units += CHANNELS_LIST_UNITS;
      await commit(CHANNELS_LIST_UNITS);
      if (isNotFoundError(err)) {
        await input.store.deleteChannels(ids);
        deleted += ids.length;
        if (ids.length < 50) break;
        continue;
      }
      stopped = isQuotaError(err) ? "quota" : "error";
      if (stopped === "error") {
        log(`[youtube-library] refresh stopped: ${queueErrorText(err instanceof Error ? err.message : "YouTube API error")}`);
      }
      break;
    }

    if (listed.missing.length > 0) {
      await input.store.deleteChannels(listed.missing);
      deleted += listed.missing.length;
    }

    const existingRows = await input.store.getChannels(ids);
    const existingById = new Map(existingRows.map((row) => [row.channel_id, row]));
    const foundById = new Map(listed.found.map((row) => [row.channelId, row]));
    const found = ids
      .map((id) => foundById.get(id))
      .filter((row): row is YouTubeChannelDetails => Boolean(row));

    for (const group of chunk(found, CHANNEL_CHUNK_SIZE)) {
      if (pastPass()) {
        stopped = "time";
        break;
      }
      const worst = usesStats ? uploadsBatchWorstCaseUnits(group.length) : 0;
      if (worst > 0 && (await overCap(worst))) {
        stopped = "cap";
        break;
      }
      if (worst > 0 && units + worst > budget) {
        stopped = "budget";
        break;
      }
      const saved = await refreshChunk({
        store: input.store,
        api: input.api,
        group,
        existingById,
        now,
        clock,
        passDeadlineMs,
        unitsSpent: units,
        budget,
        log,
      });
      units += saved.units;
      await commit(saved.units);
      for (const id of saved.kept) keptIds.add(id);
      refreshed += saved.refreshed;
      if (saved.refreshed > 0 || saved.units > 0) chunks += 1;
      if (saved.stopped) {
        stopped = saved.stopped;
        break;
      }
    }

    if (stopped) break;
    if (ids.length < 50) break;
  }

  if (pastTime()) {
    if (stopped) log(`[youtube-library] refresh sweep skipped: ${stopped}`);
  } else {
    const passStop = stopped;
    const cutoff = statsFreshCutoff(nowDate);
    const stale = (await input.store.listStale(cutoff)).filter((row) => !keptIds.has(row.channel_id));
    const deleteIds = stale.filter((row) => !row.show_id).map((row) => row.channel_id);
    const nullIds = stale.filter((row) => row.show_id).map((row) => row.channel_id);
    let sweepTimedOut = false;
    for (const batch of chunk(deleteIds, SWEEP_BATCH)) {
      if (pastTime()) {
        sweepTimedOut = true;
        break;
      }
      await input.store.deleteChannels(batch);
      deleted += batch.length;
    }
    if (!sweepTimedOut) {
      for (const batch of chunk(nullIds, SWEEP_BATCH)) {
        if (pastTime()) {
          sweepTimedOut = true;
          break;
        }
        await mapLimit(batch, READ_CONCURRENCY, async (channelId) => {
          await input.store.nullStaleYoutubeFields(channelId);
        });
        nulled += batch.length;
      }
    }
    if (sweepTimedOut && passStop === null) stopped = "time";
  }

  const elapsedMs = Math.max(0, clock() - startedMs);
  return { skipped: false, units, refreshed, deleted, nulled, stopped, elapsedMs, chunks };
}

function skippedReport(
  reason: "missing_table" | "no_api_key",
  elapsedMs: number
): YoutubeRefreshReport {
  return {
    skipped: true,
    reason,
    units: 0,
    refreshed: 0,
    deleted: 0,
    nulled: 0,
    stopped: null,
    tagging: null,
    elapsedMs,
    chunks: 0,
  };
}

export async function runYoutubeLibraryRefresh(input?: {
  store?: YoutubeLibraryStore;
  api?: LibraryYoutubeApi;
  now?: Date;
  tagCap?: number;
  log?: (line: string) => void;
  /** Whole-route deadline. Default is the clock at start plus 240 seconds. */
  deadlineMs?: number;
  clock?: () => number;
  completeTags?: (channels: { channel_id: string; title: string | null; description: string | null; topic_categories: string[]; keywords: string[] }[]) => Promise<string>;
}): Promise<YoutubeRefreshReport> {
  const store = input?.store ?? getYoutubeLibraryStore();
  const log = input?.log ?? ((line: string) => console.log(line));
  const clock = input?.clock ?? Date.now;
  const startedMs = clock();
  const elapsed = () => Math.max(0, clock() - startedMs);
  const timeDeadlineMs = input?.deadlineMs ?? startedMs + YOUTUBE_LIBRARY_REFRESH_TIME_BUDGET_MS;
  const passDeadlineMs = Math.min(timeDeadlineMs, startedMs + YOUTUBE_LIBRARY_REFRESH_PASS_BUDGET_MS);
  try {
    await store.ensureReady();
  } catch (err) {
    if (isMissingLibraryTable(err)) {
      log("[youtube-library] refresh skipped: missing_table");
      return skippedReport("missing_table", elapsed());
    }
    throw err;
  }

  if (!process.env.YOUTUBE_API_KEY && !input?.api) {
    log("[youtube-library] refresh skipped: no_api_key");
    return skippedReport("no_api_key", elapsed());
  }

  const api = input?.api ?? createLibraryYoutubeApi();
  const nowDate = input?.now ?? new Date(startedMs);
  let quota: QuotaSpend | null = null;
  try {
    quota = await openLibraryQuota(store, nowDate, "refresh");
  } catch (err) {
    if (!isMissingLibraryTable(err)) throw err;
  }
  const refreshed = await runRefreshQueue({
    store,
    api,
    now: nowDate,
    log,
    deadlineMs: passDeadlineMs,
    timeDeadlineMs,
    clock,
    quota: quota ?? undefined,
  });
  const remain = timeDeadlineMs - clock();
  const taggedAt = (input?.now ?? new Date(startedMs)).toISOString();
  const tagging =
    remain < TAG_MIN_REMAINING_MS
      ? { channels: 0, calls: 0, stopped: "time" as const }
      : await runNicheTagBatches({
          cap: input?.tagCap ?? TAG_DAILY_CAP,
          log,
          complete: input?.completeTags,
          deadlineMs: timeDeadlineMs,
          clock,
          load: async (limit) => {
            const rows = await store.listNeedsTags(limit, NICHE_TAGS_VERSION);
            return rows.map((row: YoutubeChannelRecord) => ({
              channel_id: row.channel_id,
              title: row.title,
              description: row.description,
              topic_categories: row.topic_categories,
              keywords: row.keywords,
            }));
          },
          save: async (channelId, tags) => {
            await store.saveTags(channelId, tags, NICHE_TAGS_VERSION, taggedAt);
          },
        });
  const elapsedMs = elapsed();
  log(
    `[youtube-library] refresh units=${refreshed.units} refreshed=${refreshed.refreshed} deleted=${refreshed.deleted} nulled=${refreshed.nulled} elapsedMs=${elapsedMs} chunks=${refreshed.chunks}`
  );
  if (quota) {
    const total = await quota.ledger.used(quota.day);
    log(quotaLogLine(quota, total));
  }
  return { ...refreshed, tagging, elapsedMs };
}

export { emptyYoutubeFields };
