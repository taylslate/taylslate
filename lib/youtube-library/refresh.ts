// Daily stats refresh, oldest stats_refreshed_at first, 1,000 units.
// A row older than 30 days that this run did not refresh is deleted
// when it has no show, or has its YouTube fields cleared when it does.
// A channel id missing from channels.list, or a 404, is deleted.
// Batch tagging runs here, under its own daily cap.

import type { YouTubeChannelDetails } from "@/lib/enrichment/youtube";
import { passesYouTubeMarketFilter, youtubeBrandMatch } from "@/lib/discovery/discover-shows";
import { redactSecretParams } from "@/lib/discovery/redact-secrets";
import { createLibraryYoutubeApi, isNotFoundError, isQuotaError, scrubYoutubeError, type LibraryYoutubeApi } from "./pull";
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
import { NICHE_TAGS_VERSION, runNicheTagBatches, TAG_DAILY_CAP, type TagBatchResult } from "./tags";

export const YOUTUBE_LIBRARY_REFRESH_BUDGET = 1000;

export interface YoutubeRefreshReport {
  skipped: boolean;
  reason?: "missing_table" | "no_api_key";
  units: number;
  refreshed: number;
  deleted: number;
  nulled: number;
  stopped: "budget" | "quota" | "error" | null;
  tagging: TagBatchResult | null;
}

async function refreshOne(
  store: YoutubeLibraryStore,
  details: YouTubeChannelDetails,
  now: string,
  measured?: { averageViews?: number; viewsMethod?: "recent" | "estimated" }
): Promise<void> {
  const existing = await store.getChannel(details.channelId);
  if (!existing) return;
  let showId = existing.show_id;
  try {
    showId = await store.uniqueShowId(details.channelId, details.customUrl ?? existing.custom_url);
  } catch (err) {
    if (isMissingLibraryTable(err)) throw err;
  }
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
      now,
    },
    showId
  );
  record.source = existing.source;
  record.source_query = existing.source_query;
  record.first_seen_at = existing.first_seen_at;
  record.created_at = existing.created_at;
  await store.saveChannel(record);
}

export async function runRefreshQueue(input: {
  store: YoutubeLibraryStore;
  api: LibraryYoutubeApi;
  budget?: number;
  now?: Date;
  log?: (line: string) => void;
}): Promise<Omit<YoutubeRefreshReport, "tagging" | "skipped"> & { skipped: false }> {
  const budget = input.budget ?? YOUTUBE_LIBRARY_REFRESH_BUDGET;
  const nowDate = input.now ?? new Date();
  const now = nowDate.toISOString();
  const log = input.log ?? ((line: string) => console.log(line));
  let units = 0;
  let refreshed = 0;
  let deleted = 0;
  let stopped: YoutubeRefreshReport["stopped"] = null;
  const seen = new Set<string>();
  const chargeUploads = typeof input.api.recentUploads === "function";
  const statsReserve = chargeUploads ? UPLOADS_STATS_UNITS : 0;

  while (units + CHANNELS_LIST_UNITS + statsReserve <= budget) {
    const oldest = (await input.store.oldestChannels(50)).filter((row) => !seen.has(row.channel_id));
    if (oldest.length === 0) break;
    const ids = oldest.map((row) => row.channel_id);
    for (const id of ids) seen.add(id);
    try {
      const listed = await input.api.list(ids);
      units += CHANNELS_LIST_UNITS;
      if (listed.missing.length > 0) {
        await input.store.deleteChannels(listed.missing);
        deleted += listed.missing.length;
      }
      const byId = new Map(listed.found.map((row) => [row.channelId, row]));
      for (const id of ids) {
        const details = byId.get(id);
        if (!details) continue;
        let averageViews: number | undefined;
        let viewsMethod: "recent" | "estimated" | undefined;
        if (chargeUploads) {
          if (!uploadsStatsAffordable(units, budget)) {
            stopped = "budget";
            break;
          }
          units += UPLOADS_STATS_UNITS;
          try {
            const result = await input.api.recentUploads!(details.channelId);
            if (result.kind === "skip") {
              units -= UPLOADS_STATS_UNITS;
            } else if (result.kind === "uploads") {
              averageViews = result.averageViews;
              viewsMethod = "recent";
            } else {
              viewsMethod = "estimated";
            }
          } catch (err) {
            viewsMethod = "estimated";
            const message = err instanceof Error ? err.message : "unknown error";
            log(`[youtube-library] uploads stats failed: ${redactSecretParams(message)}`);
          }
        }
        await refreshOne(input.store, details, now, { averageViews, viewsMethod });
        refreshed += 1;
      }
    } catch (err) {
      units += CHANNELS_LIST_UNITS;
      if (isNotFoundError(err)) {
        await input.store.deleteChannels(ids);
        deleted += ids.length;
        continue;
      }
      stopped = isQuotaError(err) ? "quota" : "error";
      if (stopped === "error") {
        log(`[youtube-library] refresh stopped: ${redactSecretParams(scrubYoutubeError(err).message)}`);
      }
      break;
    }
    if (stopped) break;
    if (ids.length < 50) break;
  }
  if (!stopped && units + CHANNELS_LIST_UNITS + statsReserve > budget) {
    const more = (await input.store.oldestChannels(1)).some((row) => row.stats_refreshed_at < now);
    if (more) stopped = "budget";
  }

  const cutoff = statsFreshCutoff(nowDate);
  const stale = await input.store.listStale(cutoff);
  let nulled = 0;
  for (const row of stale) {
    if (row.show_id) {
      await input.store.nullStaleYoutubeFields(row.channel_id);
      nulled += 1;
    } else {
      await input.store.deleteChannels([row.channel_id]);
      deleted += 1;
    }
  }

  log(`[youtube-library] refresh units=${units} refreshed=${refreshed} deleted=${deleted} nulled=${nulled}`);
  return { skipped: false, units, refreshed, deleted, nulled, stopped };
}

export async function runYoutubeLibraryRefresh(input?: {
  store?: YoutubeLibraryStore;
  api?: LibraryYoutubeApi;
  now?: Date;
  tagCap?: number;
  log?: (line: string) => void;
  completeTags?: (channels: { channel_id: string; title: string | null; description: string | null; topic_categories: string[]; keywords: string[] }[]) => Promise<string>;
}): Promise<YoutubeRefreshReport> {
  const store = input?.store ?? getYoutubeLibraryStore();
  const log = input?.log ?? ((line: string) => console.log(line));
  try {
    await store.ensureReady();
  } catch (err) {
    if (isMissingLibraryTable(err)) {
      log("[youtube-library] refresh skipped: missing_table");
      return {
        skipped: true,
        reason: "missing_table",
        units: 0,
        refreshed: 0,
        deleted: 0,
        nulled: 0,
        stopped: null,
        tagging: null,
      };
    }
    throw err;
  }

  if (!process.env.YOUTUBE_API_KEY && !input?.api) {
    log("[youtube-library] refresh skipped: no_api_key");
    return {
      skipped: true,
      reason: "no_api_key",
      units: 0,
      refreshed: 0,
      deleted: 0,
      nulled: 0,
      stopped: null,
      tagging: null,
    };
  }

  const api = input?.api ?? createLibraryYoutubeApi();
  const refreshed = await runRefreshQueue({ store, api, now: input?.now, log });
  const taggedAt = (input?.now ?? new Date()).toISOString();
  const tagging = await runNicheTagBatches({
    cap: input?.tagCap ?? TAG_DAILY_CAP,
    log,
    complete: input?.completeTags,
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
  return { ...refreshed, tagging };
}

export { emptyYoutubeFields };
