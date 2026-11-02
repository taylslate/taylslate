// Scan stored channel descriptions (no API units), then recent video
// descriptions (playlistItems.list + videos.list, 2 units) until the
// daily cap or the 240 second budget. A channel that fails three video
// reads is marked checked. Email addresses are stored, not logged.

import { YOUTUBE_CALL_TIMEOUT_MS } from "@/lib/enrichment/youtube";
import { extractChannelContactEmails, extractVideoContactEmails } from "./emails";
import { createLibraryYoutubeApi, isQuotaError, type LibraryYoutubeApi } from "./pull";
import { openLibraryQuota, quotaLogLine, type QuotaSpend } from "./quota";
import {
  getYoutubeLibraryStore,
  isMissingLibraryTable,
  type YoutubeLibraryStore,
} from "./store";

export const YOUTUBE_LIBRARY_EMAIL_TIME_BUDGET_MS = 240_000;
const DESCRIPTION_PAGE = 200;
const VIDEO_UNITS = 2;
const MAX_VIDEO_ATTEMPTS = 3;
const MAX_TIMEOUTS_IN_A_ROW = 3;

export interface VideoDescriptionFetch {
  descriptions: string[];
  units: number;
}

export interface YoutubeEmailReport {
  skipped: boolean;
  reason?: "missing_table" | "missing_yt2" | "no_api_key";
  descriptionsScanned: number;
  videosScanned: number;
  emailsStored: number;
  units: number;
  pendingVideos: number;
  stopped: "cap" | "quota" | "time" | null;
  elapsedMs: number;
}

async function block(quota: QuotaSpend, cost: number): Promise<"cap" | null> {
  const used = await quota.ledger.used(quota.day);
  if (used + cost > quota.spendCap) return "cap";
  return null;
}

async function commit(quota: QuotaSpend, units: number): Promise<void> {
  if (units <= 0) return;
  await quota.ledger.commit(quota.day, units, quota.job, quota.cap);
}

function skipped(reason: YoutubeEmailReport["reason"], elapsedMs: number): YoutubeEmailReport {
  return {
    skipped: true,
    reason,
    descriptionsScanned: 0,
    videosScanned: 0,
    emailsStored: 0,
    units: 0,
    pendingVideos: 0,
    stopped: null,
    elapsedMs,
  };
}

export async function runYoutubeEmailBackfill(input?: {
  store?: YoutubeLibraryStore;
  api?: Pick<LibraryYoutubeApi, "recentVideoDescriptions">;
  now?: Date;
  log?: (line: string) => void;
  deadlineMs?: number;
  clock?: () => number;
}): Promise<YoutubeEmailReport> {
  const store = input?.store ?? getYoutubeLibraryStore();
  const log = input?.log ?? ((line: string) => console.log(line));
  const clock = input?.clock ?? Date.now;
  const startedMs = clock();
  const elapsed = () => Math.max(0, clock() - startedMs);
  const deadlineMs = input?.deadlineMs ?? startedMs + YOUTUBE_LIBRARY_EMAIL_TIME_BUDGET_MS;
  const nowDate = input?.now ?? new Date(startedMs);
  const nowIso = nowDate.toISOString();

  try {
    await store.ensureReady();
  } catch (err) {
    if (isMissingLibraryTable(err)) {
      log("[youtube-library] emails skipped: missing_table");
      return skipped("missing_table", elapsed());
    }
    throw err;
  }

  if (!(await store.yt2Ready())) {
    log("[youtube-library] emails skipped: missing_yt2");
    return skipped("missing_yt2", elapsed());
  }

  const quota = await openLibraryQuota(store, nowDate, "email_backfill");
  if (!quota) {
    log("[youtube-library] emails skipped: missing_yt2");
    return skipped("missing_yt2", elapsed());
  }

  let descriptionsScanned = 0;
  let videosScanned = 0;
  let emailsStored = 0;
  let units = 0;
  let stopped: YoutubeEmailReport["stopped"] = null;
  let timeouts = 0;

  while (clock() < deadlineMs) {
    const rows = await store.listUncheckedDescriptions(DESCRIPTION_PAGE);
    if (rows.length === 0) break;
    for (const row of rows) {
      if (clock() >= deadlineMs) {
        stopped = "time";
        break;
      }
      const found = extractChannelContactEmails(row.description);
      emailsStored += await store.saveChannelEmails(row.channel_id, found, nowIso);
      await store.markDescriptionEmailsChecked(row.channel_id, nowIso);
      descriptionsScanned += 1;
    }
    if (stopped) break;
  }

  const canCallVideos = Boolean(input?.api?.recentVideoDescriptions || process.env.YOUTUBE_API_KEY);
  if (!stopped && !canCallVideos) {
    const pendingVideos = await store.countUncheckedVideos();
    const total = await quota.ledger.used(quota.day);
    log(
      `[youtube-library] emails descriptions=${descriptionsScanned} videos=0 stored=${emailsStored} units=0 pendingVideos=${pendingVideos} stopped=null elapsedMs=${elapsed()}`
    );
    log(quotaLogLine(quota, total));
    return {
      skipped: false,
      reason: "no_api_key",
      descriptionsScanned,
      videosScanned: 0,
      emailsStored,
      units: 0,
      pendingVideos,
      stopped: null,
      elapsedMs: elapsed(),
    };
  }

  const fetchDescriptions =
    input?.api?.recentVideoDescriptions?.bind(input.api) ??
    (async (channelId: string) => {
      const api = createLibraryYoutubeApi();
      if (!api.recentVideoDescriptions) return { descriptions: [], units: 0 };
      return api.recentVideoDescriptions(channelId);
    });

  while (!stopped && clock() < deadlineMs) {
    const gate = await block(quota, VIDEO_UNITS);
    if (gate) {
      stopped = "cap";
      break;
    }
    const batch = await store.listUncheckedVideos(1);
    if (batch.length === 0) break;
    const channelId = batch[0].channel_id;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race([
        fetchDescriptions(channelId),
        new Promise<VideoDescriptionFetch>((_, reject) => {
          timer = setTimeout(() => reject(new Error("YouTube call timed out")), YOUTUBE_CALL_TIMEOUT_MS);
        }),
      ]);
      const spent = result.units > 0 ? result.units : VIDEO_UNITS;
      await commit(quota, spent);
      units += spent;
      const found = result.descriptions.flatMap((description) => extractVideoContactEmails(description));
      emailsStored += await store.saveChannelEmails(channelId, found, nowIso);
      await store.markVideoEmailsChecked(channelId, nowIso);
      videosScanned += 1;
      timeouts = 0;
    } catch (err) {
      await commit(quota, VIDEO_UNITS);
      units += VIDEO_UNITS;
      if (isQuotaError(err)) {
        stopped = "quota";
        break;
      }
      const attempts = await store.bumpVideoEmailAttempt(channelId);
      if (attempts >= MAX_VIDEO_ATTEMPTS) {
        await store.markVideoEmailsChecked(channelId, nowIso);
      }
      const message = err instanceof Error ? err.message : "";
      if (/timed out/i.test(message)) {
        timeouts += 1;
        if (timeouts >= MAX_TIMEOUTS_IN_A_ROW) {
          stopped = "time";
          break;
        }
      }
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  const descriptionsLeft = (await store.listUncheckedDescriptions(1)).length;
  if (!stopped && clock() >= deadlineMs && (descriptionsLeft > 0 || (await store.countUncheckedVideos()) > 0)) {
    stopped = "time";
  }

  const pendingVideos = await store.countUncheckedVideos();
  const total = await quota.ledger.used(quota.day);
  const elapsedMs = elapsed();
  log(
    `[youtube-library] emails descriptions=${descriptionsScanned} videos=${videosScanned} stored=${emailsStored} units=${units} pendingVideos=${pendingVideos} stopped=${stopped ?? "null"} elapsedMs=${elapsedMs}`
  );
  log(quotaLogLine(quota, total));
  return {
    skipped: false,
    descriptionsScanned,
    videosScanned,
    emailsStored,
    units,
    pendingVideos,
    stopped,
    elapsedMs,
  };
}
