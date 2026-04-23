// Shared validation + dispatch for the public action endpoints.
// All three (accept/counter/decline) need the same upfront work:
//   1. token signature check
//   2. outreach load
//   3. terminal-state check
//   4. rate limit
//   5. brand notification email
//
// Keeping this in one place makes it impossible for one route to drift from
// the others on what counts as "already responded".

import { NextResponse } from "next/server";
import { verifyOutreachToken } from "@/lib/io/tokens";
import {
  getOutreachById,
  getCampaignById,
  isOutreachOpen,
  updateOutreachResponse,
} from "@/lib/data/queries";
import { renderBrandNotification } from "@/lib/email/templates/outreach-response-brand";
import { sendEmail } from "@/lib/email/send";
import { checkRateLimit } from "@/lib/utils/rate-limit";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { Outreach, OutreachResponseStatus, BrandProfile, Profile } from "@/lib/data/types";

export interface ResolvedOutreach {
  outreach: Outreach;
  brandProfile: BrandProfile;
  brandUser: Profile;
  campaignName: string;
}

export type ResolveResult =
  | { ok: true; data: ResolvedOutreach }
  | { ok: false; response: NextResponse };

export async function resolveOutreachOr400(
  token: string,
  request: Request
): Promise<ResolveResult> {
  const payload = verifyOutreachToken(token);
  if (!payload) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Invalid token" }, { status: 401 }),
    };
  }

  // Rate limit per token. Returns 429 with Retry-After on overflow.
  const rate = checkRateLimit(`outreach:${payload.outreach_id}`, 5, 60_000);
  if (!rate.ok) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Too many requests" },
        { status: 429, headers: { "Retry-After": String(rate.retryAfterSec) } }
      ),
    };
  }

  const outreach = await getOutreachById(payload.outreach_id);
  if (!outreach) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Outreach not found" }, { status: 404 }),
    };
  }
  if (!isOutreachOpen(outreach.response_status)) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "This opportunity has already been responded to", status: outreach.response_status },
        { status: 409 }
      ),
    };
  }

  // Brand profile + user (admin client — public endpoint, RLS would block).
  const { data: brandProfile, error: bpErr } = await supabaseAdmin
    .from("brand_profiles")
    .select("*")
    .eq("id", outreach.brand_profile_id)
    .single();
  if (bpErr || !brandProfile) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Brand profile missing" }, { status: 500 }),
    };
  }

  const { data: brandUser } = await supabaseAdmin
    .from("profiles")
    .select("*")
    .eq("id", brandProfile.user_id)
    .single();
  if (!brandUser) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Brand user missing" }, { status: 500 }),
    };
  }

  const campaign = await getCampaignById(outreach.campaign_id);
  // Touch the request param to silence unused warnings & keep the door open
  // for adding origin/header checks later.
  void request;

  return {
    ok: true,
    data: {
      outreach,
      brandProfile: brandProfile as BrandProfile,
      brandUser: brandUser as Profile,
      campaignName: campaign?.name ?? "your campaign",
    },
  };
}

export interface NotifyArgs {
  resolved: ResolvedOutreach;
  request: Request;
  status: Extract<OutreachResponseStatus, "accepted" | "countered" | "declined">;
  counter_cpm?: number | null;
  counter_message?: string | null;
  decline_reason?: string | null;
}

function siteOrigin(request: Request): string {
  const envOrigin = process.env.NEXT_PUBLIC_SITE_URL;
  if (envOrigin) return envOrigin.replace(/\/$/, "");
  return new URL(request.url).origin;
}

export async function applyAndNotify(
  args: NotifyArgs
): Promise<{ outreach: Outreach } | { error: string; status: number }> {
  const updated = await updateOutreachResponse(args.resolved.outreach.id, {
    response_status: args.status,
    responded_at: new Date().toISOString(),
    counter_cpm: args.counter_cpm ?? null,
    counter_message: args.counter_message ?? null,
    decline_reason: args.decline_reason ?? null,
  });
  if (!updated) return { error: "Failed to record response", status: 500 };

  const brandName =
    args.resolved.brandProfile.brand_identity?.split(/[.,—–-]/)[0]?.trim() ||
    args.resolved.brandUser.full_name ||
    args.resolved.brandUser.company_name ||
    "Your campaign";

  const origin = siteOrigin(args.request);
  const email = renderBrandNotification({
    brand_name: brandName,
    show_name: updated.show_name,
    campaign_name: args.resolved.campaignName,
    status: args.status,
    campaign_url: `${origin}/campaigns/${updated.campaign_id}`,
    outreach_url: `${origin}/campaigns/${updated.campaign_id}/outreach`,
    proposed_cpm: updated.proposed_cpm,
    counter_cpm: updated.counter_cpm,
    counter_message: updated.counter_message,
    decline_reason: updated.decline_reason,
  });

  // Fire-and-forget — show shouldn't see a brand email failure.
  sendEmail({
    to: args.resolved.brandUser.email,
    subject: email.subject,
    html: email.html,
    text: email.text,
  }).catch((err) => console.error("[outreach notify] send failed:", err));

  return { outreach: updated };
}
