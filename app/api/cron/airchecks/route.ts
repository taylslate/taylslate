// GET /api/cron/airchecks
// Daily. For each booked IO spot whose air window is open, pull that
// episode, transcribe it, and store a match ready for review.
// A missing OPENAI_API_KEY skips the run. The run stops at
// AIRCHECK_RUN_COST_CAP_USD. It does not mark a line delivered and
// does not charge.
//
// Auth: Vercel Cron sends `Authorization: Bearer <CRON_SECRET>`.
// A missing secret, or a request without that bearer token, is 401.

import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { runAutomatedAirchecks } from "@/lib/airchecks/run";
import { redactSecretParams } from "@/lib/discovery/redact-secrets";
import { runYoutubeCaptionAirchecks } from "@/lib/youtube-oauth/feed";
import type { YoutubeCaptionReport } from "@/lib/youtube-oauth/feed";

export const maxDuration = 300;

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  const left = Buffer.from(header);
  const right = Buffer.from(expected);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

function safeError(err: unknown): string {
  const message = err instanceof Error ? err.message : "airchecks failed";
  return redactSecretParams(message).slice(0, 300);
}

export async function GET(request: NextRequest) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let youtube: YoutubeCaptionReport | { error: "unavailable" } = { error: "unavailable" };
  try {
    youtube = await runYoutubeCaptionAirchecks();
  } catch (err) {
    console.error("[aircheck] youtube failed", safeError(err));
  }

  try {
    const result = await runAutomatedAirchecks();
    return NextResponse.json({ ...result, youtube });
  } catch (err) {
    console.error("[aircheck] run failed", safeError(err));
    return NextResponse.json({ error: "airchecks failed" }, { status: 500 });
  }
}
