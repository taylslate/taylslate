// Brand declines a make-good on their own deal.
// The make-good id must belong to the deal in the URL. No email is sent.

import { NextRequest, NextResponse } from "next/server";
import { declineMakeGood } from "@/lib/make-goods/decide";
import { gateMakeGood } from "@/lib/make-goods/gate";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; makeGoodId: string }> }
) {
  const { id, makeGoodId } = await params;
  const gate = await gateMakeGood(id, "decide");
  if (!gate.ok) return gate.response;

  try {
    const result = await declineMakeGood({
      dealId: gate.deal.id,
      makeGoodId,
      actorId: gate.user.id,
    });
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    return NextResponse.json({ make_good: result.makeGood });
  } catch (err) {
    console.error("[POST make-good decline]", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Could not decline the make-good." }, { status: 500 });
  }
}
