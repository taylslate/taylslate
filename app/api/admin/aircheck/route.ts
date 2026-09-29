// POST /api/admin/aircheck
//
// Aircheck step 1. Resolves one IO line's episode and stores a transcript
// on airchecks. Does not mark the line delivered, does not call
// chargeForEpisode, and does not decide whether the read matched the IO.
//
// Auth: INTERNAL_ADMIN_EMAILS, same gate as mark-delivered.
// A recorded transcription failure is 200 with ok: false — the row holds
// the error. A missing line is 404. A failure to write the row is 500.

import { NextRequest, NextResponse } from "next/server";
import { AircheckLineNotFound, transcribeIoLine } from "@/lib/airchecks";
import { isInternalAdmin } from "@/lib/auth/admin";
import { getAuthenticatedUser } from "@/lib/data/queries";

export const runtime = "nodejs";

interface AircheckBody {
  ioLineItemId?: string;
}

export async function POST(request: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isInternalAdmin(user.email)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: AircheckBody;
  try {
    body = (await request.json()) as AircheckBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body.ioLineItemId || typeof body.ioLineItemId !== "string") {
    return NextResponse.json(
      { error: "ioLineItemId is required" },
      { status: 400 }
    );
  }

  try {
    const aircheck = await transcribeIoLine(body.ioLineItemId);
    return NextResponse.json({
      ok: aircheck.status === "transcribed",
      provider: aircheck.provider,
      aircheck,
    });
  } catch (err) {
    if (err instanceof AircheckLineNotFound) {
      return NextResponse.json({ error: err.message }, { status: 404 });
    }
    const message = err instanceof Error ? err.message : "Aircheck failed";
    console.error(`[admin/aircheck] line ${body.ioLineItemId}:`, message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
