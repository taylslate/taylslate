// POST /api/outreach
// Creates an outreach record, signs a token, and sends the brand-forward email.
// One outreach per (campaign_id, show). Unique constraint at the DB level.

import { NextRequest, NextResponse } from "next/server";
import {
  createOutreach,
  getAuthenticatedUser,
  getBrandProfileByUserId,
  getCampaignById,
} from "@/lib/data/queries";
import { signOutreachToken } from "@/lib/io/tokens";
import { renderOutreachEmail } from "@/lib/email/templates/outreach";
import { sendEmail } from "@/lib/email/send";
import { recordEvent } from "@/lib/data/event-log";
import type {
  Outreach,
  OutreachPlacement,
} from "@/lib/data/types";
import { supabaseAdmin } from "@/lib/supabase/admin";

interface CreateOutreachBody {
  campaign_id: string;
  show: {
    show_id?: string | null;
    podscan_id?: string | null;
    show_name: string;
    contact_email: string;
    categories?: string[];
    audience_size?: number | null;
  };
  proposed: {
    cpm: number;
    episode_count: number;
    placement: OutreachPlacement;
    flight_start: string;
    flight_end: string;
  };
  pitch_body: string;
}

const ALLOWED_PLACEMENTS: OutreachPlacement[] = ["pre-roll", "mid-roll", "post-roll"];

function siteOrigin(req: NextRequest): string {
  const envOrigin = process.env.NEXT_PUBLIC_SITE_URL;
  if (envOrigin) return envOrigin.replace(/\/$/, "");
  return new URL(req.url).origin;
}

function isValidEmail(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= 320 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
  );
}

function validate(body: CreateOutreachBody): string | null {
  if (!body.campaign_id) return "campaign_id is required";
  if (!body.show?.show_name) return "show.show_name is required";
  if (!isValidEmail(body.show?.contact_email)) return "valid show.contact_email is required";
  if (!body.show?.show_id && !body.show?.podscan_id) {
    return "show must include show_id or podscan_id";
  }
  const p = body.proposed;
  if (!p) return "proposed terms are required";
  if (!Number.isFinite(p.cpm) || p.cpm <= 0) return "proposed.cpm must be > 0";
  if (!Number.isFinite(p.episode_count) || p.episode_count <= 0) {
    return "proposed.episode_count must be > 0";
  }
  if (!ALLOWED_PLACEMENTS.includes(p.placement)) return "invalid placement";
  if (!p.flight_start || !p.flight_end) return "flight dates required";
  if (new Date(p.flight_end) < new Date(p.flight_start)) return "flight_end before flight_start";
  if (!body.pitch_body || body.pitch_body.trim().length < 30) {
    return "pitch_body too short";
  }
  if (body.pitch_body.length > 5000) return "pitch_body too long";
  return null;
}

export async function POST(request: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: CreateOutreachBody;
  try {
    body = (await request.json()) as CreateOutreachBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const validationError = validate(body);
  if (validationError) {
    return NextResponse.json({ error: validationError }, { status: 400 });
  }

  const brandProfile = await getBrandProfileByUserId(user.id);
  if (!brandProfile) {
    return NextResponse.json(
      { error: "Brand profile required before sending outreach" },
      { status: 400 }
    );
  }

  const campaign = await getCampaignById(body.campaign_id);
  if (!campaign || campaign.user_id !== user.id) {
    return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
  }

  // Generate token + persist. The token is signed from the outreach id, but
  // we don't have the id until after insert. Sign a placeholder, swap in the
  // real signed token after we know the id.
  const placeholderToken = `pending_${Date.now()}_${Math.random().toString(36).slice(2)}`;

  const draft: Omit<Outreach, "id" | "created_at" | "updated_at"> = {
    brand_profile_id: brandProfile.id,
    campaign_id: campaign.id,
    show_id: body.show.show_id ?? null,
    podscan_id: body.show.podscan_id ?? null,
    show_name: body.show.show_name,
    proposed_cpm: Math.round(body.proposed.cpm * 100) / 100,
    proposed_episode_count: Math.round(body.proposed.episode_count),
    proposed_placement: body.proposed.placement,
    proposed_flight_start: body.proposed.flight_start,
    proposed_flight_end: body.proposed.flight_end,
    pitch_body: body.pitch_body.trim(),
    sent_at: null,
    sent_to_email: body.show.contact_email.toLowerCase().trim(),
    response_status: "pending",
    responded_at: null,
    counter_cpm: null,
    counter_message: null,
    decline_reason: null,
    token: placeholderToken,
  };

  const created = await createOutreach(draft);
  if (!created) {
    return NextResponse.json(
      { error: "Couldn't create outreach (duplicate or DB error)" },
      { status: 409 }
    );
  }

  const realToken = signOutreachToken(created.id);
  const { data: updated, error: updateErr } = await supabaseAdmin
    .from("outreaches")
    .update({ token: realToken, sent_at: new Date().toISOString() })
    .eq("id", created.id)
    .select()
    .single();
  if (updateErr || !updated) {
    return NextResponse.json(
      { error: "Couldn't finalize outreach token" },
      { status: 500 }
    );
  }

  const brandName =
    brandProfile.brand_identity?.split(/[.,—–-]/)[0]?.trim() ||
    campaign.name ||
    "Sponsorship";

  const pitchUrl = `${siteOrigin(request)}/outreach/${realToken}`;
  const email = renderOutreachEmail({
    show_name: body.show.show_name,
    to_email: body.show.contact_email,
    brand_name: brandName,
    brand_url: brandProfile.brand_website ?? null,
    pitch_body: body.pitch_body.trim(),
    proposed_cpm: draft.proposed_cpm,
    proposed_episode_count: draft.proposed_episode_count,
    proposed_placement: draft.proposed_placement,
    proposed_flight_start: draft.proposed_flight_start,
    proposed_flight_end: draft.proposed_flight_end,
    pitch_url: pitchUrl,
  });

  const sendResult = await sendEmail({
    to: body.show.contact_email,
    subject: email.subject,
    html: email.html,
    text: email.text,
    from: email.from,
    reply_to: email.reply_to,
  });

  await recordEvent({
    customerId: user.id,
    operationType: "outreach_sent",
    metadata: {
      outreach_id: created.id,
      show_id: body.show.show_id ?? null,
    },
  });

  return NextResponse.json({
    outreach: updated,
    pitch_url: pitchUrl,
    email_sent: sendResult.ok,
    email_reason: sendResult.reason,
  });
}
