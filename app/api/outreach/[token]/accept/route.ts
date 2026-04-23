import { NextRequest, NextResponse } from "next/server";
import { applyAndNotify, resolveOutreachOr400 } from "../_shared";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const resolved = await resolveOutreachOr400(token, request);
  if (!resolved.ok) return resolved.response;

  const result = await applyAndNotify({
    resolved: resolved.data,
    request,
    status: "accepted",
  });
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json({ outreach: result.outreach });
}
