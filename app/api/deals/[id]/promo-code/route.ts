// PATCH /api/deals/[id]/promo-code
// Brand-only. Persists the per-deal promo code captured at IO time
// (Wave 14 Phase 2D — Layer A). Editable only while the deal is in `planning`
// (i.e. before signature). An empty/blank body clears the code (stores null).
//
// Every write emits a `deal.promo_code_set` domain event so the code becomes
// future conversion signal — the same fail-soft logEvent path that
// send-to-docusign (`io.generated`) and cancel (`deal.cancelled`) use.

import { NextRequest, NextResponse } from "next/server";
import {
  getAuthenticatedUser,
  getBrandProfileByUserId,
  getWave12DealById,
  updateWave12Deal,
} from "@/lib/data/queries";
import { normalizePromoCode } from "@/lib/io/promo-code";
import { logEvent } from "@/lib/data/events";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const deal = await getWave12DealById(id);
  if (!deal) return NextResponse.json({ error: "Deal not found" }, { status: 404 });

  const brandProfile = await getBrandProfileByUserId(user.id);
  if (!brandProfile || brandProfile.id !== deal.brand_profile_id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (deal.status !== "planning") {
    return NextResponse.json(
      { error: `Cannot edit promo code in status ${deal.status}` },
      { status: 409 }
    );
  }

  let body: { promo_code?: unknown };
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  const raw = typeof body.promo_code === "string" ? body.promo_code : null;
  // Shared slug rules — identical to the show-name prefill. Blank/empty → null.
  const promoCode = normalizePromoCode(raw);

  const updated = await updateWave12Deal(deal.id, { promo_code: promoCode });
  if (!updated) {
    return NextResponse.json({ error: "Couldn't save promo code" }, { status: 500 });
  }

  await logEvent({
    eventType: "deal.promo_code_set",
    entityType: "deal",
    entityId: deal.id,
    actorId: user.id,
    payload: { promo_code: promoCode, source: "brand_io" },
  });

  return NextResponse.json({ promo_code: promoCode });
}
