// Service-role access to the YouTube OAuth tables.
// Tokens here are ciphertext. Status reads never select them.
// A missing 088 table is a skip, not a throw.

import { supabaseAdmin } from "@/lib/supabase/admin";
import { YOUTUBE_OAUTH_SCOPES } from "./config";
import type { RetentionPoint } from "./analytics";

export type ConnectionStatus = "active" | "reauth_required" | "revoked";

export interface StoredConnection {
  id: string;
  user_id: string;
  show_profile_id: string | null;
  channel_id: string;
  channel_title: string | null;
  scopes: string[];
  refresh_token_enc: string | null;
  access_token_enc: string | null;
  access_token_expires_at: string | null;
  status: ConnectionStatus;
  last_verified_at: string | null;
  connected_at: string | null;
  updated_at: string | null;
  revoked_at: string | null;
}

export interface YoutubeStatus {
  connected: boolean;
  channel_id: string | null;
  channel_title: string | null;
  status: ConnectionStatus | null;
  analytics_enabled: boolean;
}

export interface MetricsWrite {
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
}

const STATUS_COLUMNS = "channel_id, channel_title, status, scopes";
const SECRET_COLUMNS =
  "id, user_id, show_profile_id, channel_id, channel_title, scopes, refresh_token_enc, access_token_enc, access_token_expires_at, status, last_verified_at, connected_at, updated_at, revoked_at";

const EMPTY_STATUS: YoutubeStatus = {
  connected: false,
  channel_id: null,
  channel_title: null,
  status: null,
  analytics_enabled: false,
};

export function analyticsEnabled(scopes: string[] | null | undefined): boolean {
  return (scopes ?? []).includes(YOUTUBE_OAUTH_SCOPES[1]);
}

export function toYoutubeStatus(
  row: { channel_id: string; channel_title: string | null; status: ConnectionStatus; scopes: string[] } | null
): YoutubeStatus {
  if (!row || row.status === "revoked") return EMPTY_STATUS;
  return {
    connected: row.status === "active",
    channel_id: row.channel_id,
    channel_title: row.channel_title,
    status: row.status,
    analytics_enabled: analyticsEnabled(row.scopes),
  };
}

function missingRelation(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  const code = error.code ?? "";
  const message = error.message ?? "";
  return code === "42P01" || code === "PGRST205" || /\b42P01\b|does not exist|schema cache/i.test(message);
}

export async function youtubeOauthTablesReady(): Promise<boolean> {
  const { error } = await supabaseAdmin.from("youtube_oauth_connections").select("id").limit(1);
  if (!error) return true;
  if (missingRelation(error)) return false;
  throw new Error("youtube oauth tables");
}

export async function requireShowProfile(
  userId: string
): Promise<{ ok: true; showProfileId: string } | { ok: false }> {
  const { data: profile, error } = await supabaseAdmin
    .from("profiles")
    .select("role")
    .eq("id", userId)
    .maybeSingle();
  if (error || profile?.role !== "show") return { ok: false };
  const { data: show, error: showError } = await supabaseAdmin
    .from("show_profiles")
    .select("id")
    .eq("user_id", userId)
    .maybeSingle();
  if (showError || !show?.id) return { ok: false };
  return { ok: true, showProfileId: show.id as string };
}

export async function readYoutubeStatus(userId: string): Promise<YoutubeStatus> {
  const { data, error } = await supabaseAdmin
    .from("youtube_oauth_connections")
    .select(STATUS_COLUMNS)
    .eq("user_id", userId);
  if (error) {
    if (missingRelation(error)) return EMPTY_STATUS;
    throw new Error("youtube status failed");
  }
  const rows = (data ?? []) as Array<{
    channel_id: string;
    channel_title: string | null;
    status: ConnectionStatus;
    scopes: string[];
  }>;
  const active = rows.find((row) => row.status === "active");
  const reauth = rows.find((row) => row.status === "reauth_required");
  return toYoutubeStatus(active ?? reauth ?? null);
}

export async function listActiveConnections(): Promise<StoredConnection[]> {
  const { data, error } = await supabaseAdmin
    .from("youtube_oauth_connections")
    .select(SECRET_COLUMNS)
    .eq("status", "active");
  if (error) {
    if (missingRelation(error)) return [];
    throw new Error("youtube connections failed");
  }
  return (data ?? []) as StoredConnection[];
}

export async function countActiveConnections(): Promise<number> {
  const { count, error } = await supabaseAdmin
    .from("youtube_oauth_connections")
    .select("id", { count: "exact", head: true })
    .eq("status", "active");
  if (error) {
    if (missingRelation(error)) return 0;
    throw new Error("youtube connections failed");
  }
  return count ?? 0;
}

export async function loadDealShowProfiles(
  dealIds: string[]
): Promise<{ dealId: string; showProfileId: string | null }[]> {
  if (dealIds.length === 0) return [];
  const { data, error } = await supabaseAdmin
    .from("deals")
    .select("id, show_profile_id")
    .in("id", dealIds);
  if (error) throw new Error("deal profile lookup failed");
  return (data ?? []).map((row) => ({
    dealId: row.id as string,
    showProfileId: (row.show_profile_id as string | null) ?? null,
  }));
}

export async function activeChannelOwner(
  channelId: string
): Promise<{ ok: true; userId: string | null } | { ok: false; reason: "missing" }> {
  const { data, error } = await supabaseAdmin
    .from("youtube_oauth_connections")
    .select("user_id")
    .eq("channel_id", channelId)
    .eq("status", "active")
    .maybeSingle();
  if (error) {
    if (missingRelation(error)) return { ok: false, reason: "missing" };
    throw new Error("youtube connection lookup failed");
  }
  return { ok: true, userId: typeof data?.user_id === "string" ? data.user_id : null };
}

export async function upsertConnection(input: {
  userId: string;
  showProfileId: string;
  channelId: string;
  channelTitle: string | null;
  scopes: string[];
  refreshTokenEnc: string;
  accessTokenEnc: string;
  accessTokenExpiresAt: string | null;
  now: string;
}): Promise<{ ok: true; id: string } | { ok: false; reason: "channel_taken" | "missing" }> {
  const holder = await activeChannelOwner(input.channelId);
  if (!holder.ok) return holder;
  if (holder.userId && holder.userId !== input.userId) return { ok: false, reason: "channel_taken" };

  const { data, error } = await supabaseAdmin
    .from("youtube_oauth_connections")
    .upsert(
      {
        user_id: input.userId,
        show_profile_id: input.showProfileId,
        channel_id: input.channelId,
        channel_title: input.channelTitle,
        scopes: input.scopes,
        refresh_token_enc: input.refreshTokenEnc,
        access_token_enc: input.accessTokenEnc,
        access_token_expires_at: input.accessTokenExpiresAt,
        key_version: 1,
        status: "active",
        connected_at: input.now,
        last_refreshed_at: input.now,
        last_verified_at: input.now,
        revoked_at: null,
        reauth_required_at: null,
      },
      { onConflict: "user_id,channel_id" }
    )
    .select("id")
    .single();
  if (error) {
    if (missingRelation(error)) return { ok: false, reason: "missing" };
    if (error.code === "23505") return { ok: false, reason: "channel_taken" };
    throw new Error("youtube connection save failed");
  }
  return { ok: true, id: data.id as string };
}

export async function storeRefreshedAccess(input: {
  id: string;
  accessTokenEnc: string;
  accessTokenExpiresAt: string;
  now: string;
  verified: boolean;
}): Promise<void> {
  const patch: Record<string, string> = {
    access_token_enc: input.accessTokenEnc,
    access_token_expires_at: input.accessTokenExpiresAt,
    last_refreshed_at: input.now,
  };
  if (input.verified) patch.last_verified_at = input.now;
  const { error } = await supabaseAdmin.from("youtube_oauth_connections").update(patch).eq("id", input.id);
  if (error && !missingRelation(error)) throw new Error("youtube token update failed");
}

export async function markConnectionReauth(id: string, at = new Date().toISOString()): Promise<void> {
  const { error } = await supabaseAdmin
    .from("youtube_oauth_connections")
    .update({
      status: "reauth_required",
      refresh_token_enc: null,
      access_token_enc: null,
      access_token_expires_at: null,
      reauth_required_at: at,
    })
    .eq("id", id)
    .eq("status", "active");
  if (error && !missingRelation(error)) throw new Error("youtube reauth failed");
}

export async function markConnectionVerified(id: string, at: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from("youtube_oauth_connections")
    .update({ last_verified_at: at })
    .eq("id", id);
  if (error && !missingRelation(error)) throw new Error("youtube verify failed");
}

export async function disconnectYoutubeUser(userId: string): Promise<"ok" | "missing"> {
  const { error } = await supabaseAdmin.rpc("youtube_oauth_disconnect", { p_user_id: userId });
  if (error) {
    if (missingRelation(error) || error.code === "PGRST202" || /could not find the function/i.test(error.message ?? "")) {
      return "missing";
    }
    throw new Error("youtube disconnect failed");
  }
  return "ok";
}

export async function runYoutubeHousekeeping(now: Date): Promise<void> {
  const { error } = await supabaseAdmin.rpc("youtube_oauth_housekeeping", { p_now: now.toISOString() });
  if (error && !missingRelation(error) && error.code !== "PGRST202") {
    throw new Error("youtube housekeeping failed");
  }
}

export async function loadMetricsAttempt(
  ioLineItemId: string
): Promise<{ attempts: number; views: number | null; hasRetention: boolean } | null> {
  const { data, error } = await supabaseAdmin
    .from("youtube_aircheck_metrics")
    .select("attempts, views, retention")
    .eq("io_line_item_id", ioLineItemId)
    .maybeSingle();
  if (error) {
    if (missingRelation(error)) return null;
    throw new Error("youtube metrics read failed");
  }
  if (!data) return null;
  return {
    attempts: Number(data.attempts ?? 0),
    views: data.views == null ? null : Number(data.views),
    hasRetention: Array.isArray(data.retention) && data.retention.length > 0,
  };
}

export async function saveMetrics(row: MetricsWrite): Promise<void> {
  const { error } = await supabaseAdmin.from("youtube_aircheck_metrics").upsert(
    {
      io_line_item_id: row.io_line_item_id,
      connection_id: row.connection_id,
      video_id: row.video_id,
      views: row.views,
      estimated_minutes_watched: row.estimated_minutes_watched,
      average_view_duration_seconds: row.average_view_duration_seconds,
      retention: row.retention,
      video_duration_seconds: row.video_duration_seconds,
      fetched_at: row.fetched_at,
      attempts: row.attempts,
    },
    { onConflict: "io_line_item_id" }
  );
  if (error && !missingRelation(error)) throw new Error("youtube metrics save failed");
}

export interface LiveCiphertext {
  id: string;
  channel_id: string;
  refresh_token_enc: string | null;
  access_token_enc: string | null;
}

/** Every non-revoked grant for the user. Disconnect revokes each one. */
export async function listLiveCiphertexts(userId: string): Promise<LiveCiphertext[]> {
  const { data, error } = await supabaseAdmin
    .from("youtube_oauth_connections")
    .select("id, channel_id, refresh_token_enc, access_token_enc")
    .eq("user_id", userId)
    .in("status", ["active", "reauth_required"]);
  if (error) {
    if (missingRelation(error)) return [];
    throw new Error("youtube connection read failed");
  }
  return (data ?? []) as LiveCiphertext[];
}

export async function retireConnection(id: string, at = new Date().toISOString()): Promise<void> {
  const { error } = await supabaseAdmin
    .from("youtube_oauth_connections")
    .update({
      status: "revoked",
      refresh_token_enc: null,
      access_token_enc: null,
      access_token_expires_at: null,
      revoked_at: at,
    })
    .eq("id", id)
    .in("status", ["active", "reauth_required"]);
  if (error && !missingRelation(error)) throw new Error("youtube retire failed");
}

export interface AnalyticsCandidateRow {
  ioLineItemId: string;
  videoId: string;
  showProfileId: string | null;
  durationSeconds: number | null;
  adStartSeconds: number | null;
  adEndSeconds: number | null;
  attempts: number;
  views: number | null;
  hasRetention: boolean;
}

const ANALYTICS_CANDIDATE_WINDOW_MS = 16 * 24 * 60 * 60 * 1000;

export async function loadAnalyticsCandidateRows(now: Date): Promise<AnalyticsCandidateRow[]> {
  const since = new Date(now.getTime() - ANALYTICS_CANDIDATE_WINDOW_MS).toISOString();
  const { data, error } = await supabaseAdmin
    .from("airchecks")
    .select("io_line_item_id, episode_identifier, duration_seconds, ad_start_seconds, ad_end_seconds")
    .eq("provider", "youtube-captions")
    .eq("status", "transcribed")
    .gt("created_at", since);
  if (error) {
    if (missingRelation(error)) return [];
    throw new Error("youtube analytics candidates failed");
  }
  const airchecks = (data ?? []).filter(
    (row) => typeof row.episode_identifier === "string" && /^[A-Za-z0-9_-]{11}$/.test(row.episode_identifier)
  );
  if (airchecks.length === 0) return [];
  const lineIds = airchecks.map((row) => row.io_line_item_id as string);
  const lines = await supabaseAdmin.from("io_line_items").select("id, io_id").in("id", lineIds);
  if (lines.error) throw new Error("youtube analytics lines failed");
  const ioIds = [...new Set((lines.data ?? []).map((row) => row.io_id as string).filter(Boolean))];
  const ios = ioIds.length
    ? await supabaseAdmin.from("insertion_orders").select("id, deal_id").in("id", ioIds)
    : { data: [], error: null };
  if (ios.error) throw new Error("youtube analytics orders failed");
  const dealIds = [...new Set((ios.data ?? []).map((row) => row.deal_id as string).filter(Boolean))];
  const deals = dealIds.length
    ? await supabaseAdmin.from("deals").select("id, show_profile_id").in("id", dealIds)
    : { data: [], error: null };
  if (deals.error) throw new Error("youtube analytics deals failed");
  const metrics = await supabaseAdmin
    .from("youtube_aircheck_metrics")
    .select("io_line_item_id, attempts, views, retention")
    .in("io_line_item_id", lineIds);
  if (metrics.error && !missingRelation(metrics.error)) throw new Error("youtube analytics metrics failed");

  const lineToIo = new Map((lines.data ?? []).map((row) => [row.id as string, row.io_id as string]));
  const ioToDeal = new Map((ios.data ?? []).map((row) => [row.id as string, row.deal_id as string]));
  const dealToProfile = new Map(
    (deals.data ?? []).map((row) => [row.id as string, (row.show_profile_id as string | null) ?? null])
  );
  const metricByLine = new Map((metrics.data ?? []).map((row) => [row.io_line_item_id as string, row]));

  return airchecks.map((row) => {
    const lineId = row.io_line_item_id as string;
    const dealId = ioToDeal.get(lineToIo.get(lineId) ?? "");
    const metric = metricByLine.get(lineId);
    return {
      ioLineItemId: lineId,
      videoId: row.episode_identifier as string,
      showProfileId: dealId ? (dealToProfile.get(dealId) ?? null) : null,
      durationSeconds: row.duration_seconds == null ? null : Number(row.duration_seconds),
      adStartSeconds: row.ad_start_seconds == null ? null : Number(row.ad_start_seconds),
      adEndSeconds: row.ad_end_seconds == null ? null : Number(row.ad_end_seconds),
      attempts: Number(metric?.attempts ?? 0),
      views: metric?.views == null ? null : Number(metric.views),
      hasRetention: Array.isArray(metric?.retention) && metric.retention.length > 0,
    };
  });
}

export async function loadStoredCaption(
  ioLineItemId: string
): Promise<{ transcript: string; segments: { start_seconds: number; end_seconds: number; text: string }[] } | null> {
  const { data, error } = await supabaseAdmin
    .from("airchecks")
    .select("transcript_text, transcript_segments, provider")
    .eq("io_line_item_id", ioLineItemId)
    .eq("provider", "youtube-captions")
    .maybeSingle();
  if (error) {
    if (missingRelation(error)) return null;
    throw new Error("youtube caption read failed");
  }
  const text = typeof data?.transcript_text === "string" ? data.transcript_text.trim() : "";
  if (!text) return null;
  const segments = Array.isArray(data?.transcript_segments) ? data.transcript_segments : [];
  return { transcript: text, segments };
}
