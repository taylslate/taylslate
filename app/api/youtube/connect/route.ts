// GET /api/youtube/connect
// Signed-in show users start Google OAuth. The redirect URI is the
// site URL, never the request host. Tokens are not in this response.

import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/data/queries";
import {
  readYoutubeOauthConfig,
  setYoutubeOauthCookie,
  youtubeOauthConfigured,
} from "@/lib/youtube-oauth/config";
import { sealJson, sha256Hex } from "@/lib/youtube-oauth/crypto";
import { buildAuthorizeUrl, randomOauthSecret } from "@/lib/youtube-oauth/google";
import { enforceYoutubeConnect } from "@/lib/youtube-oauth/limits";
import { requireShowProfile, youtubeOauthTablesReady } from "@/lib/youtube-oauth/store";

export const runtime = "nodejs";

function unavailable(): NextResponse {
  return NextResponse.json({ error: "unavailable" }, { status: 503 });
}

export async function GET(request: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const show = await requireShowProfile(user.id);
  if (!show.ok) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  if (!youtubeOauthConfigured()) return unavailable();
  const limited = await enforceYoutubeConnect(user.id, request);
  if (limited) return limited;

  const config = readYoutubeOauthConfig();
  if (!config) return unavailable();

  try {
    if (!(await youtubeOauthTablesReady())) return unavailable();
  } catch {
    return unavailable();
  }

  const state = randomOauthSecret();
  const verifier = randomOauthSecret();
  const sealed = sealJson(
    {
      state_hash: sha256Hex(state),
      verifier,
      user_id: user.id,
      issued_at: Date.now(),
    },
    config.encryptionKey
  );
  const response = NextResponse.redirect(
    buildAuthorizeUrl({
      clientId: config.clientId,
      redirectUri: config.redirectUri,
      state,
      verifier,
    })
  );
  setYoutubeOauthCookie(response, sealed);
  return response;
}
