// Wave 14 Phase 2A Layer 5 — interpretation confirm endpoint.
//
// POST { rings: [{ id, decision }] } → the brand has confirmed the
// interpretation. Write every ring's final brand_decision atomically
// (migration 025 persist_confirmation RPC): 'confirmed' for an included ring,
// 'rejected' for a skipped one, 'added_by_brand' preserved for brand-added
// rings. The RPC validates each entry INSIDE the transaction — the ring must
// belong to this pattern AND not be 'refined' — so a partial confirm can
// never commit, and a refined/unknown/invalid entry is rejected (400), not
// silently skipped. The client redirects to the discovery view after a 200.
//
// Scope (Phase 2A): this writes confirmed ring hypotheses and stops there.
// Running discovery from the confirmed rings is 2B.

import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser, getCampaignById } from "@/lib/data/queries";
import { logEvent } from "@/lib/data/events";
import {
  getLatestCampaignPatternForCampaign,
  persistConfirmationAtomic,
} from "@/lib/data/reasoning-log";

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

  // Atomic, validated write (migration 025). The function rejects any entry
  // that names a ring outside this pattern, names a refined ring, or carries a
  // decision the brand can't set — raising and rolling the whole confirm back.
  const result = await persistConfirmationAtomic(pattern.id, body.rings);
  if (!result.ok) {
    if (result.reason === "validation") {
      return NextResponse.json(
        { error: "One or more rings can't be confirmed", code: "invalid_rings" },
        { status: 400 }
      );
    }
    return NextResponse.json(
      { error: "Failed to confirm interpretation", code: "confirm_failed" },
      { status: 500 }
    );
  }

  await logEvent({
    eventType: "brief.interpretation_confirmed",
    entityType: "campaign",
    entityId: id,
    actorId: user.id,
    payload: {
      campaign_pattern_id: pattern.id,
      confirmed_ring_count: result.confirmed,
      rejected_ring_count: result.rejected,
    },
  });

  return NextResponse.json({ ok: true, confirmed_ring_count: result.confirmed });
}
