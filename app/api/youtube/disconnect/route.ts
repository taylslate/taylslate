// POST /api/youtube/disconnect
// Revokes at Google, then nulls tokens and clears caption text in one
// database transaction. Cross-origin requests are refused.

import { NextRequest, NextResponse } from "next/server";
import { logEvent } from "@/lib/data/events";
import { getAuthenticatedUser } from "@/lib/data/queries";
import { readYoutubeOauthConfig, youtubeOauthConfigured } from "@/lib/youtube-oauth/config";
import { decryptString } from "@/lib/youtube-oauth/crypto";
import { revokeGoogleToken } from "@/lib/youtube-oauth/google";
import { enforceYoutubeDisconnect } from "@/lib/youtube-oauth/limits";
import {
  disconnectYoutubeUser,
  listLiveCiphertexts,
  requireShowProfile,
} from "@/lib/youtube-oauth/store";

export const runtime = "nodejs";

function unavailable(): NextResponse {
  return NextResponse.json({ error: "unavailable" }, { status: 503 });
}

function sameOrigin(request: NextRequest, siteBase: string): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).origin === new URL(siteBase).origin;
  } catch {
    return false;
  }
}

export async function POST(request: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const show = await requireShowProfile(user.id);
  if (!show.ok) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  if (!youtubeOauthConfigured()) return unavailable();
  const config = readYoutubeOauthConfig();
  if (!config) return unavailable();

  const limited = await enforceYoutubeDisconnect(user.id, request);
  if (limited) return limited;

  if (!sameOrigin(request, config.siteBase)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const failures: Array<{ connection_id: string; attempts: number }> = [];
  try {
    const live = await listLiveCiphertexts(user.id);
    for (const cipher of live) {
      let token = "";
      try {
        if (cipher.refresh_token_enc) token = decryptString(cipher.refresh_token_enc, config.encryptionKey);
        else if (cipher.access_token_enc) token = decryptString(cipher.access_token_enc, config.encryptionKey);
      } catch {
        token = "";
      }
      if (!token) continue;
      const attempts = { count: 0 };
      const revoked = await revokeGoogleToken(token, { attempts });
      if (revoked === false) {
        failures.push({ connection_id: cipher.id, attempts: attempts.count });
      }
    }
    await disconnectYoutubeUser(user.id);
  } catch {
    return unavailable();
  }

  for (const failure of failures) {
    await logEvent({
      eventType: "youtube.google_revoke_failed",
      entityType: "profile",
      entityId: user.id,
      actorId: user.id,
      payload: {
        connection_id: failure.connection_id,
        attempts: failure.attempts,
      },
    });
  }

  if (failures.length > 0) {
    return NextResponse.json({ ok: true, google_revoke: "failed" });
  }
  return NextResponse.json({ ok: true });
}
