// Brand approves one make-good option on their own deal.
// The make-good id is loaded with the deal id before any write.
// Does not send DocuSign and does not charge.

import { NextRequest, NextResponse } from "next/server";
import { approveMakeGood } from "@/lib/make-goods/decide";
import { gateMakeGood } from "@/lib/make-goods/gate";
import { isMakeGoodOptionId } from "@/lib/make-goods/types";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; makeGoodId: string }> }
) {
  const { id, makeGoodId } = await params;
  const gate = await gateMakeGood(id, "decide");
  if (!gate.ok) return gate.response;

  let body: unknown = null;
  try {
    body = await request.json();
  } catch {
    body = null;
  }
  const option =
    body && typeof body === "object" && "option" in body
      ? (body as { option: unknown }).option
      : null;
  if (!isMakeGoodOptionId(option)) {
    return NextResponse.json({ error: "Choose a make-good option." }, { status: 400 });
  }

  try {
    const result = await approveMakeGood({
      dealId: gate.deal.id,
      makeGoodId,
      optionId: option,
      actorId: gate.user.id,
    });
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    return NextResponse.json({
      make_good: result.makeGood,
      deal_status: result.dealStatus,
    });
  } catch (err) {
    console.error("[POST make-good approve]", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Could not approve the make-good." }, { status: 500 });
  }
}
