// GET /api/cron/payout-releases
// Vercel Cron, daily. Releases held payouts whose owners are now verified.
// A still-unverified owner stays held. The response is counts only.
//
// Auth: Vercel Cron sends Authorization: Bearer <CRON_SECRET>.
// A missing secret, or a request without that bearer token, is 401.

import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { sweepHeldPayouts } from "@/lib/payouts/release";

export const runtime = "nodejs";

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

function json(body: unknown, status = 200): NextResponse {
  const response = NextResponse.json(body, { status });
  response.headers.set("Cache-Control", "no-store");
  return response;
}

export async function GET(request: NextRequest) {
  if (!authorized(request)) {
    return json({ error: "Unauthorized" }, 401);
  }
  const counts = await sweepHeldPayouts();
  return json({
    released: counts.released,
    held: counts.held,
    failed: counts.failed,
  });
}
