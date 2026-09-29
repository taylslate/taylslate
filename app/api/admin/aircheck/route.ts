// POST /api/admin/aircheck
//
// Aircheck steps 1 and 2. Transcribes the IO line when it does not already
// have a transcript, then stores a match judgment on the same airchecks row.
// A second call updates that row. It does not mark the line delivered and
// does not call chargeForEpisode.
//
// Auth: INTERNAL_ADMIN_EMAILS, same gate as mark-delivered.
// ok is true when a judgment was stored (matched or not_matched). A skipped
// row or a recorded transcription failure is 200 with ok: false. A missing
// line is 404. A failure to write the row is 500.

import { NextRequest, NextResponse } from "next/server";
import { aircheckIoLine, AircheckLineNotFound } from "@/lib/airchecks";
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
    const aircheck = await aircheckIoLine(body.ioLineItemId);
    const judged =
      aircheck.match_result === "matched" ||
      aircheck.match_result === "not_matched";
    return NextResponse.json({
      ok: judged,
      provider: aircheck.provider,
      match: aircheck.match_result,
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
