import { NextRequest, NextResponse } from "next/server";
import { getDealById } from "@/lib/data/deal-store";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const deal = getDealById(id);

  if (!deal) {
    return NextResponse.json({ error: "Deal not found" }, { status: 404 });
  }

  return NextResponse.json({ deal });
}
