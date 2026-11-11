// Caption airchecks for a connected creator channel.
// Writes airchecks only through saveAircheckRun, after locateAdRead.
// Never throws past the caller: each spot is isolated, and a missing
// table skips the run. Does not download audio or video.

import { logEvent as writeEvent } from "@/lib/data/events";
import type { LogEventInput } from "@/lib/data/events";
import { findYoutubeEpisode, youtubeClientFromEnv } from "@/lib/airchecks/episode";
import type { FoundEpisode } from "@/lib/airchecks/episode";
import { locateAdRead } from "@/lib/airchecks/locate";
import { saveAircheckRun, type AircheckPersist } from "@/lib/airchecks/persist";
import { redactAircheckError } from "@/lib/airchecks/redact";
import { loadDueSpots, type DueSpot } from "@/lib/airchecks/select";
import type { AircheckSegment } from "@/lib/airchecks/types";
import { analyticsWindow, fetchRetention, fetchVideoAnalytics, retentionPointsForAd } from "./analytics";
import type { RetentionPoint } from "./analytics";
import {
  captionFailureMessage,
  downloadCaptionTrack,
  fetchVideoDetails,
  isVideoId,
  listCaptionTracks,
  pickCaptionTrack,
  segmentsToTranscript,
  vttToSegments,
} from "./captions";
import { readYoutubeOauthConfig, YOUTUBE_OAUTH_SCOPES, youtubeOauthConfigured } from "./config";
import { decryptString, encryptString } from "./crypto";
import {
  AIRCHECK_CAPTION_UNITS,
  AIRCHECK_EPISODE_UNITS,
  commitLiveAircheckUnits,
  nextPacificDay,
  setLiveAircheckReserve,
  tomorrowReserve,
} from "./quota";
import { pacificDay } from "@/lib/youtube-library/quota";
import {
  countActiveConnections,
  listActiveConnections,
  loadAnalyticsCandidateRows,
  loadDealShowProfiles,
  loadMetricsAttempt,
  loadStoredCaption as readStoredCaption,
  markConnectionReauth,
  markConnectionVerified,
  runYoutubeHousekeeping,
  saveMetrics,
  storeRefreshedAccess,
  youtubeOauthTablesReady,
  type StoredConnection,
} from "./store";
import { refreshAccessToken } from "./google";
import { GoogleOAuthError } from "./google";

export const YOUTUBE_CAPTION_PROVIDER = "youtube-captions";
export const YOUTUBE_CAPTION_BUDGET_MS = 60_000;
const REFRESH_SKEW_MS = 2 * 60 * 1000;
const MAX_ERROR = 2000;

export interface YoutubeCaptionReport {
  skipped: "not_configured" | "missing_tables" | null;
  stopped: "quota" | "time" | null;
  considered: number;
  captioned: number;
  ready: number;
  failed: number;
  analytics: number;
}

export interface FeedConnection {
  id: string;
  showProfileId: string | null;
  channelId: string;
  analytics: boolean;
  accessToken: string | null;
  accessTokenExpiresAt: string | null;
  lastVerifiedAt: string | null;
}

export interface MetricsSnapshot {
  attempts: number;
  views: number | null;
  hasRetention: boolean;
}

export interface AnalyticsWork {
  ioLineItemId: string;
  videoId: string;
  showProfileId: string | null;
  publishedAt: string | null;
  durationSeconds: number | null;
  adStartSeconds: number | null;
  adEndSeconds: number | null;
  attempts: number;
  views: number | null;
  hasRetention: boolean;
}

export interface StoredCaption {
  transcript: string;
  segments: AircheckSegment[];
}

export interface YoutubeCaptionDeps {
  now: Date;
  configured: () => boolean;
  tablesReady: () => Promise<boolean>;
  housekeeping: (now: Date) => Promise<void>;
  reverify: (connections: FeedConnection[], now: Date, startedMs: number) => Promise<string[]>;
  loadStoredCaption: (ioLineItemId: string) => Promise<StoredCaption | null>;
  loadAnalyticsCandidates: () => Promise<AnalyticsWork[]>;
  loadSpots: (now: Date) => Promise<DueSpot[]>;
  loadDealProfiles: (dealIds: string[]) => Promise<{ dealId: string; showProfileId: string | null }[]>;
  loadConnections: () => Promise<FeedConnection[]>;
  countActive: () => Promise<number>;
  findEpisode: (spot: DueSpot) => Promise<FoundEpisode | { error: string }>;
  commitQuota: (day: string, units: number) => Promise<{ accepted: number; missing: boolean }>;
  setReserve: (day: string, units: number) => Promise<void>;
  refresh: (connection: FeedConnection) => Promise<
    | { ok: true; accessToken: string; expiresAt: string }
    | { ok: false; invalidGrant: boolean }
  >;
  markReauth: (connectionId: string) => Promise<void>;
  listCaptions: typeof listCaptionTracks;
  downloadCaption: typeof downloadCaptionTrack;
  videoDetails: typeof fetchVideoDetails;
  fetchAnalytics: typeof fetchVideoAnalytics;
  fetchRetention: typeof fetchRetention;
  save: (row: AircheckPersist) => Promise<{ id: string }>;
  record: (input: LogEventInput) => Promise<unknown>;
  saveMetrics: (row: {
    io_line_item_id: string;
    connection_id: string;
    video_id: string;
    views: number | null;
    estimated_minutes_watched: number | null;
    average_view_duration_seconds: number | null;
    retention: RetentionPoint[] | null;
    video_duration_seconds: number | null;
    fetched_at: string;
    attempts: number;
  }) => Promise<void>;
  loadMetrics: (ioLineItemId: string) => Promise<MetricsSnapshot | null>;
  clock: () => number;
  timeBudgetMs: number;
  log: (line: string) => void;
}

export function clearCaptionText<
  T extends {
    transcript_text: string | null;
    transcript_segments: unknown;
    match_evidence: Record<string, unknown> | null;
  },
>(row: T): T {
  return {
    ...row,
    transcript_text: null,
    transcript_segments: null,
    match_evidence: row.match_evidence ? { ...row.match_evidence, excerpt: null } : row.match_evidence,
  };
}

function emptyReport(skipped: YoutubeCaptionReport["skipped"] = null): YoutubeCaptionReport {
  return {
    skipped,
    stopped: null,
    considered: 0,
    captioned: 0,
    ready: 0,
    failed: 0,
    analytics: 0,
  };
}

function clip(message: string): string {
  const trimmed = redactAircheckError(message).trim();
  if (trimmed.length <= MAX_ERROR) return trimmed;
  return trimmed.slice(0, MAX_ERROR);
}

function failureRow(spot: DueSpot, message: string, videoId: string | null): AircheckPersist {
  const attempt = spot.existingAttempt + 1;
  const prefix = `attempt=${attempt}; `;
  const body = clip(message).slice(0, Math.max(0, MAX_ERROR - prefix.length));
  return {
    io_line_item_id: spot.ioLineItemId,
    episode_identifier: videoId,
    audio_url: null,
    transcript_text: null,
    provider: YOUTUBE_CAPTION_PROVIDER,
    status: "failed",
    error: `${prefix}${body}`,
    audio_minutes: null,
    estimated_cost_usd: null,
    window_start: spot.window.start,
    window_end: spot.window.end,
    ready_for_review: false,
  };
}

function tokenDue(connection: FeedConnection, now: Date): boolean {
  if (!connection.accessToken) return true;
  const expires = Date.parse(connection.accessTokenExpiresAt ?? "");
  if (!Number.isFinite(expires)) return true;
  return expires - now.getTime() <= REFRESH_SKEW_MS;
}

function timedOut(deps: YoutubeCaptionDeps, startedMs: number): boolean {
  return deps.clock() - startedMs >= deps.timeBudgetMs;
}

function defaultDeps(now: Date): YoutubeCaptionDeps {
  const tokens = new Map<string, string>();
  const config = () => readYoutubeOauthConfig();
  return {
    now,
    configured: youtubeOauthConfigured,
    tablesReady: youtubeOauthTablesReady,
    housekeeping: (at) => runYoutubeHousekeeping(at),
    reverify: async (connections, at, startedMs) => {
      const dead: string[] = [];
      for (let index = connections.length - 1; index >= 0; index -= 1) {
        const connection = connections[index];
        if (!connection) continue;
        if (Date.now() - startedMs >= YOUTUBE_CAPTION_BUDGET_MS) break;
        const outcome = await refreshConnection(connection, tokens, at, true);
        if (!outcome.ok) {
          if (outcome.invalidGrant) {
            await markConnectionReauth(connection.id, at.toISOString());
            connections.splice(index, 1);
            dead.push(connection.id);
          }
          continue;
        }
        connection.accessToken = outcome.accessToken;
        connection.accessTokenExpiresAt = outcome.expiresAt;
        connection.lastVerifiedAt = at.toISOString();
        await markConnectionVerified(connection.id, at.toISOString());
      }
      return dead;
    },
    loadStoredCaption: readStoredCaption,
    loadAnalyticsCandidates: async () => {
      const rows = await loadAnalyticsCandidateRows();
      return rows.map((row) => ({ ...row, publishedAt: null }));
    },
    loadSpots: loadDueSpots,
    loadDealProfiles: loadDealShowProfiles,
    loadConnections: async () => {
      const key = config()?.encryptionKey;
      if (!key) return [];
      const rows = await listActiveConnections();
      const out: FeedConnection[] = [];
      for (const row of rows) {
        const opened = openConnection(row, key);
        if (!opened) {
          await markConnectionReauth(row.id);
          continue;
        }
        tokens.set(row.id, opened.refreshToken);
        out.push(opened.connection);
      }
      return out;
    },
    countActive: countActiveConnections,
    findEpisode: (spot) =>
      findYoutubeEpisode({
        channelId: spot.youtubeChannelId,
        episodeUrl: spot.episodeUrl,
        postDate: spot.postDate,
        window: spot.window,
        client: youtubeClientFromEnv(),
      }),
    commitQuota: async (day, units) => {
      const result = await commitLiveAircheckUnits(day, units);
      return { accepted: result.accepted, missing: result.missing };
    },
    setReserve: (day, units) => setLiveAircheckReserve(day, units),
    refresh: (connection) => refreshConnection(connection, tokens, now, false),
    markReauth: markConnectionReauth,
    listCaptions: listCaptionTracks,
    downloadCaption: downloadCaptionTrack,
    videoDetails: fetchVideoDetails,
    fetchAnalytics: fetchVideoAnalytics,
    fetchRetention,
    save: saveAircheckRun,
    record: writeEvent,
    saveMetrics,
    loadMetrics: loadMetricsAttempt,
    clock: () => Date.now(),
    timeBudgetMs: YOUTUBE_CAPTION_BUDGET_MS,
    log: (line) => console.info(clip(line)),
  };
}

function openConnection(
  row: StoredConnection,
  key: Buffer
): { connection: FeedConnection; refreshToken: string } | null {
  if (!row.refresh_token_enc) return null;
  try {
    const refreshToken = decryptString(row.refresh_token_enc, key);
    const accessToken = row.access_token_enc ? decryptString(row.access_token_enc, key) : null;
    const scopes = row.scopes ?? [];
    return {
      refreshToken,
      connection: {
        id: row.id,
        showProfileId: row.show_profile_id,
        channelId: row.channel_id,
        analytics: scopes.includes(YOUTUBE_OAUTH_SCOPES[1]),
        accessToken,
        accessTokenExpiresAt: row.access_token_expires_at,
        lastVerifiedAt: row.last_verified_at,
      },
    };
  } catch {
    return null;
  }
}

async function refreshConnection(
  connection: FeedConnection,
  tokens: Map<string, string>,
  now: Date,
  verified: boolean
): Promise<{ ok: true; accessToken: string; expiresAt: string } | { ok: false; invalidGrant: boolean }> {
  const refreshToken = tokens.get(connection.id);
  const oauth = readYoutubeOauthConfig();
  if (!refreshToken || !oauth) return { ok: false, invalidGrant: !refreshToken };
  try {
    const token = await refreshAccessToken({
      refreshToken,
      clientId: oauth.clientId,
      clientSecret: oauth.clientSecret,
    });
    const expiresAt = new Date(now.getTime() + (token.expiresIn ?? 3600) * 1000).toISOString();
    await storeRefreshedAccess({
      id: connection.id,
      accessTokenEnc: encryptString(token.accessToken, oauth.encryptionKey),
      accessTokenExpiresAt: expiresAt,
      now: now.toISOString(),
      verified,
    });
    if (token.refreshToken) tokens.set(connection.id, token.refreshToken);
    return { ok: true, accessToken: token.accessToken, expiresAt };
  } catch (err) {
    const invalidGrant = err instanceof GoogleOAuthError && err.code === "invalid_grant";
    return { ok: false, invalidGrant };
  }
}

function isFound(value: FoundEpisode | { error: string }): value is FoundEpisode {
  return !("error" in value);
}

export async function runYoutubeCaptionAirchecks(
  overrides: Partial<YoutubeCaptionDeps> = {},
  now = overrides.now ?? new Date()
): Promise<YoutubeCaptionReport> {
  const deps: YoutubeCaptionDeps = { ...defaultDeps(now), ...overrides, now };
  if (!deps.configured()) return emptyReport("not_configured");
  try {
    if (!(await deps.tablesReady())) return emptyReport("missing_tables");
  } catch (err) {
    deps.log(`[youtube-oauth] tables ${clip(err instanceof Error ? err.message : "unavailable")}`);
    return emptyReport("missing_tables");
  }

  const report = emptyReport();
  try {
    await deps.housekeeping(deps.now);
  } catch (err) {
    deps.log(`[youtube-oauth] housekeeping ${clip(err instanceof Error ? err.message : "failed")}`);
  }

  const started = deps.clock();
  let connections: FeedConnection[] = [];
  try {
    connections = await deps.loadConnections();
    const dropped = new Set(await deps.reverify(connections, deps.now, started));
    connections = connections.filter((connection) => !dropped.has(connection.id));
  } catch (err) {
    deps.log(`[youtube-oauth] connections ${clip(err instanceof Error ? err.message : "failed")}`);
    connections = [];
  }

  let spots: DueSpot[] = [];
  try {
    spots = await deps.loadSpots(deps.now);
  } catch (err) {
    deps.log(`[youtube-oauth] spots ${clip(err instanceof Error ? err.message : "failed")}`);
    return report;
  }

  const profiles = new Map<string, string | null>();
  try {
    const dealIds = [...new Set(spots.map((spot) => spot.dealId))];
    for (const row of await deps.loadDealProfiles(dealIds)) {
      profiles.set(row.dealId, row.showProfileId);
    }
  } catch (err) {
    deps.log(`[youtube-oauth] deals ${clip(err instanceof Error ? err.message : "failed")}`);
    return report;
  }

  const matched = spots.filter((spot) => connectionFor(spot, profiles, connections));
  const captioned = new Set<string>();
  const day = pacificDay(deps.now);
  const dead = new Set<string>();

  for (const spot of matched) {
    if (timedOut(deps, started)) {
      report.stopped = "time";
      deps.log("[youtube-oauth] stopped time");
      break;
    }
    const connection = connectionFor(spot, profiles, connections);
    if (!connection || dead.has(connection.id)) continue;
    report.considered += 1;
    try {
      const outcome = await processSpot(spot, connection, deps, day, started);
      if (outcome.stop) {
        report.stopped = outcome.stop;
        if (outcome.missing) report.skipped = "missing_tables";
        deps.log(`[youtube-oauth] stopped ${outcome.stop}`);
        break;
      }
      if (outcome.reauth) dead.add(connection.id);
      if (outcome.captioned) {
        report.captioned += 1;
        captioned.add(spot.ioLineItemId);
      }
      if (outcome.ready) report.ready += 1;
      if (outcome.failed) report.failed += 1;
      if (outcome.analytics) report.analytics += 1;
    } catch (err) {
      report.failed += 1;
      deps.log(`[youtube-oauth] line=${spot.ioLineItemId} failed ${clip(err instanceof Error ? err.message : "failed")}`);
      try {
        await deps.save(failureRow(spot, "YouTube caption check failed", null));
      } catch (saveErr) {
        deps.log(
          `[youtube-oauth] line=${spot.ioLineItemId} save failed ${clip(saveErr instanceof Error ? saveErr.message : "save failed")}`
        );
      }
    }
  }

  if (!report.stopped && report.skipped !== "missing_tables") {
    try {
      const analytics = await runAnalyticsPass(deps, connections, started);
      report.analytics += analytics.saved;
      if (analytics.stop) report.stopped = analytics.stop;
    } catch (err) {
      deps.log(`[youtube-oauth] analytics ${clip(err instanceof Error ? err.message : "failed")}`);
    }
  }

  try {
    const active = await deps.countActive();
    const pending = matched.filter((spot) => !captioned.has(spot.ioLineItemId)).length;
    await deps.setReserve(nextPacificDay(deps.now), tomorrowReserve({ pendingSpots: pending, activeConnections: active }));
  } catch (err) {
    deps.log(`[youtube-oauth] reserve ${clip(err instanceof Error ? err.message : "failed")}`);
  }

  return report;
}

function connectionFor(
  spot: DueSpot,
  profiles: Map<string, string | null>,
  connections: FeedConnection[]
): FeedConnection | null {
  if (spot.format !== "youtube" || !spot.youtubeChannelId) return null;
  const profileId = profiles.get(spot.dealId);
  if (!profileId) return null;
  return (
    connections.find(
      (connection) => connection.showProfileId === profileId && connection.channelId === spot.youtubeChannelId
    ) ?? null
  );
}

interface SpotOutcome {
  stop: false | "quota" | "time";
  missing: boolean;
  reauth: boolean;
  captioned: boolean;
  ready: boolean;
  failed: boolean;
  analytics: boolean;
}

async function ensureToken(
  connection: FeedConnection,
  deps: YoutubeCaptionDeps
): Promise<{ ok: true; accessToken: string } | { ok: false; reauth: boolean }> {
  if (!tokenDue(connection, deps.now) && connection.accessToken) {
    return { ok: true, accessToken: connection.accessToken };
  }
  const refreshed = await deps.refresh(connection);
  if (!refreshed.ok) {
    if (refreshed.invalidGrant) await deps.markReauth(connection.id);
    return { ok: false, reauth: refreshed.invalidGrant };
  }
  connection.accessToken = refreshed.accessToken;
  connection.accessTokenExpiresAt = refreshed.expiresAt;
  return { ok: true, accessToken: refreshed.accessToken };
}

async function takeQuota(
  deps: YoutubeCaptionDeps,
  day: string,
  units: number
): Promise<{ ok: true } | { ok: false; missing: boolean }> {
  const committed = await deps.commitQuota(day, units);
  if (committed.missing) return { ok: false, missing: true };
  if (committed.accepted < units) return { ok: false, missing: false };
  return { ok: true };
}

async function processSpot(
  spot: DueSpot,
  connection: FeedConnection,
  deps: YoutubeCaptionDeps,
  day: string,
  started: number
): Promise<SpotOutcome> {
  const none: SpotOutcome = {
    stop: false,
    missing: false,
    reauth: false,
    captioned: false,
    ready: false,
    failed: false,
    analytics: false,
  };
  if (timedOut(deps, started)) return { ...none, stop: "time" };
  const episodeQuota = await takeQuota(deps, day, AIRCHECK_EPISODE_UNITS);
  if (!episodeQuota.ok) return { ...none, stop: "quota", missing: episodeQuota.missing };

  if (timedOut(deps, started)) return { ...none, stop: "time" };
  const token = await ensureToken(connection, deps);
  if (!token.ok) return { ...none, reauth: token.reauth };

  if (timedOut(deps, started)) return { ...none, stop: "time" };
  const found = await deps.findEpisode(spot);
  if (!isFound(found) || !isVideoId(found.episodeIdentifier)) return none;

  if (timedOut(deps, started)) return { ...none, stop: "time" };
  const details = await deps.videoDetails(token.accessToken, found.episodeIdentifier);
  if (!details.ok && details.reason === "quota") return { ...none, stop: "quota" };
  const durationSeconds = found.durationSeconds ?? (details.ok ? details.details.durationSeconds : null);
  const defaultLanguage = details.ok ? details.details.defaultLanguage : null;

  const stored = await deps.loadStoredCaption(spot.ioLineItemId);
  if (stored) {
    const judged = await saveJudgment(deps, spot, found.episodeIdentifier, stored.transcript, stored.segments, durationSeconds);
    return { ...none, captioned: true, ready: judged.ready };
  }

  if (timedOut(deps, started)) return { ...none, stop: "time" };
  const captionQuota = await takeQuota(deps, day, AIRCHECK_CAPTION_UNITS);
  if (!captionQuota.ok) return { ...none, stop: "quota", missing: captionQuota.missing };

  if (timedOut(deps, started)) return { ...none, stop: "time" };
  const listed = await deps.listCaptions(token.accessToken, found.episodeIdentifier);
  if (!listed.ok) {
    if (listed.reason === "quota") return { ...none, stop: "quota" };
    await deps.save(failureRow(spot, captionFailureMessage(listed.reason), found.episodeIdentifier));
    return { ...none, failed: true };
  }
  const track = pickCaptionTrack(listed.tracks, defaultLanguage);
  if (!track) {
    await deps.save(failureRow(spot, "no caption track", found.episodeIdentifier));
    return { ...none, failed: true };
  }
  if (timedOut(deps, started)) return { ...none, stop: "time" };
  const downloaded = await deps.downloadCaption(token.accessToken, track.id);
  if (!downloaded.ok) {
    if (downloaded.reason === "quota") return { ...none, stop: "quota" };
    await deps.save(failureRow(spot, captionFailureMessage(downloaded.reason), found.episodeIdentifier));
    return { ...none, failed: true };
  }
  const segments = vttToSegments(downloaded.vtt);
  const transcript = segmentsToTranscript(segments);
  if (!transcript) {
    await deps.save(failureRow(spot, "no caption track", found.episodeIdentifier));
    return { ...none, failed: true };
  }

  const judged = await saveJudgment(deps, spot, found.episodeIdentifier, transcript, segments, durationSeconds);
  return { ...none, captioned: true, ready: judged.ready };
}

async function saveJudgment(
  deps: YoutubeCaptionDeps,
  spot: DueSpot,
  videoId: string,
  transcript: string,
  segments: AircheckSegment[],
  durationSeconds: number | null
): Promise<{ ready: boolean }> {
  const located = locateAdRead({
    status: "transcribed",
    transcript,
    segments,
    durationSeconds,
    buy: spot.buy,
  });
  const saved = await deps.save({
    io_line_item_id: spot.ioLineItemId,
    episode_identifier: videoId,
    audio_url: null,
    transcript_text: transcript,
    transcript_segments: segments,
    provider: YOUTUBE_CAPTION_PROVIDER,
    status: "transcribed",
    error: null,
    duration_seconds: durationSeconds,
    audio_minutes: null,
    estimated_cost_usd: null,
    window_start: spot.window.start,
    window_end: spot.window.end,
    ready_for_review: located.readyForReview,
    confidence: located.confidence,
    ad_start_seconds: located.adStartSeconds,
    ad_end_seconds: located.adEndSeconds,
    match_reasons: located.reasons,
    match_result: located.judgment.match_result,
    match_evidence: located.judgment.match_evidence,
    matched_at: located.readyForReview ? deps.now.toISOString() : null,
  });
  if (located.readyForReview) {
    await deps.record({
      eventType: "aircheck.ready_for_review",
      entityType: "aircheck",
      entityId: saved.id,
      payload: {
        io_line_item_id: spot.ioLineItemId,
        match_result: located.judgment.match_result,
        confidence: located.confidence,
        ad_start_seconds: located.adStartSeconds,
        ad_end_seconds: located.adEndSeconds,
      },
    });
  }
  return { ready: located.readyForReview };
}

async function runAnalyticsPass(
  deps: YoutubeCaptionDeps,
  connections: FeedConnection[],
  started: number
): Promise<{ saved: number; stop: null | "quota" | "time" }> {
  const candidates = await deps.loadAnalyticsCandidates();
  let saved = 0;
  for (const item of candidates) {
    if (item.attempts >= 10) continue;
    const connection = connections.find(
      (row) => row.analytics && row.showProfileId && row.showProfileId === item.showProfileId
    );
    if (!connection) continue;
    if (timedOut(deps, started)) return { saved, stop: "time" };
    const token = await ensureToken(connection, deps);
    if (!token.ok) continue;

    let publishedAt = item.publishedAt;
    if (!publishedAt) {
      if (timedOut(deps, started)) return { saved, stop: "time" };
      const lookup = await takeQuota(deps, pacificDay(deps.now), 1);
      if (!lookup.ok) return { saved, stop: "quota" };
      const details = await deps.videoDetails(token.accessToken, item.videoId);
      if (!details.ok) {
        if (details.reason === "quota") return { saved, stop: "quota" };
        continue;
      }
      publishedAt = details.details.publishedAt;
    }
    if (!publishedAt) continue;
    const complete = item.views != null && (item.hasRetention || item.adStartSeconds == null || item.adEndSeconds == null);
    const window = analyticsWindow({
      now: deps.now,
      publishedAt,
      attempts: item.attempts,
      hasViews: complete,
    });
    if (window !== "due") continue;

    if (timedOut(deps, started)) return { saved, stop: "time" };
    const summary = await deps.fetchAnalytics({
      accessToken: token.accessToken,
      videoId: item.videoId,
      publishedAt,
      now: deps.now,
    });
    if (!summary.ok) {
      if (summary.reason === "quota") return { saved, stop: "quota" };
      await deps.saveMetrics({
        io_line_item_id: item.ioLineItemId,
        connection_id: connection.id,
        video_id: item.videoId,
        views: item.views,
        estimated_minutes_watched: null,
        average_view_duration_seconds: null,
        retention: null,
        video_duration_seconds: item.durationSeconds,
        fetched_at: deps.now.toISOString(),
        attempts: item.attempts + 1,
      });
      continue;
    }

    let retention: RetentionPoint[] | null = null;
    if (item.durationSeconds && item.adStartSeconds != null && item.adEndSeconds != null) {
      if (timedOut(deps, started)) return { saved, stop: "time" };
      const points = await deps.fetchRetention({
        accessToken: token.accessToken,
        videoId: item.videoId,
        publishedAt,
        now: deps.now,
      });
      if (!points.ok) {
        if (points.reason === "quota") return { saved, stop: "quota" };
      } else {
        retention = retentionPointsForAd({
          points: points.points,
          durationSeconds: item.durationSeconds,
          adStartSeconds: item.adStartSeconds,
          adEndSeconds: item.adEndSeconds,
        });
      }
    }

    await deps.saveMetrics({
      io_line_item_id: item.ioLineItemId,
      connection_id: connection.id,
      video_id: item.videoId,
      views: summary.analytics.views,
      estimated_minutes_watched: summary.analytics.estimatedMinutesWatched,
      average_view_duration_seconds: summary.analytics.averageViewDurationSeconds,
      retention,
      video_duration_seconds: item.durationSeconds,
      fetched_at: deps.now.toISOString(),
      attempts: item.attempts + 1,
    });
    saved += 1;
  }
  return { saved, stop: null };
}
