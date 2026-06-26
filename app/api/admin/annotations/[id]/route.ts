// DELETE /api/admin/annotations/[id]
//
// Founder-only: remove a founder annotation (Wave 14 Phase 2D Layer 1) — the
// "I made a typo / wrong call" path. Annotations are a shared founder asset, so
// the only gate is the INTERNAL_ADMIN_EMAILS allowlist; there is no per-row
// author ownership check.

import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/data/queries";
import { isInternalAdmin } from "@/lib/auth/admin";
import { deleteFounderAnnotation } from "@/lib/data/reasoning-log";

export const runtime = "nodejs";

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isInternalAdmin(user.email)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const ok = await deleteFounderAnnotation(id);
  if (!ok) {
    return NextResponse.json(
      { error: "Failed to delete annotation" },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true });
}
