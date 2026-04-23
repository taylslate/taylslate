// POST /api/outreach/[token]/accept-counter
// Brand-only endpoint. After a show counters, the brand can accept the
// counter terms — that creates a Deal with the *countered* CPM.
//
// The dynamic segment is named `[token]` purely so this directory can sit
// alongside the public-pitch routes (Next.js requires consistent slug names
// at the same depth). In this handler the value is treated as the outreach
// UUID; auth is by Supabase session ownership, not the HMAC signed pitch
// token used for the unauthenticated routes.

import { NextRequest, NextResponse } from "next/server";
import {
  createWave12Deal,
  getAuthenticatedUser,
  getBrandProfileByUserId,
  getCampaignById,
  getOutreachById,
  getWave12DealByOutreachId,
} from "@/lib/data/queries";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { logEvent } from "@/lib/data/events";
import { renderIoReadyForSignature } from "@/lib/email/templates/io-ready-for-signature";
import { sendEmail } from "@/lib/email/send";
import type { Profile, ShowProfile } from "@/lib/data/types";

function siteOrigin(req: NextRequest): string {
  const envOrigin = process.env.NEXT_PUBLIC_SITE_URL;
  if (envOrigin) return envOrigin.replace(/\/$/, "");
  return new URL(req.url).origin;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { token: id } = await params;
  const outreach = await getOutreachById(id);
  if (!outreach) {
    return NextResponse.json({ error: "Outreach not found" }, { status: 404 });
  }

  // Ownership: caller must be the brand on this outreach.
  const brandProfile = await getBrandProfileByUserId(user.id);
  if (!brandProfile || brandProfile.id !== outreach.brand_profile_id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (outreach.response_status !== "countered") {
    return NextResponse.json(
      { error: `Cannot accept counter — outreach is ${outreach.response_status}` },
      { status: 409 }
    );
  }
  if (!outreach.counter_cpm || outreach.counter_cpm <= 0) {
    return NextResponse.json(
      { error: "Outreach has no counter CPM to accept" },
      { status: 400 }
    );
  }

  // Find the show_profile (counter implies show is onboarded).
  const { data: showUser } = await supabaseAdmin
    .from("profiles")
    .select("id, role")
    .ilike("email", outreach.sent_to_email)
    .maybeSingle();
  if (!showUser || (showUser as Profile).role !== "show") {
    return NextResponse.json({ error: "Show profile not found" }, { status: 404 });
  }
  const { data: showProfile } = await supabaseAdmin
    .from("show_profiles")
    .select("id, onboarded_at")
    .eq("user_id", (showUser as Profile).id)
    .maybeSingle();
  if (!showProfile || !(showProfile as ShowProfile).onboarded_at) {
    return NextResponse.json(
      { error: "Show has not finished onboarding" },
      { status: 409 }
    );
  }

  // Idempotent: don't double-create.
  const existing = await getWave12DealByOutreachId(outreach.id);
  if (existing) {
    return NextResponse.json({ deal: existing, alreadyExisted: true });
  }

  // Move the outreach to "accepted" with the countered CPM as the agreed CPM.
  const { data: updated, error: updateErr } = await supabaseAdmin
    .from("outreaches")
    .update({
      response_status: "accepted",
      responded_at: new Date().toISOString(),
    })
    .eq("id", outreach.id)
    .select()
    .single();
  if (updateErr || !updated) {
    return NextResponse.json({ error: "Failed to update outreach" }, { status: 500 });
  }

  const deal = await createWave12Deal({
    outreach_id: outreach.id,
    brand_profile_id: outreach.brand_profile_id,
    show_profile_id: (showProfile as ShowProfile).id,
    agreed_cpm: outreach.counter_cpm,
    agreed_episode_count: outreach.proposed_episode_count,
    agreed_placement: outreach.proposed_placement,
    agreed_flight_start: outreach.proposed_flight_start,
    agreed_flight_end: outreach.proposed_flight_end,
  });
  if (!deal) {
    return NextResponse.json({ error: "Failed to create deal" }, { status: 500 });
  }

  // Two events — counter_accepted captures the negotiation outcome,
  // deal.created is the standard lifecycle event subscribers care about.
  await logEvent({
    eventType: "io.counter_accepted",
    entityType: "outreach",
    entityId: outreach.id,
    actorId: user.id,
    payload: {
      outreach: updated,
      original_cpm: outreach.proposed_cpm,
      accepted_cpm: outreach.counter_cpm,
    },
  });
  await logEvent({
    eventType: "deal.created",
    entityType: "deal",
    entityId: deal.id,
    actorId: user.id,
    payload: { deal, outreach: updated, source: "counter_accept" },
  });

  // Send brand the IO-ready email pointing at the new deal.
  const campaign = await getCampaignById(outreach.campaign_id);
  const origin = siteOrigin(request);
  const brandName =
    brandProfile.brand_identity?.split(/[.,—–-]/)[0]?.trim() ||
    campaign?.name ||
    "Your campaign";
  const email = renderIoReadyForSignature({
    brand_name: brandName,
    show_name: outreach.show_name,
    agreed_cpm: deal.agreed_cpm,
    agreed_episode_count: deal.agreed_episode_count,
    deal_url: `${origin}/deals/${deal.id}`,
  });
  sendEmail({
    to: user.email!,
    subject: email.subject,
    html: email.html,
    text: email.text,
  }).catch((err) => console.error("[accept-counter email] send failed:", err));

  return NextResponse.json({ deal });
}
