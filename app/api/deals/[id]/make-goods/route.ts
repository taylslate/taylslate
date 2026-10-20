// List make-goods on a deal, or detect them from the deal's airchecks.
// The deal id is the caller's deal before any write.

import { NextRequest, NextResponse } from "next/server";
import { gateMakeGood } from "@/lib/make-goods/gate";
import { listMakeGoods, proposeMakeGoodsForDeal } from "@/lib/make-goods/propose";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const gate = await gateMakeGood(id, "read");
  if (!gate.ok) return gate.response;

  try {
    const makeGoods = await listMakeGoods(gate.deal.id);
    return NextResponse.json({
      can_approve: gate.canApprove,
      make_goods: makeGoods,
    });
  } catch (err) {
    console.error("[GET make-goods]", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Could not load make-goods." }, { status: 500 });
  }
}

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const gate = await gateMakeGood(id, "read");
  if (!gate.ok) return gate.response;

  try {
    const makeGoods = await proposeMakeGoodsForDeal(gate.deal.id);
    return NextResponse.json({
      can_approve: gate.canApprove,
      make_goods: makeGoods,
    });
  } catch (err) {
    console.error("[POST make-goods]", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Could not check delivery." }, { status: 500 });
  }
}
