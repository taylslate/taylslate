import { NextRequest, NextResponse } from "next/server";
import { applyAndNotify, resolveOutreachOr400 } from "../_shared";

interface CounterBody {
  counter_cpm: number;
  counter_message?: string;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;

  let body: CounterBody;
  try {
    body = (await request.json()) as CounterBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!Number.isFinite(body.counter_cpm) || body.counter_cpm <= 0) {
    return NextResponse.json({ error: "counter_cpm must be > 0" }, { status: 400 });
  }
  if (body.counter_message && body.counter_message.length > 1000) {
    return NextResponse.json({ error: "counter_message too long" }, { status: 400 });
  }

  const resolved = await resolveOutreachOr400(token, request);
  if (!resolved.ok) return resolved.response;

  const result = await applyAndNotify({
    resolved: resolved.data,
    request,
    status: "countered",
    counter_cpm: Math.round(body.counter_cpm * 100) / 100,
    counter_message: body.counter_message?.trim() || null,
  });
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json({ outreach: result.outreach });
}
