// POST /api/campaigns/[id]/learning/overrides
// Brand or rep note on a show, ring, or read style. The note is stored.
// It does not change who is listed.

import { NextRequest, NextResponse } from "next/server";
import { decideOverrideWrite } from "@/lib/learning/access";
import { resolveLearningPageForRequest } from "@/lib/learning/load";
import { saveLearningOverride } from "@/lib/learning/store";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(request: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  const resolved = await resolveLearningPageForRequest(id);
  if (resolved.status === "unauthenticated") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (resolved.status === "not_found") {
    return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const decision = decideOverrideWrite({
    userId: resolved.userId,
    campaignUserId: resolved.access.campaign.user_id,
    isAdmin: resolved.access.isAdmin,
    role: resolved.access.role,
    representedShowIds: resolved.access.representedShowIds,
    allowedShowIds: resolved.access.bundle.allowedShowIds,
    allowedRingIds: resolved.access.bundle.allowedRingIds,
    targetKind: typeof body.targetKind === "string" ? body.targetKind : "",
    targetKey: typeof body.targetKey === "string" ? body.targetKey : "",
    stance: typeof body.stance === "string" ? body.stance : "",
    note: typeof body.note === "string" ? body.note : "",
  });
  if (!decision.ok) {
    return NextResponse.json({ error: decision.error }, { status: decision.status });
  }

  try {
    await saveLearningOverride({
      campaignId: id,
      authorId: resolved.userId,
      authorRole: decision.authorRole,
      targetKind: decision.targetKind,
      targetKey: decision.targetKey,
      stance: decision.stance,
      note: decision.note,
    });
  } catch (err) {
    console.error("[learning/overrides]", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Couldn't save that note." }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    authorRole: decision.authorRole,
    targetKind: decision.targetKind,
    targetKey: decision.targetKey,
    stance: decision.stance,
    note: decision.note,
  });
}
