// POST /api/admin/seed-outreach — seed a pending outreach + campaign so the
// REAL public accept path can be driven end-to-end (Verification layer).
//
// seed-deal fabricates a finished planning-status deal DIRECTLY, bypassing the
// accept path — so the accept-flow launch-blocker cluster's fixes never execute
// through it. This route seeds only the INPUTS to the accept flow: a campaign +
// a `pending` outreach carrying a valid HMAC token, so the public accept URL
// (/outreach/<token>) actually verifies and runs applyAndNotify — exercising
// the accept cluster (NOT-NULL deal creation, materialization, backfill,
// flight-date rendering) live. This route never touches the accept path itself.
//
// Two variants (the only client-supplied value):
//   - "catalog"     → outreach.show_id points at a seeded [SEED] catalog show
//                     (is_discoverable=false). sent_to_email is the onboarded
//                     test show (show1), so accept resolves show_profile_id at
//                     accept time and the deal is show-visible immediately.
//   - "non_catalog" → outreach.show_id null; show_name + a fresh chris+ alias
//                     (routes to the real inbox, un-onboarded each run), so
//                     accept MATERIALIZES a non-discoverable shows row
//                     (otr-<id8> slug) with a null show_profile_id, then the
//                     show onboards via magic link → backfill links the deal.
//
// Auth: INTERNAL_ADMIN_EMAILS allowlist only (same gate as seed-deal). The
// brand + onboarded-show accounts are hardwired to TEST_ACCOUNTS — never client
// input; `variant` only selects between the two hardwired shapes.
//
// No email side effects: this route never sends the outreach email (it calls
// createOutreach + a service-role token update directly, not the send path).
// The accept/IO emails fire later, from the real accept path, when Chris clicks.

import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import {
  getAuthenticatedUser,
  createShow,
  createOutreach,
} from "@/lib/data/queries";
import { signOutreachToken } from "@/lib/io/tokens";
import { isInternalAdmin } from "@/lib/auth/admin";
import { logEvent } from "@/lib/data/events";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { TEST_ACCOUNTS } from "@/lib/admin/test-accounts";
import type { Outreach } from "@/lib/data/types";

export const runtime = "nodejs";

type SeedVariant = "catalog" | "non_catalog";

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

  // The only client-supplied value: which of the two hardwired shapes to seed.
  // A missing/empty body is a valid catalog seed (admin curl with no payload).
  let variant: SeedVariant = "catalog";
  try {
    const body = (await request.json()) as { variant?: unknown };
    if (body && body.variant != null) {
      if (body.variant !== "catalog" && body.variant !== "non_catalog") {
        return NextResponse.json(
          { error: "variant must be 'catalog' or 'non_catalog'" },
          { status: 400 }
        );
      }
      variant = body.variant;
    }
  } catch {
    // No body / invalid JSON → default to catalog.
  }

  const warnings: string[] = [];

  // Brand is always the onboarded test brand (brand1) — never client input.
  const brand = TEST_ACCOUNTS.find((a) => a.key === "brand1");
  const show1 = TEST_ACCOUNTS.find((a) => a.key === "show1");
  if (!brand || !show1) {
    return NextResponse.json(
      { error: "Test accounts misconfigured" },
      { status: 500 }
    );
  }

  // Resolve the test brand's profile via service role (RLS would hide it from
  // the admin caller). brand_profile_id must match brand1's owned profile so the
  // accept path's brand notification + the deal's ownership columns resolve to
  // the impersonated brand viewer.
  const { data: bp, error: bpErr } = await supabaseAdmin
    .from("brand_profiles")
    .select("id")
    .eq("user_id", brand.userId)
    .maybeSingle();
  if (bpErr || !bp) {
    return NextResponse.json(
      { error: "Test brand profile not found — onboard brand1 first" },
      { status: 500 }
    );
  }

  // Unique per call so every seed is fully independent (unique campaign name,
  // unique outreach token, unique per-outreach materialize slug).
  const seedBatch = new Date().toISOString();
  const nonce = randomUUID().slice(0, 8);

  const flightStart = isoDatePlusDays(14); // ~2 weeks out
  const flightEnd = isoDatePlusDays(42); // + 4-week window
  const cpm = 25.0;
  const episodes = 3;
  const placement = "mid-roll" as const;

  // Campaign owned by the test brand. createCampaign is RLS-bound to
  // auth.uid() = user_id, so an admin caller can't own it through that helper —
  // insert via the service role, mirroring seed-deal's campaign insert.
  const { data: seededCampaign, error: campaignErr } = await supabaseAdmin
    .from("campaigns")
    .insert({
      user_id: brand.userId,
      name: `[SEED] Accept-Path Campaign ${seedBatch} ${nonce}`,
      brief: { seeded: true, seed_batch: seedBatch, variant },
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

  // Variant-specific show wiring.
  let seededShowId: string | null = null;
  let showName: string;
  let sentToEmail: string;
  if (variant === "catalog") {
    // Seed a non-discoverable [SEED] catalog show; the outreach points straight
    // at it. sent_to_email is the ONBOARDED test show so accept resolves
    // show_profile_id at accept time and the deal is show-visible immediately
    // (this variant does not exercise the onboarding/backfill leg).
    const seededShow = await createShow({
      name: `[SEED] Catalog Feed ${seedBatch} ${nonce}`,
      platform: "podcast",
      description: "Seeded catalog show for accept-path verification.",
      categories: ["Society & Culture"],
      audience_size: 25000,
      price_type: "cpm",
      contact: { name: "Seed Host", email: show1.email, method: "email" },
      data_sources: ["seed"],
      // Keep seeded shows out of shared discovery (migration 031).
      is_discoverable: false,
    });
    if (!seededShow) {
      return NextResponse.json(
        { error: "Failed to seed catalog show" },
        { status: 500 }
      );
    }
    seededShowId = seededShow.id;
    showName = seededShow.name;
    sentToEmail = show1.email;
  } else {
    // Non-catalog: no show_id. A fresh chris+ alias (all +aliases deliver to the
    // real inbox) keeps the magic-link/onboarding leg drivable AND un-onboarded
    // each run, so accept materializes a non-discoverable show + null
    // show_profile_id, then onboarding backfills the deal. The [SEED] prefix on
    // the name makes the MATERIALIZED show (name = show_name) teardown-
    // discoverable by prefix, in addition to the otr-<id8> slug linkage.
    showName = `[SEED] Materialized Feed ${seedBatch} ${nonce}`;
    sentToEmail = `chris+seedotr-${nonce}@taylslate.com`;
  }

  // Create the outreach in the acceptable `pending` state (isOutreachOpen only
  // treats `pending` as open), then sign the real HMAC token from its id — the
  // token binds to the row id, unknown until after insert — and swap it in, so
  // the returned /outreach/<token> URL verifies against the real secret exactly
  // like a production send. (Mirrors app/api/outreach/route.ts.)
  const placeholderToken = `pending_seed_${nonce}_${randomUUID()}`;
  const draft: Omit<Outreach, "id" | "created_at" | "updated_at"> = {
    brand_profile_id: bp.id,
    campaign_id: seededCampaign.id,
    show_id: seededShowId,
    podscan_id: null,
    show_name: showName,
    proposed_cpm: cpm,
    proposed_episode_count: episodes,
    proposed_placement: placement,
    proposed_flight_start: flightStart,
    proposed_flight_end: flightEnd,
    pitch_body:
      "Seeded outreach for accept-path verification — drive the real accept URL.",
    sent_at: seedBatch,
    sent_to_email: sentToEmail,
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
      { error: "Failed to seed outreach" },
      { status: 500 }
    );
  }

  const realToken = signOutreachToken(created.id);
  const { data: finalized, error: tokenErr } = await supabaseAdmin
    .from("outreaches")
    .update({ token: realToken })
    .eq("id", created.id)
    .select("id, token")
    .single();
  if (tokenErr || !finalized) {
    return NextResponse.json(
      { error: "Couldn't finalize seeded outreach token" },
      { status: 500 }
    );
  }

  // Marker event (symmetric with deal.seeded). Payload carries every id teardown
  // needs to discover this seed directly, plus the variant + batch. logEvent is
  // fail-soft and never throws.
  await logEvent({
    eventType: "outreach.seeded",
    entityType: "outreach",
    entityId: created.id,
    actorId: user.id,
    payload: {
      seeded: true,
      seed_batch: seedBatch,
      variant,
      outreachId: created.id,
      campaignId: seededCampaign.id,
      showId: seededShowId,
      sentToEmail,
    },
  });

  const origin = siteOrigin(request);
  return NextResponse.json({
    variant,
    outreachId: created.id,
    // The public pitch page. Open it, then click Accept to drive the real path.
    acceptUrl: `${origin}/outreach/${realToken}`,
    sentToEmail,
    seededEntityIds: {
      campaign: seededCampaign.id,
      show: seededShowId,
      outreach: created.id,
    },
    warnings,
  });
}
