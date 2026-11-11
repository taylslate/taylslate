// GET /api/youtube/status
// The caller's connection only. Never returns a token field.

import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/data/queries";
import { youtubeOauthConfigured } from "@/lib/youtube-oauth/config";
import { enforceYoutubeStatus } from "@/lib/youtube-oauth/limits";
import { readYoutubeStatus, requireShowProfile, type YoutubeStatus } from "@/lib/youtube-oauth/store";

export const runtime = "nodejs";

const EMPTY: YoutubeStatus = {
  connected: false,
  channel_id: null,
  channel_title: null,
  status: null,
  analytics_enabled: false,
};

export async function GET(request: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const show = await requireShowProfile(user.id);
  if (!show.ok) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  if (!youtubeOauthConfigured()) {
    return NextResponse.json({ error: "unavailable" }, { status: 503 });
  }

  const limited = await enforceYoutubeStatus(user.id, request);
  if (limited) return limited;

  try {
    const status = await readYoutubeStatus(user.id);
    const body: YoutubeStatus = {
      connected: status.connected,
      channel_id: status.channel_id,
      channel_title: status.channel_title,
      status: status.status,
      analytics_enabled: status.analytics_enabled,
    };
    return NextResponse.json(body);
  } catch {
    return NextResponse.json(EMPTY);
  }
}
