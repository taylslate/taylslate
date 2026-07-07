// POST /api/admin/seed-deal
//
// Founder-only test-data tool (Layer 1). Fabricates a complete planning-status
// deal between the two TEST_ACCOUNTS (brand1 + show1) so the Wave-14 "2D"
// deal-view surfaces (promo field, tracking link, show-notes blurb) can be
// browser-verified under impersonation. v1 is planning-only by design: later
// statuses are reached by running the real DocuSign/Stripe machinery from a
// seeded deal, never by faking status fields.
//
// Auth: INTERNAL_ADMIN_EMAILS allowlist only (same gate as /api/admin/test-login
// and mark-delivered). The fabricated entities are hardwired to TEST_ACCOUNTS —
// no id/email is ever taken from the client — so the only accounts a seed can
// touch are the two whitelisted test accounts.
//
// No email side effects: this route calls the insert helpers directly
// (createShow / createOutreach / createWave12Deal + a service-role campaign
// insert). The outreach-accept email send lives in the `applyAndNotify` wrapper
// (app/api/outreach/[token]/_shared.ts), which this route does NOT call.

import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import {
  getAuthenticatedUser,
  createShow,
  createOutreach,
  createWave12Deal,
  getWave12DealById,
} from "@/lib/data/queries";
import { isInternalAdmin } from "@/lib/auth/admin";
import { logEvent } from "@/lib/data/events";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { TEST_ACCOUNTS } from "@/lib/admin/test-accounts";

export const runtime = "nodejs";

function siteOrigin(req: NextRequest): string {
  const envOrigin = process.env.NEXT_PUBLIC_SITE_URL;
  if (envOrigin) return envOrigin.replace(/\/$/, "");
  return new URL(req.url).origin;
}

function isoDatePlusDays(days: number): string {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
}

export async function POST(request: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isInternalAdmin(user.email)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const warnings: string[] = [];

  // Hardwired to the two whitelisted test accounts — never client input.
  const brand = TEST_ACCOUNTS.find((a) => a.key === "brand1");
  const show = TEST_ACCOUNTS.find((a) => a.key === "show1");
  if (!brand || !show) {
    return NextResponse.json(
      { error: "Test accounts misconfigured" },
      { status: 500 }
    );
  }

  // Resolve the test accounts' profile ids via the service role. The
  // request-scoped getters (getBrandProfileByUserId / getShowProfileByUserId)
  // are RLS-bound to the ADMIN caller, so they would never see the test users'
  // rows. brand_profile_id / show_profile_id must match the impersonated
  // viewer's owned profile for the deal detail page's ownership check to pass.
  const { data: bp, error: bpErr } = await supabaseAdmin
    .from("brand_profiles")
    .select("id, brand_website")
    .eq("user_id", brand.userId)
    .maybeSingle();
  if (bpErr || !bp) {
    return NextResponse.json(
      { error: "Test brand profile not found — onboard brand1 first" },
      { status: 500 }
    );
  }
  const { data: sp, error: spErr } = await supabaseAdmin
    .from("show_profiles")
    .select("id")
    .eq("user_id", show.userId)
    .maybeSingle();
  if (spErr || !sp) {
    return NextResponse.json(
      { error: "Test show profile not found — onboard show1 first" },
      { status: 500 }
    );
  }

  // The tracking link and half the show-notes blurb derive from the brand's
  // website. If it is blank the surfaces silently vanish — warn, never mutate.
  if (!bp.brand_website || !bp.brand_website.trim()) {
    warnings.push(
      "Test brand brand_profiles.brand_website is blank — the tracking link and " +
        "link half of the show-notes blurb will not render. Set brand1's website " +
        "to verify those surfaces."
    );
  }

  // Unique per call so every seed is fully independent (unique show slug avoids
  // createShow's slug-conflict return-existing branch; unique outreach token
  // satisfies uniq_deals_outreach_id).
  const seedBatch = new Date().toISOString();
  const nonce = randomUUID().slice(0, 8);

  const flightStart = isoDatePlusDays(14); // ~2 weeks out
  const flightEnd = isoDatePlusDays(42); // + 4-week window
  const cpm = 25.0;
  const episodes = 3;
  const placement = "mid-roll" as const;
  const audienceSize = 25000; // ~25K downloads/ep — 3 mid-roll spots

  // a. Show — service role (createShow uses supabaseAdmin internally).
  const seededShow = await createShow({
    name: `[SEED] The Test Feed ${seedBatch} ${nonce}`,
    platform: "podcast",
    description: "Seeded test show for deal-view verification.",
    categories: ["Society & Culture"],
    audience_size: audienceSize,
    price_type: "cpm",
    contact: { name: "Seed Host", email: show.email, method: "email" },
    data_sources: ["seed"],
  });
  if (!seededShow) {
    return NextResponse.json({ error: "Failed to seed show" }, { status: 500 });
  }

  // b. Campaign owned by the test brand. createCampaign uses the RLS-bound
  // client (campaigns has INSERT WITH CHECK auth.uid() = user_id), so an admin
  // caller cannot create a campaign owned by another user through it. Insert
  // via the service role, mirroring createCampaign's column set.
  const { data: seededCampaign, error: campaignErr } = await supabaseAdmin
    .from("campaigns")
    .insert({
      user_id: brand.userId,
      name: `[SEED] Test Campaign ${seedBatch} ${nonce}`,
      brief: { seeded: true, seed_batch: seedBatch },
      budget_total: 25000,
      platforms: ["podcast"],
      status: "planned",
      recommendations: [],
      youtube_recommendations: [],
      expansion_opportunities: [],
    })
    .select("id")
    .single();
  if (campaignErr || !seededCampaign) {
    return NextResponse.json(
      { error: "Failed to seed campaign" },
      { status: 500 }
    );
  }

  // c. Outreach — the accepted outreach the deal materializes from. Satisfies
  // all NOT NULL fields; response_status "accepted" reflects the post-accept
  // state. createOutreach uses supabaseAdmin, so no RLS obstruction.
  const seededOutreach = await createOutreach({
    brand_profile_id: bp.id,
    campaign_id: seededCampaign.id,
    show_id: seededShow.id,
    show_name: seededShow.name,
    proposed_cpm: cpm,
    proposed_episode_count: episodes,
    proposed_placement: placement,
    proposed_flight_start: flightStart,
    proposed_flight_end: flightEnd,
    pitch_body: "Seeded outreach for deal-view verification.",
    sent_to_email: show.email,
    sent_at: seedBatch,
    response_status: "accepted",
    responded_at: seedBatch,
    token: `seed-${nonce}-${randomUUID()}`,
  });
  if (!seededOutreach) {
    return NextResponse.json(
      { error: "Failed to seed outreach" },
      { status: 500 }
    );
  }

  // d. Deal via the existing createWave12Deal path (keeps the legacy-column
  // mirroring + zero-fill in one place). All five ownership columns are set at
  // insert — brand_profile_id / show_profile_id (detail-page ownership),
  // outreach_id (Wave-12 UI gate + IO preview), and legacy brand_id / show_id
  // (NOT NULL in prod + list-surface visibility). No post-insert patch: the
  // insert cannot succeed without brand_id/show_id, so there is no row to patch.
  // created_at defaults to NOW() — never backdated (the day-3/day-14 timeout
  // cron acts on stale planning deals).
  const deal = await createWave12Deal({
    outreach_id: seededOutreach.id,
    brand_profile_id: bp.id,
    show_profile_id: sp.id,
    brand_id: brand.userId,
    show_id: seededShow.id,
    agreed_cpm: cpm,
    agreed_episode_count: episodes,
    agreed_placement: placement,
    agreed_flight_start: flightStart,
    agreed_flight_end: flightEnd,
  });
  if (!deal) {
    return NextResponse.json({ error: "Failed to seed deal" }, { status: 500 });
  }

  // f. Assert agreed_cpm is non-null — Wave12DealClient calls
  // deal.agreed_cpm.toFixed(2) unguarded, the one field that hard-throws the
  // detail render. Read back through the same path the page uses.
  const verify = await getWave12DealById(deal.id);
  if (!verify || verify.agreed_cpm == null) {
    return NextResponse.json(
      { error: "Seed produced a deal with null agreed_cpm" },
      { status: 500 }
    );
  }

  // Marker: [SEED] name prefixes + this event are the test-data convention
  // (no is_seed column in v1). logEvent is fail-soft and never throws.
  await logEvent({
    eventType: "deal.seeded",
    entityType: "deal",
    entityId: deal.id,
    actorId: user.id,
    payload: {
      seeded: true,
      seed_batch: seedBatch,
      showId: seededShow.id,
      campaignId: seededCampaign.id,
      outreachId: seededOutreach.id,
      dealId: deal.id,
    },
  });

  const origin = siteOrigin(request);
  return NextResponse.json({
    dealId: deal.id,
    dealUrl: `${origin}/deals/${deal.id}`,
    seededEntityIds: {
      show: seededShow.id,
      campaign: seededCampaign.id,
      outreach: seededOutreach.id,
      deal: deal.id,
    },
    warnings,
  });
}
