// POST /api/admin/aircheck/review
//
// Aircheck step 3. Confirm delivers the line and charges through the
// existing mark-delivered path. Reject stores the decision and does not
// charge. A failed charge is stored on the aircheck and is not success.
//
// Auth: INTERNAL_ADMIN_EMAILS, same gate as mark-delivered.

import { NextRequest, NextResponse } from "next/server";
import {
  AircheckConfirmInProgress,
  AircheckConfirmUnavailable,
  AircheckReviewConflict,
  AircheckReviewNotFound,
  confirmAircheck,
  rejectAircheck,
} from "@/lib/airchecks/review";
import { isInternalAdmin } from "@/lib/auth/admin";
import { getAuthenticatedUser } from "@/lib/data/queries";

export const runtime = "nodejs";

interface ReviewBody {
  ioLineItemId?: string;
  decision?: string;
  reason?: string;
}

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const HIDDEN_RESPONSE_KEYS = new Set([
  "transcript_text",
  "audio_url",
  "transcript_segments",
  "client_secret",
]);

function publicBody(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (HIDDEN_RESPONSE_KEYS.has(key)) continue;
    out[key] = item;
  }
  return out;
}

export async function POST(request: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isInternalAdmin(user.email)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: ReviewBody;
  try {
    body = (await request.json()) as ReviewBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body.ioLineItemId || typeof body.ioLineItemId !== "string") {
    return NextResponse.json(
      { error: "ioLineItemId is required" },
      { status: 400 }
    );
  }
  if (!UUID.test(body.ioLineItemId)) {
    return NextResponse.json(
      { error: "ioLineItemId must be a uuid" },
      { status: 400 }
    );
  }
  if (body.decision !== "confirm" && body.decision !== "reject") {
    return NextResponse.json(
      { error: "decision must be confirm or reject" },
      { status: 400 }
    );
  }
  if (body.reason != null && typeof body.reason !== "string") {
    return NextResponse.json({ error: "reason must be a string" }, { status: 400 });
  }

  // Session only. A decidedBy or actorId in the body is ignored.
  const decidedBy = user.email ?? user.id;
  try {
    if (body.decision === "reject") {
      const aircheck = await rejectAircheck({
        ioLineItemId: body.ioLineItemId,
        decidedBy,
        actorId: user.id,
        reason: body.reason,
      });
      return NextResponse.json({ ok: true, aircheck: publicBody(aircheck) });
    }
    const result = await confirmAircheck({
      ioLineItemId: body.ioLineItemId,
      decidedBy,
      actorId: user.id,
    });
    if (!result.ok) {
      return NextResponse.json(
        {
          ok: false,
          chargeError: result.chargeError,
          aircheck: publicBody(result.aircheck),
        },
        { status: 502 }
      );
    }
    return NextResponse.json({
      ok: true,
      alreadyCharged: result.alreadyCharged,
      charge: publicBody(result.charge),
      aircheck: publicBody(result.aircheck),
    });
  } catch (err) {
    if (err instanceof AircheckReviewNotFound) {
      return NextResponse.json({ error: err.message }, { status: 404 });
    }
    if (err instanceof AircheckConfirmUnavailable) {
      return NextResponse.json({ error: err.message }, { status: 503 });
    }
    if (
      err instanceof AircheckReviewConflict ||
      err instanceof AircheckConfirmInProgress
    ) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    const message = err instanceof Error ? err.message : "Review failed";
    console.error(`[admin/aircheck/review] line ${body.ioLineItemId}:`, message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
