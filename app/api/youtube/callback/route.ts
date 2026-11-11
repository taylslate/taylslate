// GET /api/youtube/callback
// Checks the sealed cookie, then exchanges the code. Every path clears
// the cookie. Redirects only to /settings/youtube. A next parameter is ignored.

import { NextRequest, NextResponse } from "next/server";
import { logEvent } from "@/lib/data/events";
import type { LogEventInput } from "@/lib/data/events";
import { getAuthenticatedUser } from "@/lib/data/queries";
import {
  clearYoutubeOauthCookie,
  readYoutubeOauthConfig,
  YOUTUBE_OAUTH_COOKIE,
  YOUTUBE_OAUTH_COOKIE_MAX_AGE_SEC,
  youtubeOauthConfigured,
  youtubeSettingsUrl,
  type YoutubeOauthErrorCode,
} from "@/lib/youtube-oauth/config";
import { decryptString, encryptString, openJson, safeEqual, sha256Hex } from "@/lib/youtube-oauth/crypto";
import {
  exchangeAuthorizationCode,
  listOwnedChannel,
  parseGrantedScopes,
  revokeGoogleToken,
} from "@/lib/youtube-oauth/google";
import { enforceYoutubeCallback } from "@/lib/youtube-oauth/limits";
import {
  listLiveCiphertexts,
  requireShowProfile,
  retireConnection,
  upsertConnection,
  youtubeOauthTablesReady,
} from "@/lib/youtube-oauth/store";

export const runtime = "nodejs";

function unavailable(): NextResponse {
  const response = NextResponse.json({ error: "unavailable" }, { status: 503 });
  clearYoutubeOauthCookie(response);
  return response;
}

function redirectError(code: YoutubeOauthErrorCode): NextResponse {
  const target = youtubeSettingsUrl({ error: code });
  const response = NextResponse.redirect(target ?? "https://www.taylslate.com/settings/youtube");
  clearYoutubeOauthCookie(response);
  return response;
}

export async function GET(request: NextRequest) {
  if (!youtubeOauthConfigured()) return unavailable();
  const config = readYoutubeOauthConfig();
  if (!config) return unavailable();

  try {
    if (!(await youtubeOauthTablesReady())) return unavailable();
  } catch {
    return unavailable();
  }

  const user = await getAuthenticatedUser();
  if (!user) return redirectError("user");

  const limited = await enforceYoutubeCallback(user.id, request);
  if (limited) {
    clearYoutubeOauthCookie(limited);
    return limited;
  }

  const sealed = request.cookies.get(YOUTUBE_OAUTH_COOKIE)?.value ?? "";
  const payload = sealed ? openJson(sealed, config.encryptionKey) : null;
  if (!payload) return redirectError("state");
  if (Date.now() - payload.issued_at > YOUTUBE_OAUTH_COOKIE_MAX_AGE_SEC * 1000) {
    return redirectError("expired");
  }
  if (payload.user_id !== user.id) return redirectError("user");

  const state = request.nextUrl.searchParams.get("state") ?? "";
  if (!state || !safeEqual(sha256Hex(state), payload.state_hash)) return redirectError("state");

  const googleError = request.nextUrl.searchParams.get("error");
  if (googleError) return redirectError("denied");

  const code = request.nextUrl.searchParams.get("code")?.trim() ?? "";
  if (!code) return redirectError("exchange");

  let accessToken = "";
  let refreshPlain = "";
  try {
    const token = await exchangeAuthorizationCode({
      code,
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      redirectUri: config.redirectUri,
      verifier: payload.verifier,
    });
    accessToken = token.accessToken;
    refreshPlain = token.refreshToken ?? "";
    const granted = parseGrantedScopes(token.scope);
    if (!granted.forceSsl || !refreshPlain) {
      await revokeGoogleToken(refreshPlain || accessToken);
      return redirectError(granted.forceSsl ? "exchange" : "scope");
    }

    const show = await requireShowProfile(user.id);
    if (!show.ok) {
      await revokeGoogleToken(refreshPlain);
      return redirectError("user");
    }

    const channel = await listOwnedChannel(accessToken);
    if (!channel.ok) {
      await revokeGoogleToken(refreshPlain);
      return redirectError(channel.reason === "channel" ? "channel" : "exchange");
    }

    const live = await listLiveCiphertexts(user.id);
    for (const row of live) {
      if (row.channel_id === channel.channel.channelId) continue;
      let oldToken = "";
      try {
        if (row.refresh_token_enc) oldToken = decryptString(row.refresh_token_enc, config.encryptionKey);
        else if (row.access_token_enc) oldToken = decryptString(row.access_token_enc, config.encryptionKey);
      } catch {
        oldToken = "";
      }
      if (oldToken) await revokeGoogleToken(oldToken);
      await retireConnection(row.id);
    }

    const saved = await upsertConnection({
      userId: user.id,
      showProfileId: show.showProfileId,
      channelId: channel.channel.channelId,
      channelTitle: channel.channel.title,
      scopes: granted.scopes,
      refreshTokenEnc: encryptString(refreshPlain, config.encryptionKey),
      accessTokenEnc: encryptString(accessToken, config.encryptionKey),
      accessTokenExpiresAt: new Date(Date.now() + (token.expiresIn ?? 3600) * 1000).toISOString(),
      now: new Date().toISOString(),
    });
    if (!saved.ok) {
      await revokeGoogleToken(refreshPlain);
      return redirectError(saved.reason === "channel_taken" ? "channel_taken" : "exchange");
    }

    await logEvent({
      eventType: "youtube.channel_connected" as LogEventInput["eventType"],
      entityType: "profile",
      entityId: user.id,
      actorId: user.id,
      payload: {
        channel_id: channel.channel.channelId,
        show_profile_id: show.showProfileId,
        analytics_enabled: granted.analytics,
      },
    });

    const connected = youtubeSettingsUrl({ connected: true });
    const response = NextResponse.redirect(connected ?? "https://www.taylslate.com/settings/youtube?connected=1");
    clearYoutubeOauthCookie(response);
    return response;
  } catch {
    if (refreshPlain || accessToken) await revokeGoogleToken(refreshPlain || accessToken);
    return redirectError("exchange");
  }
}
