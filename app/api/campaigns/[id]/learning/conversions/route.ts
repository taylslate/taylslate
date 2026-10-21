// POST /api/campaigns/[id]/learning/conversions
// Brand-reported conversion count for one deal. Null clears the report
// back to "not enough data". The route never fills in a number.

import { NextRequest, NextResponse } from "next/server";
import { decideConversionWrite } from "@/lib/learning/access";
import { resolveLearningPageForRequest } from "@/lib/learning/load";
import { clearConversionReport, saveConversionReport } from "@/lib/learning/store";

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

  const dealId = typeof body.dealId === "string" ? body.dealId : "";
  const decision = decideConversionWrite({
    userId: resolved.userId,
    campaignUserId: resolved.access.campaign.user_id,
    isAdmin: resolved.access.isAdmin,
    dealId,
    dealStatus: resolved.access.bundle.dealStatus[dealId] ?? null,
    onCampaign: dealId in resolved.access.bundle.dealStatus,
    conversions: body.conversions,
  });
  if (!decision.ok) {
    return NextResponse.json({ error: decision.error }, { status: decision.status });
  }

  try {
    if (decision.clear) {
      await clearConversionReport({
        campaignId: id,
        dealId: decision.dealId,
        actorId: resolved.userId,
      });
    } else {
      await saveConversionReport({
        campaignId: id,
        dealId: decision.dealId,
        conversions: decision.conversions,
        reportedBy: resolved.userId,
      });
    }
  } catch (err) {
    console.error("[learning/conversions]", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Couldn't save that count." }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    dealId: decision.dealId,
    conversions: decision.clear ? null : decision.conversions,
  });
}
