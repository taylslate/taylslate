// GET /api/cron/youtube-library-refresh
// Vercel Cron, daily. Refreshes the oldest channel stats within
// 1,000 units, enforces the 30-day store rule, then batch-tags
// up to 400 channels.
//
// Auth: Vercel Cron sends `Authorization: Bearer <CRON_SECRET>`.
// A missing secret, or a request without that bearer token, is 401.
// A missing youtube_channels table is a no-op until migration 074
// is applied. The API key is never logged.

import { NextRequest, NextResponse } from "next/server";
import { redactSecretParams } from "@/lib/discovery/redact-secrets";
import { runYoutubeLibraryRefresh } from "@/lib/youtube-library/refresh";

// Hobby plan with Fluid Compute stops the function at 300 seconds. Do not raise it.
export const maxDuration = 300;

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

function safeError(err: unknown): string {
  const message = err instanceof Error ? err.message : "refresh failed";
  return redactSecretParams(message).slice(0, 300);
}

export async function GET(request: NextRequest) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await runYoutubeLibraryRefresh();
    return NextResponse.json(result);
  } catch (err) {
    console.error("[youtube-library] refresh failed", safeError(err));
    return NextResponse.json({ error: "refresh failed" }, { status: 500 });
  }
}
