// POST /api/deals/[id]/charge-episode
//
// Fires a per-episode charge against the brand's saved card. Auth: the
// brand user owning the deal, OR an internal admin email on the
// INTERNAL_ADMIN_EMAILS allowlist (cron / ops).
//
// Body: `{ ioLineItemId: string }`. Idempotency is handled by the lib
// helper via Stripe idempotency key + the unique index on
// payments.stripe_payment_intent_id, so safe to retry.

import { NextRequest, NextResponse } from "next/server";
import {
  getAuthenticatedUser,
  getBrandProfileByUserId,
  getWave12DealById,
} from "@/lib/data/queries";
import { chargeForEpisode } from "@/lib/stripe/payment-intent";

export const runtime = "nodejs";

interface ChargeEpisodeBody {
  ioLineItemId?: string;
}

function isInternalAdmin(email: string | null | undefined): boolean {
  if (!email) return false;
  const list = (process.env.INTERNAL_ADMIN_EMAILS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return list.includes(email.toLowerCase());
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: dealId } = await params;

  let body: ChargeEpisodeBody;
  try {
    body = (await request.json()) as ChargeEpisodeBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body.ioLineItemId || typeof body.ioLineItemId !== "string") {
    return NextResponse.json(
      { error: "ioLineItemId is required" },
      { status: 400 }
    );
  }

  const deal = await getWave12DealById(dealId);
  if (!deal) {
    return NextResponse.json({ error: "Deal not found" }, { status: 404 });
  }

  // Authorise: brand owning the deal, OR internal admin.
  const admin = isInternalAdmin(user.email);
  if (!admin) {
    const brandProfile = await getBrandProfileByUserId(user.id);
    if (!brandProfile || brandProfile.id !== deal.brand_profile_id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  try {
    const result = await chargeForEpisode({
      dealId,
      ioLineItemId: body.ioLineItemId,
    });
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Charge failed";
    console.error(
      `[charge-episode] deal ${dealId} line ${body.ioLineItemId}:`,
      message
    );
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
