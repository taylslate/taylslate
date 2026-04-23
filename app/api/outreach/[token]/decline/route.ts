import { NextRequest, NextResponse } from "next/server";
import { applyAndNotify, resolveOutreachOr400 } from "../_shared";

interface DeclineBody {
  decline_reason?: string;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;

  let body: DeclineBody = {};
  try {
    body = (await request.json()) as DeclineBody;
  } catch {
    // Empty body is fine for decline.
  }
  if (body.decline_reason && body.decline_reason.length > 1000) {
    return NextResponse.json({ error: "decline_reason too long" }, { status: 400 });
  }

  const resolved = await resolveOutreachOr400(token, request);
  if (!resolved.ok) return resolved.response;

  const result = await applyAndNotify({
    resolved: resolved.data,
    request,
    status: "declined",
    decline_reason: body.decline_reason?.trim() || null,
  });
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json({ outreach: result.outreach });
}
