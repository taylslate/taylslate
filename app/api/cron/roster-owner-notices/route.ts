// GET /api/cron/roster-owner-notices
// Vercel Cron, daily. Sends the rep heads-up when a verified owner
// appears after a pending or approved roster link, and retries an
// import send that failed inside the last 7 days.
//
// Auth: Vercel Cron sends `Authorization: Bearer <CRON_SECRET>`.
// A missing secret, or a request without that bearer token, is 401.
// A missing notices table sends nothing until migration 081 is applied.

import { NextRequest, NextResponse } from "next/server";
import { sweepOwnerVerificationNotices } from "@/lib/reps/roster-notify";

export const runtime = "nodejs";

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

export async function GET(request: NextRequest) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const counts = await sweepOwnerVerificationNotices();
  return NextResponse.json(counts);
}
