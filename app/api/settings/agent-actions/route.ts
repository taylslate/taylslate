// The signed-in brand's pending API actions. Another brand's rows
// are not in this list. The response never includes payload_hash,
// key_hash, or idempotency_key.

import { NextRequest, NextResponse } from "next/server";
import { listBrandActions, requireBrand } from "@/lib/api/approvals/list";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const actor = await requireBrand();
  if (!actor.ok) {
    return NextResponse.json({ error: actor.error }, { status: actor.httpStatus });
  }
  const listed = await listBrandActions(actor.userId, request);
  if (!listed.ok) {
    return NextResponse.json({ error: listed.error }, { status: listed.httpStatus });
  }
  return NextResponse.json(
    { data: listed.data, next_cursor: listed.nextCursor },
    { headers: { "Cache-Control": "no-store" } }
  );
}
