// Public description of the read API. No key required.

import { NextResponse } from "next/server";
import { openApiDocument } from "@/lib/api/v1/openapi";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET() {
  return NextResponse.json(openApiDocument(), {
    headers: { "Cache-Control": "no-store" },
  });
}
