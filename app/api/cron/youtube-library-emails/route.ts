// GET /api/cron/youtube-library-emails
// Vercel Cron, daily, after the library refresh. Scans stored channel
// descriptions for contact emails, then recent video descriptions until
// the Pacific-day quota cap. Pending channels resume the next day.
//
// Auth: Vercel Cron sends `Authorization: Bearer <CRON_SECRET>`.
// A missing secret, or a request without that bearer token, is 401.
// A missing youtube_channels table is a no-op until migration 074
// is applied. Migration 076 adds the email and quota tables. Until
// that file is applied this route no-ops with missing_yt2.
// The API key is never logged. Email addresses are not logged.

import { NextRequest, NextResponse } from "next/server";
import { redactSecretParams } from "@/lib/discovery/redact-secrets";
import { runYoutubeEmailBackfill } from "@/lib/youtube-library/emails-backfill";

// Hobby plan Fluid Compute stops the function at 300 seconds.
// Do not raise it.
export const maxDuration = 300;

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

function safeError(err: unknown): string {
  const message = err instanceof Error ? err.message : "emails failed";
  return redactSecretParams(message).slice(0, 300);
}

export async function GET(request: NextRequest) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await runYoutubeEmailBackfill();
    return NextResponse.json(result);
  } catch (err) {
    console.error("[youtube-library] emails failed", safeError(err));
    return NextResponse.json({ error: "emails failed" }, { status: 500 });
  }
}
