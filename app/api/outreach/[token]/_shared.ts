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
  createWave12Deal,
  getCampaignById,
  getOutreachById,
  getWave12DealByOutreachId,
  isOutreachOpen,
  updateOutreachResponse,
} from "@/lib/data/queries";
import { logEvent } from "@/lib/data/events";
import { renderBrandNotification } from "@/lib/email/templates/outreach-response-brand";
import { renderIoReadyForSignature } from "@/lib/email/templates/io-ready-for-signature";
import { sendEmail } from "@/lib/email/send";
import { checkRateLimit } from "@/lib/utils/rate-limit";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type {
  Outreach,
  OutreachResponseStatus,
  BrandProfile,
  Profile,
  ShowProfile,
  Wave12Deal,
} from "@/lib/data/types";

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
): Promise<{ outreach: Outreach; deal?: Wave12Deal } | { error: string; status: number }> {
  const updated = await updateOutreachResponse(args.resolved.outreach.id, {
    response_status: args.status,
    responded_at: new Date().toISOString(),
    counter_cpm: args.counter_cpm ?? null,
    counter_message: args.counter_message ?? null,
    decline_reason: args.decline_reason ?? null,
  });
  if (!updated) return { error: "Failed to record response", status: 500 };

  // Wave 12: when a show accepts, materialize a Deal so the brand can begin
  // signing. We need a show_profile_id to satisfy the FK; if the show isn't
  // onboarded yet we skip deal creation here and the caller will create it
  // after onboarding completes (via the post-magic-link return flow).
  let createdDeal: Wave12Deal | undefined;
  if (args.status === "accepted") {
    const showProfileId = await resolveShowProfileIdForOutreach(updated);
    if (showProfileId) {
      const existing = await getWave12DealByOutreachId(updated.id);
      if (!existing) {
        const dealResult = await createWave12Deal({
          outreach_id: updated.id,
          brand_profile_id: updated.brand_profile_id,
          show_profile_id: showProfileId,
          agreed_cpm: updated.proposed_cpm,
          agreed_episode_count: updated.proposed_episode_count,
          agreed_placement: updated.proposed_placement,
          agreed_flight_start: updated.proposed_flight_start,
          agreed_flight_end: updated.proposed_flight_end,
        });
        if (dealResult) {
          createdDeal = dealResult;
          await logEvent({
            eventType: "deal.created",
            entityType: "deal",
            entityId: dealResult.id,
            payload: {
              deal: dealResult,
              outreach: updated,
              show_profile_id: showProfileId,
            },
          });
        }
      } else {
        createdDeal = existing;
      }
    } else {
      console.warn(
        "[applyAndNotify] outreach accepted but show_profile not yet found — deal creation deferred",
        updated.id
      );
    }
  }

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
    outreach_url: createdDeal
      ? `${origin}/deals/${createdDeal.id}`
      : `${origin}/campaigns/${updated.campaign_id}/outreach`,
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

  // Wave 12: extra "IO ready for signature" email when a deal materialized.
  // Uses a separate template so the CTA points straight at the deal page.
  if (createdDeal) {
    const ioEmail = renderIoReadyForSignature({
      brand_name: brandName,
      show_name: updated.show_name,
      agreed_cpm: createdDeal.agreed_cpm,
      agreed_episode_count: createdDeal.agreed_episode_count,
      deal_url: `${origin}/deals/${createdDeal.id}`,
    });
    sendEmail({
      to: args.resolved.brandUser.email,
      subject: ioEmail.subject,
      html: ioEmail.html,
      text: ioEmail.text,
    }).catch((err) => console.error("[io-ready] send failed:", err));
  }

  return { outreach: updated, deal: createdDeal };
}

/**
 * Find the show_profile.id whose owning user's email matches the outreach's
 * sent_to_email AND has completed onboarding. Returns null if no onboarded
 * profile exists yet (the show may still be in the magic-link/onboarding flow).
 */
async function resolveShowProfileIdForOutreach(
  outreach: Outreach
): Promise<string | null> {
  const { data: profile } = await supabaseAdmin
    .from("profiles")
    .select("id, role")
    .ilike("email", outreach.sent_to_email)
    .maybeSingle();
  if (!profile || (profile as Profile).role !== "show") return null;
  const { data: showProfile } = await supabaseAdmin
    .from("show_profiles")
    .select("id, onboarded_at")
    .eq("user_id", (profile as Profile).id)
    .maybeSingle();
  if (!showProfile || !(showProfile as ShowProfile).onboarded_at) return null;
  return (showProfile as ShowProfile).id;
}
