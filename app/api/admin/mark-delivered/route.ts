// POST /api/admin/mark-delivered
//
// Internal-admin stub for "Podscribe says this episode delivered".
// The delivery write and the charge live in lib/delivery/mark-delivered.ts.
// Aircheck review confirm calls that same function. This route stays the
// direct ops harness.
//
// If the charge FAILS, the delivery write is rolled back to the
// pre-request snapshot and the response is `ok: false` (502). A failed
// charge must not leave a delivered-but-unbilled line item; retrying the
// call re-verifies and converges (chargeForEpisode is idempotent on the
// (deal, line item) pair).
//
// Auth: INTERNAL_ADMIN_EMAILS (comma-separated allowlist) only. There is
// NO public-facing path to this; brands trigger charges through
// /api/deals/[id]/charge-episode. This endpoint is the temporary harness
// for ops + the future Podscribe webhook target.
//
// TODO(post-Wave-13): replace with the real Podscribe verification
// webhook handler. Same DB writes, same chargeForEpisode call — but the
// auth boundary becomes Podscribe's HMAC signature instead of an email
// allowlist.

import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/data/queries";
import { isInternalAdmin } from "@/lib/auth/admin";
import { deliverAndChargeLine } from "@/lib/delivery/mark-delivered";

export const runtime = "nodejs";

interface MarkDeliveredBody {
  ioLineItemId?: string;
  actualPostDate?: string;
  actualDownloads?: number;
}

export async function POST(request: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isInternalAdmin(user.email)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: MarkDeliveredBody;
  try {
    body = (await request.json()) as MarkDeliveredBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body.ioLineItemId || typeof body.ioLineItemId !== "string") {
    return NextResponse.json(
      { error: "ioLineItemId is required" },
      { status: 400 }
    );
  }

  const result = await deliverAndChargeLine({
    ioLineItemId: body.ioLineItemId,
    actualPostDate: body.actualPostDate,
    actualDownloads: body.actualDownloads,
  });
  if (result.ok) {
    return NextResponse.json({ ok: true, charge: result.charge });
  }
  if (result.status === 502) {
    return NextResponse.json(
      {
        ok: false,
        charge: null,
        chargeError: result.chargeError,
        rolledBack: result.rolledBack,
        ...(result.rollbackError ? { rollbackError: result.rollbackError } : {}),
      },
      { status: 502 }
    );
  }
  return NextResponse.json({ error: result.error }, { status: result.status });
}
