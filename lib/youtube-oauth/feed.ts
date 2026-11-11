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
  loadDealShowProfiles,
  loadMetricsAttempt,
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
const VERIFY_MS = 30 * 24 * 60 * 60 * 1000;
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

export interface YoutubeCaptionDeps {
  now: Date;
  configured: () => boolean;
  tablesReady: () => Promise<boolean>;
  housekeeping: (now: Date) => Promise<void>;
  reverify: (connections: FeedConnection[], now: Date) => Promise<void>;
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

function verifyDue(connection: FeedConnection, now: Date): boolean {
  const verified = Date.parse(connection.lastVerifiedAt ?? "");
  if (!Number.isFinite(verified)) return true;
  return now.getTime() - verified >= VERIFY_MS;
}

function defaultDeps(now: Date): YoutubeCaptionDeps {
  const tokens = new Map<string, string>();
  const config = () => readYoutubeOauthConfig();
  return {
    now,
    configured: youtubeOauthConfigured,
    tablesReady: youtubeOauthTablesReady,
    housekeeping: (at) => runYoutubeHousekeeping(at),
    reverify: async (connections, at) => {
      for (const connection of connections) {
        if (!verifyDue(connection, at)) continue;
        const outcome = await refreshConnection(connection, tokens, at, true);
        if (!outcome.ok) {
          if (outcome.invalidGrant) await markConnectionReauth(connection.id);
          continue;
        }
        connection.accessToken = outcome.accessToken;
        connection.accessTokenExpiresAt = outcome.expiresAt;
        connection.lastVerifiedAt = at.toISOString();
        await markConnectionVerified(connection.id, at.toISOString());
      }
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

  let connections: FeedConnection[] = [];
  try {
    connections = await deps.loadConnections();
    await deps.reverify(connections, deps.now);
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
  const started = deps.clock();
  const day = pacificDay(deps.now);
  const dead = new Set<string>();

  for (const spot of matched) {
    if (deps.clock() - started >= deps.timeBudgetMs) {
      report.stopped = "time";
      deps.log("[youtube-oauth] stopped time");
      break;
    }
    const connection = connectionFor(spot, profiles, connections);
    if (!connection || dead.has(connection.id)) continue;
    report.considered += 1;
    try {
      const outcome = await processSpot(spot, connection, deps, day);
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
  day: string
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
  const episodeQuota = await takeQuota(deps, day, AIRCHECK_EPISODE_UNITS);
  if (!episodeQuota.ok) return { ...none, stop: "quota", missing: episodeQuota.missing };

  const token = await ensureToken(connection, deps);
  if (!token.ok) return { ...none, reauth: token.reauth };

  const found = await deps.findEpisode(spot);
  if (!isFound(found) || !isVideoId(found.episodeIdentifier)) return none;

  const details = await deps.videoDetails(token.accessToken, found.episodeIdentifier);
  if (!details.ok && details.reason === "quota") return { ...none, stop: "quota" };
  const durationSeconds = found.durationSeconds ?? (details.ok ? details.details.durationSeconds : null);
  const publishedAt = details.ok ? details.details.publishedAt : null;
  const defaultLanguage = details.ok ? details.details.defaultLanguage : null;

  const captionQuota = await takeQuota(deps, day, AIRCHECK_CAPTION_UNITS);
  if (!captionQuota.ok) return { ...none, stop: "quota", missing: captionQuota.missing };

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

  const located = locateAdRead({
    status: "transcribed",
    transcript,
    segments,
    durationSeconds,
    buy: spot.buy,
  });
  const saved = await deps.save({
    io_line_item_id: spot.ioLineItemId,
    episode_identifier: found.episodeIdentifier,
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

  const analytics = await maybeAnalytics({
    deps,
    connection,
    accessToken: token.accessToken,
    spot,
    videoId: found.episodeIdentifier,
    publishedAt,
    durationSeconds,
    adStart: located.adStartSeconds,
    adEnd: located.adEndSeconds,
  });
  if (analytics === "quota") return { ...none, stop: "quota", captioned: true, ready: located.readyForReview };
  return {
    ...none,
    captioned: true,
    ready: located.readyForReview,
    analytics: analytics === "saved",
  };
}

async function maybeAnalytics(input: {
  deps: YoutubeCaptionDeps;
  connection: FeedConnection;
  accessToken: string;
  spot: DueSpot;
  videoId: string;
  publishedAt: string | null;
  durationSeconds: number | null;
  adStart: number | null;
  adEnd: number | null;
}): Promise<"saved" | "quota" | "skipped"> {
  if (!input.connection.analytics || !input.publishedAt) return "skipped";
  const existing = await input.deps.loadMetrics(input.spot.ioLineItemId);
  const attempts = existing?.attempts ?? 0;
  const hasViews = existing?.views != null;
  const complete = hasViews && (existing?.hasRetention || input.adStart == null || input.adEnd == null);
  const window = analyticsWindow({
    now: input.deps.now,
    publishedAt: input.publishedAt,
    attempts,
    hasViews: complete,
  });
  if (window !== "due") return "skipped";

  const summary = await input.deps.fetchAnalytics({
    accessToken: input.accessToken,
    videoId: input.videoId,
    publishedAt: input.publishedAt,
    now: input.deps.now,
  });
  if (!summary.ok) {
    if (summary.reason === "quota") return "quota";
    await input.deps.saveMetrics({
      io_line_item_id: input.spot.ioLineItemId,
      connection_id: input.connection.id,
      video_id: input.videoId,
      views: existing?.views ?? null,
      estimated_minutes_watched: null,
      average_view_duration_seconds: null,
      retention: null,
      video_duration_seconds: input.durationSeconds,
      fetched_at: input.deps.now.toISOString(),
      attempts: attempts + 1,
    });
    return "skipped";
  }

  let retention: RetentionPoint[] | null = null;
  if (input.durationSeconds && input.adStart != null && input.adEnd != null) {
    const points = await input.deps.fetchRetention({
      accessToken: input.accessToken,
      videoId: input.videoId,
      publishedAt: input.publishedAt,
      now: input.deps.now,
    });
    if (!points.ok) {
      if (points.reason === "quota") return "quota";
    } else {
      retention = retentionPointsForAd({
        points: points.points,
        durationSeconds: input.durationSeconds,
        adStartSeconds: input.adStart,
        adEndSeconds: input.adEnd,
      });
    }
  }

  await input.deps.saveMetrics({
    io_line_item_id: input.spot.ioLineItemId,
    connection_id: input.connection.id,
    video_id: input.videoId,
    views: summary.analytics.views,
    estimated_minutes_watched: summary.analytics.estimatedMinutesWatched,
    average_view_duration_seconds: summary.analytics.averageViewDurationSeconds,
    retention,
    video_duration_seconds: input.durationSeconds,
    fetched_at: input.deps.now.toISOString(),
    attempts: attempts + 1,
  });
  return "saved";
}
