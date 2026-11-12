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
  "charge_error",
]);

const CHARGE_FAILED =
  "The charge failed, so this line is not confirmed. The details are saved on this line for the team.";

function noStoreJson(body: unknown, status = 200) {
  const response = NextResponse.json(body, { status });
  response.headers.set("Cache-Control", "no-store");
  return response;
}

function reviewFailureLabel(err: unknown): string {
  if (err && typeof err === "object" && "code" in err) {
    const code = (err as { code?: unknown }).code;
    if (typeof code === "string" && code.trim()) return code.trim();
  }
  if (err instanceof Error && err.name) return err.name;
  return "Error";
}

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
    return noStoreJson({ error: "Unauthorized" }, 401);
  }
  if (!isInternalAdmin(user.email)) {
    return noStoreJson({ error: "Forbidden" }, 403);
  }

  let body: ReviewBody;
  try {
    body = (await request.json()) as ReviewBody;
  } catch {
    return noStoreJson({ error: "Invalid JSON" }, 400);
  }
  if (!body.ioLineItemId || typeof body.ioLineItemId !== "string") {
    return noStoreJson({ error: "ioLineItemId is required" }, 400);
  }
  if (!UUID.test(body.ioLineItemId)) {
    return noStoreJson({ error: "ioLineItemId must be a uuid" }, 400);
  }
  if (body.decision !== "confirm" && body.decision !== "reject") {
    return noStoreJson({ error: "decision must be confirm or reject" }, 400);
  }
  if (body.reason != null && typeof body.reason !== "string") {
    return noStoreJson({ error: "reason must be a string" }, 400);
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
      return noStoreJson({ ok: true, aircheck: publicBody(aircheck) });
    }
    const result = await confirmAircheck({
      ioLineItemId: body.ioLineItemId,
      decidedBy,
      actorId: user.id,
    });
    if (!result.ok) {
      return noStoreJson(
        {
          ok: false,
          chargeError: CHARGE_FAILED,
          aircheck: publicBody(result.aircheck),
        },
        502
      );
    }
    return noStoreJson({
      ok: true,
      alreadyCharged: result.alreadyCharged,
      charge: publicBody(result.charge),
      aircheck: publicBody(result.aircheck),
    });
  } catch (err) {
    if (err instanceof AircheckReviewNotFound) {
      return noStoreJson({ error: err.message }, 404);
    }
    if (err instanceof AircheckConfirmUnavailable) {
      return noStoreJson({ error: err.message }, 503);
    }
    if (
      err instanceof AircheckReviewConflict ||
      err instanceof AircheckConfirmInProgress
    ) {
      return noStoreJson({ error: err.message }, 409);
    }
    console.error("[admin/aircheck/review]", reviewFailureLabel(err));
    return noStoreJson({ error: "Review failed." }, 500);
  }
}
