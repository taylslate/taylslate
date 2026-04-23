// POST /api/deals/[id]/send-to-docusign
// Brand-only. Generates the IO PDF, creates a DocuSign envelope with the
// brand as routingOrder=1 and the show as routingOrder=2, then returns a
// recipient-view URL the client redirects to.
//
// Idempotent on the envelope side — if the deal already has an envelope,
// we reuse it and just refresh the signing URL.

import { NextRequest, NextResponse } from "next/server";
import {
  getAuthenticatedUser,
  getBrandProfileByUserId,
  getOutreachById,
  getWave12DealById,
  updateWave12Deal,
} from "@/lib/data/queries";
import { generateIoPdfFromDeal } from "@/lib/pdf/io-generator";
import { createEnvelope, getBrandSigningUrl } from "@/lib/docusign/envelope";
import { logEvent } from "@/lib/data/events";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { BrandProfile, ShowProfile } from "@/lib/data/types";

function siteOrigin(req: NextRequest): string {
  const envOrigin = process.env.NEXT_PUBLIC_SITE_URL;
  if (envOrigin) return envOrigin.replace(/\/$/, "");
  return new URL(req.url).origin;
}

function brandDisplayName(bp: BrandProfile, fallback: string): string {
  if (bp.brand_identity) {
    return bp.brand_identity.split(/[.,—–-]/)[0]?.trim() || bp.brand_identity;
  }
  if (bp.brand_website) {
    return bp.brand_website.replace(/^https?:\/\/(www\.)?/, "").split("/")[0];
  }
  return fallback;
}

export async function POST(
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
      { error: `Cannot send for signature in status ${deal.status}` },
      { status: 409 }
    );
  }

  const outreach = await getOutreachById(deal.outreach_id);
  if (!outreach) {
    return NextResponse.json({ error: "Outreach missing" }, { status: 500 });
  }

  const { data: sp } = await supabaseAdmin
    .from("show_profiles")
    .select("*")
    .eq("id", deal.show_profile_id)
    .single();
  if (!sp) {
    return NextResponse.json({ error: "Show profile missing" }, { status: 500 });
  }
  const { data: showUser } = await supabaseAdmin
    .from("profiles")
    .select("email, full_name")
    .eq("id", (sp as ShowProfile).user_id)
    .single();

  const brandName = brandDisplayName(brandProfile, user.email ?? "Advertiser");
  const showName = (sp as ShowProfile).show_name ?? outreach.show_name;
  const brandSigningEmail = user.email ?? "";
  const showSigningEmail = (showUser?.email as string) ?? outreach.sent_to_email;

  // Generate the IO PDF — also fires io.generated event.
  const rendered = generateIoPdfFromDeal({
    deal,
    brandProfile,
    showProfile: sp as ShowProfile,
    outreach,
    brandSigningEmail,
    showSigningEmail,
  });
  await logEvent({
    eventType: "io.generated",
    entityType: "deal",
    entityId: deal.id,
    actorId: user.id,
    payload: {
      io_number: rendered.ioNumber,
      total_gross: rendered.totalGross,
      total_net: rendered.totalNet,
      post_dates: rendered.postDates,
    },
  });

  let envelopeId = deal.docusign_envelope_id ?? null;
  if (!envelopeId) {
    try {
      const env = await createEnvelope({
        pdfBuffer: rendered.pdfBuffer,
        documentName: `${rendered.ioNumber}.pdf`,
        emailSubject: `${brandName} x ${showName} — IO for signature`,
        brand: { name: user.user_metadata?.full_name ?? brandName, email: brandSigningEmail },
        show: { name: (showUser?.full_name as string) ?? showName, email: showSigningEmail },
      });
      envelopeId = env.envelopeId;
      await updateWave12Deal(deal.id, {
        docusign_envelope_id: envelopeId,
        status: "planning", // remains planning until brand actually signs
      });
      await logEvent({
        eventType: "io.sent_for_signature",
        entityType: "deal",
        entityId: deal.id,
        actorId: user.id,
        payload: { envelope_id: envelopeId, io_number: rendered.ioNumber },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "DocuSign error";
      console.error("[send-to-docusign] envelope create failed:", message);
      return NextResponse.json(
        { error: `Couldn't reach DocuSign — ${message}` },
        { status: 502 }
      );
    }
  }

  // Generate brand signing URL. Returns to the deal page after signing.
  try {
    const signing = await getBrandSigningUrl({
      envelopeId,
      signer: {
        name: user.user_metadata?.full_name ?? brandName,
        email: brandSigningEmail,
        clientUserId: "brand",
      },
      returnUrl: `${siteOrigin(request)}/api/deals/${deal.id}/docusign-return`,
    });
    return NextResponse.json({ signing_url: signing.url, envelope_id: envelopeId });
  } catch (err) {
    const message = err instanceof Error ? err.message : "DocuSign error";
    console.error("[send-to-docusign] signing url failed:", message);
    return NextResponse.json(
      { error: `Couldn't generate signing URL — ${message}` },
      { status: 502 }
    );
  }
}
