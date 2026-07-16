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
  resolveOrMaterializeShowIdForOutreach,
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
  const outreach = args.resolved.outreach;

  // Wave 12 atomicity (Codex P6): when a show accepts, create the Deal BEFORE
  // flipping the outreach to "accepted". If deal creation fails we return an
  // error and leave the outreach `pending` (still actionable) — never a terminal
  // `accepted` with no deal and a false "accepted" email to the brand. Reads use
  // the pre-update outreach snapshot (id / brand_profile_id / proposed_* are
  // unchanged by the status flip). deals.show_id is NOT NULL; show_profile_id is
  // nullable and backfilled at onboarding, so the deal is created even if the
  // show hasn't onboarded yet.
  let createdDeal: Wave12Deal | undefined;
  let dealJustCreated = false;
  let materializedShowId: string | undefined;
  let resolvedShowProfileId: string | null | undefined;
  if (args.status === "accepted") {
    const existing = await getWave12DealByOutreachId(outreach.id);
    if (existing) {
      createdDeal = existing;
    } else {
      const showId = await resolveOrMaterializeShowIdForOutreach(outreach);
      if (!showId) {
        return {
          error: "Couldn't resolve a show for this opportunity — please retry",
          status: 500,
        };
      }
      const showProfileId = await resolveShowProfileIdForOutreach(outreach);
      const dealResult = await createWave12Deal({
        outreach_id: outreach.id,
        brand_profile_id: outreach.brand_profile_id,
        brand_id: args.resolved.brandProfile.user_id,
        show_id: showId,
        show_profile_id: showProfileId,
        agreed_cpm: outreach.proposed_cpm,
        agreed_episode_count: outreach.proposed_episode_count,
        agreed_placement: outreach.proposed_placement,
        agreed_flight_start: outreach.proposed_flight_start,
        agreed_flight_end: outreach.proposed_flight_end,
      });
      if (!dealResult) {
        return {
          error: "Couldn't create the deal for this opportunity — please retry",
          status: 500,
        };
      }
      createdDeal = dealResult;
      dealJustCreated = true;
      materializedShowId = showId;
      resolvedShowProfileId = showProfileId;
    }
  }

  // Deal (if any) is now committed — record the response. For an accept, the
  // deal already exists, so a failure here self-heals on retry via the
  // idempotency guard above rather than orphaning an accepted outreach.
  const updated = await updateOutreachResponse(outreach.id, {
    response_status: args.status,
    responded_at: new Date().toISOString(),
    counter_cpm: args.counter_cpm ?? null,
    counter_message: args.counter_message ?? null,
    decline_reason: args.decline_reason ?? null,
  });
  if (!updated) return { error: "Failed to record response", status: 500 };

  if (dealJustCreated && createdDeal) {
    await logEvent({
      eventType: "deal.created",
      entityType: "deal",
      entityId: createdDeal.id,
      payload: {
        deal: createdDeal,
        outreach: updated,
        show_id: materializedShowId,
        show_profile_id: resolvedShowProfileId,
      },
    });
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
