// GET /api/cron/youtube-library-pull
// Vercel Cron, daily. Seeds the category and CSV queue, then spends
// the 8,000 unit pull budget. Pending rows resume the next day.
//
// Auth: Vercel Cron sends `Authorization: Bearer <CRON_SECRET>`.
// A missing secret, or a request without that bearer token, is 401.
// A missing youtube_channels table is a no-op until migration 074
// is applied. The API key is never logged.

import { NextRequest, NextResponse } from "next/server";
import { redactSecretParams } from "@/lib/discovery/redact-secrets";
import { runYoutubeLibraryPull } from "@/lib/youtube-library/pull";

// Hobby plan Fluid Compute stops the function at 300 seconds. A production
// pull on Oct 29 2026 was killed at that limit. Do not raise this.
export const maxDuration = 300;

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

function safeError(err: unknown): string {
  const message = err instanceof Error ? err.message : "pull failed";
  return redactSecretParams(message).slice(0, 300);
}

export async function GET(request: NextRequest) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await runYoutubeLibraryPull();
    return NextResponse.json(result);
  } catch (err) {
    console.error("[youtube-library] pull failed", safeError(err));
    return NextResponse.json({ error: "pull failed" }, { status: 500 });
  }
}
