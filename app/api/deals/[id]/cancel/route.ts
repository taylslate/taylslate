// POST /api/deals/[id]/cancel
// Brand-only. Allowed in pre-signature states ('planning' or 'brand_signed').
// If a DocuSign envelope exists, void it. Notify the show.

import { NextRequest, NextResponse } from "next/server";
import {
  getAuthenticatedUser,
  getBrandProfileByUserId,
  getOutreachById,
  getWave12DealById,
  updateWave12Deal,
} from "@/lib/data/queries";
import { voidEnvelope } from "@/lib/docusign/envelope";
import { logEvent } from "@/lib/data/events";
import { renderDealCancelledShow } from "@/lib/email/templates/deal-cancelled-show";
import { sendEmail } from "@/lib/email/send";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { ShowProfile, BrandProfile } from "@/lib/data/types";

const CANCELLABLE = new Set(["planning", "brand_signed"]);

interface CancelBody {
  reason?: string;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  let body: CancelBody = {};
  try {
    body = (await request.json()) as CancelBody;
  } catch {
    // Empty body is fine for cancel.
  }

  const deal = await getWave12DealById(id);
  if (!deal) return NextResponse.json({ error: "Deal not found" }, { status: 404 });

  const brandProfile = await getBrandProfileByUserId(user.id);
  if (!brandProfile || brandProfile.id !== deal.brand_profile_id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (!CANCELLABLE.has(deal.status)) {
    return NextResponse.json(
      { error: `Cannot cancel a deal in status ${deal.status}` },
      { status: 409 }
    );
  }

  // Void DocuSign envelope if one exists. Best-effort — voidEnvelope swallows
  // errors so a transient DocuSign outage can't trap the deal.
  if (deal.docusign_envelope_id) {
    await voidEnvelope(
      deal.docusign_envelope_id,
      body.reason?.slice(0, 200) ?? "Brand cancelled deal"
    );
  }

  const updated = await updateWave12Deal(deal.id, {
    status: "cancelled",
    cancelled_at: new Date().toISOString(),
    cancellation_reason: body.reason?.trim() || null,
  });
  if (!updated) {
    return NextResponse.json({ error: "Failed to cancel" }, { status: 500 });
  }

  await logEvent({
    eventType: "deal.cancelled",
    entityType: "deal",
    entityId: deal.id,
    actorId: user.id,
    payload: {
      deal: updated,
      cause: "brand_cancelled",
      reason: body.reason ?? null,
    },
  });

  // Notify the show.
  const { data: sp } = await supabaseAdmin
    .from("show_profiles")
    .select("user_id")
    .eq("id", deal.show_profile_id)
    .single();
  if (sp) {
    const { data: showUser } = await supabaseAdmin
      .from("profiles")
      .select("email")
      .eq("id", (sp as ShowProfile).user_id)
      .single();
    const outreach = await getOutreachById(deal.outreach_id);
    const brandName =
      brandProfile.brand_identity?.split(/[.,—–-]/)[0]?.trim() ||
      (brandProfile as BrandProfile).brand_website ||
      "The brand";
    const email = renderDealCancelledShow({
      brand_name: brandName,
      show_name: outreach?.show_name ?? "your show",
      reason: body.reason ?? null,
      cause: "brand_cancelled",
    });
    if (showUser?.email) {
      sendEmail({
        to: showUser.email as string,
        subject: email.subject,
        html: email.html,
        text: email.text,
      }).catch((err) => console.error("[cancel email] send failed:", err));
    }
  }

  return NextResponse.json({ deal: updated });
}
