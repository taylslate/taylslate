// Wave 14 Phase 2A Layer 5 — interpretation confirm endpoint.
//
// POST { rings: [{ id, decision }] } → the brand has confirmed the
// interpretation. Write each ring's final brand_decision: 'confirmed' for an
// included ring, 'rejected' for a skipped one, 'added_by_brand' preserved for
// brand-added rings. Refined rows are left as-is (the page never sends them).
// The client redirects to the discovery view after a 200.
//
// Scope (Phase 2A): this writes confirmed ring hypotheses and stops there.
// Running discovery from the confirmed rings is 2B.

import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser, getCampaignById } from "@/lib/data/queries";
import { logEvent } from "@/lib/data/events";
import {
  getCampaignReasoning,
  getLatestCampaignPatternForCampaign,
  updateRingDecision,
} from "@/lib/data/reasoning-log";
import type { BrandDecision } from "@/lib/data/types";

// The brand can only resolve a visible ring to one of these. 'refined' and
// 'pending' are never written by confirm.
const ALLOWED: BrandDecision[] = ["confirmed", "rejected", "added_by_brand"];

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(request: NextRequest, context: RouteContext) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await context.params;
  const campaign = await getCampaignById(id);
  if (!campaign || campaign.user_id !== user.id) {
    return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
  }

  let body: { rings?: Array<{ id?: string; decision?: string }> };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!Array.isArray(body.rings) || body.rings.length === 0) {
    return NextResponse.json(
      { error: "rings is required" },
      { status: 400 }
    );
  }

  const pattern = await getLatestCampaignPatternForCampaign(id);
  if (!pattern) {
    return NextResponse.json(
      { error: "No interpretation to confirm", code: "no_interpretation" },
      { status: 400 }
    );
  }

  // Only rings that belong to this campaign's pattern may be written.
  const reasoning = await getCampaignReasoning(pattern.id);
  const validIds = new Set(
    reasoning.rings
      .map((r) => (typeof r.id === "string" ? r.id : null))
      .filter((v): v is string => v !== null)
  );

  let confirmed = 0;
  let rejected = 0;
  for (const entry of body.rings) {
    const ringId = entry.id;
    const decision = entry.decision as BrandDecision;
    if (
      !ringId ||
      !validIds.has(ringId) ||
      !ALLOWED.includes(decision)
    ) {
      // Unknown id or decision — skip defensively rather than 400 the whole
      // confirm over one bad entry.
      continue;
    }
    const ok = await updateRingDecision(ringId, decision);
    if (ok) {
      if (decision === "rejected") rejected++;
      else confirmed++;
    }
  }

  await logEvent({
    eventType: "brief.interpretation_confirmed",
    entityType: "campaign",
    entityId: id,
    actorId: user.id,
    payload: {
      campaign_pattern_id: pattern.id,
      confirmed_ring_count: confirmed,
      rejected_ring_count: rejected,
    },
  });

  return NextResponse.json({ ok: true, confirmed_ring_count: confirmed });
}
