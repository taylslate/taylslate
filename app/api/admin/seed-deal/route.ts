// POST /api/admin/seed-deal   — seed a test deal (Layer 1)
// DELETE /api/admin/seed-deal — tear down ALL seeded test data (Layer 2)
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

// The seed marker convention (no is_seed column in v1): every seeded show and
// campaign carries this exact name prefix, and every completed seed fires a
// deal.seeded event. Teardown discovers from BOTH so a partial seed (event
// never fired) is still fully removed. `[` / `]` are literal in SQL LIKE
// (only `%` and `_` are wildcards), so this matches the prefix exactly.
const SEED_NAME_PREFIX = "[SEED] ";

// Small helper: pull a string field off an untyped event payload.
function payloadString(
  payload: unknown,
  key: string
): string | null {
  if (!payload || typeof payload !== "object") return null;
  const v = (payload as Record<string, unknown>)[key];
  return typeof v === "string" && v.length > 0 ? v : null;
}

// Collect distinct `id` values from a Supabase select result.
function collectIds(rows: { id: string }[] | null | undefined): string[] {
  return (rows ?? []).map((r) => r.id);
}

// A discovery / pre-count query failed. Thrown so the handler aborts BEFORE any
// destructive delete — a query error must never be mistaken for "nothing seeded"
// (which would return { deleted: {} } while seeds silently linger).
class SeedTeardownQueryError extends Error {}

// Await a select, fail loud on a query error, return its `id` column.
function idsOrThrow(
  label: string,
  res: { data: unknown; error: { message: string } | null }
): string[] {
  if (res.error) {
    throw new SeedTeardownQueryError(`${label}: ${res.error.message}`);
  }
  return collectIds(res.data as { id: string }[] | null);
}

// DELETE /api/admin/seed-deal
//
// Removes ALL seeded test data so seeds never linger (the day-3/day-14 planning
// timeout cron would otherwise email/cancel stale seeds, and they pollute prod).
//
// Discovery is belt-and-suspenders: seeded entity ids come from BOTH the
// deal.seeded event payloads AND an independent [SEED]-prefix scan of shows +
// campaigns, unioned — so a partial seed whose event never fired is still found.
// Outreach discovery is widened to any outreach linked to a seeded campaign or
// show (both marker-scoped via the prefix), so a partial seed that got as far as
// an outreach+deal but never fired its event is torn down through the normal
// cascade rather than tripping the surviving-deal backstop.
//
// Deletion order follows the FK cascade:
//   1. outreaches — deals.outreach_id is ON DELETE CASCADE (013) and
//      insertion_orders.deal_id is ON DELETE CASCADE (001), so deleting the
//      seeded outreaches removes their deals + IOs in one shot.
//   2. shows — deals.show_id is NOT NULL with NO ACTION (RESTRICT). If a deal
//      somehow survived step 1 the show delete would FK-fail, so we VERIFY the
//      deals are gone first and REPORT (500 + survivingDeals) rather than swallow.
//   3. campaigns — seeded deals leave deals.campaign_id NULL, so nothing
//      RESTRICTs this; outreaches.campaign_id is ON DELETE CASCADE (011), a final
//      safety net for any eventless orphan outreach with no deal.
//
// Safety: every delete is scoped by `.in("id", <discovered seeded ids>)`, so a
// row lacking the [SEED] prefix or a deal.seeded reference is never targeted.
// Zero seeded entities → 200 { deleted: {} }, never an error.
export async function DELETE() {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isInternalAdmin(user.email)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    return await runTeardown(user.id);
  } catch (err) {
    // A discovery / pre-count query failed. Nothing has been deleted yet (these
    // throws only fire before the deletion phase), so abort loudly rather than
    // let a query error masquerade as an empty result.
    if (err instanceof SeedTeardownQueryError) {
      return NextResponse.json(
        { error: `Teardown aborted before any deletion — ${err.message}` },
        { status: 500 }
      );
    }
    throw err;
  }
}

async function runTeardown(adminId: string) {
  // --- Discovery -----------------------------------------------------------

  // 1. deal.seeded event payloads → the ids each completed seed recorded.
  const eventsRes = await supabaseAdmin
    .from("domain_events")
    .select("payload")
    .eq("event_type", "deal.seeded");
  if (eventsRes.error) {
    throw new SeedTeardownQueryError(
      `deal.seeded event scan: ${eventsRes.error.message}`
    );
  }

  const eventShowIds = new Set<string>();
  const eventCampaignIds = new Set<string>();
  const eventOutreachIds = new Set<string>();
  for (const row of eventsRes.data ?? []) {
    const p = (row as { payload?: unknown }).payload;
    const showId = payloadString(p, "showId");
    const campaignId = payloadString(p, "campaignId");
    const outreachId = payloadString(p, "outreachId");
    if (showId) eventShowIds.add(showId);
    if (campaignId) eventCampaignIds.add(campaignId);
    if (outreachId) eventOutreachIds.add(outreachId);
  }

  // 2. Independent [SEED]-prefix scan (covers partial seeds — event never fired).
  const prefixShowIds = idsOrThrow(
    "shows [SEED] prefix scan",
    await supabaseAdmin
      .from("shows")
      .select("id")
      .like("name", `${SEED_NAME_PREFIX}%`)
  );
  const prefixCampaignIds = idsOrThrow(
    "campaigns [SEED] prefix scan",
    await supabaseAdmin
      .from("campaigns")
      .select("id")
      .like("name", `${SEED_NAME_PREFIX}%`)
  );

  // 3. Union events + prefix scan.
  const seededShowIds = [...new Set([...eventShowIds, ...prefixShowIds])];
  const seededCampaignIds = [
    ...new Set([...eventCampaignIds, ...prefixCampaignIds]),
  ];

  // 4. Widened outreach discovery: event outreach ids UNION any outreach linked
  //    to a seeded campaign or show (marker-scoped). This is what makes an
  //    eventless partial seed's deal cascade away via the outreach delete below.
  const outreachIdSet = new Set<string>(eventOutreachIds);
  if (seededCampaignIds.length) {
    for (const id of idsOrThrow(
      "outreaches by seeded campaign",
      await supabaseAdmin
        .from("outreaches")
        .select("id")
        .in("campaign_id", seededCampaignIds)
    )) {
      outreachIdSet.add(id);
    }
  }
  if (seededShowIds.length) {
    for (const id of idsOrThrow(
      "outreaches by seeded show",
      await supabaseAdmin
        .from("outreaches")
        .select("id")
        .in("show_id", seededShowIds)
    )) {
      outreachIdSet.add(id);
    }
  }
  const seededOutreachIds = [...outreachIdSet];

  // Nothing matched any marker → clean no-op.
  if (
    !seededShowIds.length &&
    !seededCampaignIds.length &&
    !seededOutreachIds.length
  ) {
    return NextResponse.json({ deleted: {} });
  }

  // --- Pre-count cascaded children (deals + IOs) for honest reporting. The
  //     parent delete cascades them but does not return them, so gather ids
  //     up front. Sourced from the DB (not event payloads), so stale events
  //     never inflate the reported count. Every seeded deal references its
  //     seeded show (deals.show_id NOT NULL), so the show_id scan is complete.
  const dealIdSet = new Set<string>();
  const dealFilterCols: Array<[string, string[]]> = [
    ["outreach_id", seededOutreachIds],
    ["show_id", seededShowIds],
    ["campaign_id", seededCampaignIds],
  ];
  for (const [col, ids] of dealFilterCols) {
    if (!ids.length) continue;
    for (const id of idsOrThrow(
      `deals by ${col}`,
      await supabaseAdmin.from("deals").select("id").in(col, ids)
    )) {
      dealIdSet.add(id);
    }
  }
  const expectedDealIds = [...dealIdSet];

  let expectedIoIds: string[] = [];
  if (expectedDealIds.length) {
    expectedIoIds = idsOrThrow(
      "insertion_orders by seeded deal",
      await supabaseAdmin
        .from("insertion_orders")
        .select("id")
        .in("deal_id", expectedDealIds)
    );
  }

  // io_line_items cascade from insertion_orders (ON DELETE CASCADE). Pre-count
  // for both the RESTRICT guard below and the deleted-count report.
  let expectedIoLineItemIds: string[] = [];
  if (expectedIoIds.length) {
    expectedIoLineItemIds = idsOrThrow(
      "io_line_items by seeded IO",
      await supabaseAdmin
        .from("io_line_items")
        .select("id")
        .in("io_id", expectedIoIds)
    );
  }

  // --- RESTRICT-descendant guard -------------------------------------------
  // The cascade removes the whole deal → insertion_orders → io_line_items
  // subtree. Any row referencing a node in that subtree via a NON-cascading FK
  // would FK-fail the outreach delete with an opaque error. Enumerate every
  // known RESTRICT referencer, detect them up front, and REPORT the actual
  // blocking rows + their parents before any destructive delete — this test
  // tool never deletes financial/invoice records. Planning-only seeds have none
  // (no IO, no line items), so this is a no-op for them. (payouts.payment_id and
  // deal_setup_intents.payment_id are RESTRICT too, but they hang below payments,
  // so surfacing a payment blocker already covers them.)
  const restrictChecks: Array<{
    table: string;
    fk: string;
    parentIds: string[];
  }> = [
    { table: "payments", fk: "deal_id", parentIds: expectedDealIds },
    { table: "invoices", fk: "io_id", parentIds: expectedIoIds },
    { table: "payments", fk: "io_line_item_id", parentIds: expectedIoLineItemIds },
    {
      table: "invoice_line_items",
      fk: "io_line_item_id",
      parentIds: expectedIoLineItemIds,
    },
  ];

  const blockers: Array<{
    table: string;
    parentColumn: string;
    ids: string[];
    blockedParentIds: string[];
  }> = [];
  for (const chk of restrictChecks) {
    if (!chk.parentIds.length) continue;
    // chk.table / chk.fk are hardcoded above — never client input. Select "*"
    // (a literal — a dynamic `id, ${fk}` string trips supabase-js's compile-time
    // query parser); we only read `id` and the fk column off each blocking row.
    const res = await supabaseAdmin
      .from(chk.table)
      .select("*")
      .in(chk.fk, chk.parentIds);
    if (res.error) {
      throw new SeedTeardownQueryError(
        `${chk.table} by ${chk.fk}: ${res.error.message}`
      );
    }
    const rows = (res.data ?? []) as Array<Record<string, string>>;
    if (rows.length) {
      blockers.push({
        table: chk.table,
        parentColumn: chk.fk,
        ids: rows.map((r) => r.id),
        blockedParentIds: [...new Set(rows.map((r) => r[chk.fk]))],
      });
    }
  }

  if (blockers.length) {
    return NextResponse.json(
      {
        error:
          "Teardown aborted: seeded deals have ON DELETE RESTRICT descendants " +
          "(payments / invoices / invoice_line_items referencing the deal, its " +
          "insertion orders, or their line items) that would FK-fail the " +
          "cascade. Clean those financial/invoice records first — this tool " +
          "does not delete them.",
        blockers,
      },
      { status: 500 }
    );
  }

  // --- Deletion ------------------------------------------------------------

  // 1. Outreaches — cascades their deals + insertion_orders.
  let deletedOutreachIds: string[] = [];
  if (seededOutreachIds.length) {
    const { data, error } = await supabaseAdmin
      .from("outreaches")
      .delete()
      .in("id", seededOutreachIds)
      .select("id");
    if (error) {
      return NextResponse.json(
        { error: `Failed to delete seeded outreaches: ${error.message}` },
        { status: 500 }
      );
    }
    deletedOutreachIds = collectIds(data);
  }

  // 2. Verify deals are actually gone before touching shows (deals.show_id is
  //    RESTRICT). With the widened outreach discovery every seeded deal should
  //    have cascaded; a survivor here is a genuine anomaly — report, don't
  //    swallow, and abort before the show delete FK-fails.
  if (seededShowIds.length) {
    const { data: survivors, error } = await supabaseAdmin
      .from("deals")
      .select("id")
      .in("show_id", seededShowIds);
    if (error) {
      return NextResponse.json(
        { error: `Failed to verify deal teardown: ${error.message}` },
        { status: 500 }
      );
    }
    if (survivors && survivors.length) {
      return NextResponse.json(
        {
          error:
            "Teardown aborted: deals still reference seeded shows after " +
            "outreach deletion (deals.show_id is RESTRICT). Investigate before retry.",
          survivingDeals: collectIds(survivors),
          deleted: {
            outreaches: {
              count: deletedOutreachIds.length,
              ids: deletedOutreachIds,
            },
          },
        },
        { status: 500 }
      );
    }
  }

  // 3. Shows.
  let deletedShowIds: string[] = [];
  if (seededShowIds.length) {
    const { data, error } = await supabaseAdmin
      .from("shows")
      .delete()
      .in("id", seededShowIds)
      .select("id");
    if (error) {
      return NextResponse.json(
        {
          error: `Failed to delete seeded shows: ${error.message}`,
          deleted: {
            outreaches: {
              count: deletedOutreachIds.length,
              ids: deletedOutreachIds,
            },
          },
        },
        { status: 500 }
      );
    }
    deletedShowIds = collectIds(data);
  }

  // 4. Campaigns.
  let deletedCampaignIds: string[] = [];
  if (seededCampaignIds.length) {
    const { data, error } = await supabaseAdmin
      .from("campaigns")
      .delete()
      .in("id", seededCampaignIds)
      .select("id");
    if (error) {
      return NextResponse.json(
        {
          error: `Failed to delete seeded campaigns: ${error.message}`,
          deleted: {
            outreaches: {
              count: deletedOutreachIds.length,
              ids: deletedOutreachIds,
            },
            shows: { count: deletedShowIds.length, ids: deletedShowIds },
          },
        },
        { status: 500 }
      );
    }
    deletedCampaignIds = collectIds(data);
  }

  // Discovered ids can be stale (events referencing already-removed rows). If
  // nothing was actually deleted, treat it as the clean no-op and skip the event.
  if (
    !deletedOutreachIds.length &&
    !deletedShowIds.length &&
    !deletedCampaignIds.length
  ) {
    return NextResponse.json({ deleted: {} });
  }

  const deleted = {
    outreaches: { count: deletedOutreachIds.length, ids: deletedOutreachIds },
    deals: { count: expectedDealIds.length, ids: expectedDealIds },
    insertion_orders: { count: expectedIoIds.length, ids: expectedIoIds },
    io_line_items: {
      count: expectedIoLineItemIds.length,
      ids: expectedIoLineItemIds,
    },
    shows: { count: deletedShowIds.length, ids: deletedShowIds },
    campaigns: { count: deletedCampaignIds.length, ids: deletedCampaignIds },
  };

  // Marker event for the teardown itself (fail-soft; never throws). Hangs off
  // the admin profile, mirroring admin.impersonate.
  await logEvent({
    eventType: "admin.seed_teardown",
    entityType: "profile",
    entityId: adminId,
    actorId: adminId,
    payload: {
      seed_teardown: true,
      outreachIds: deletedOutreachIds,
      dealIds: expectedDealIds,
      insertionOrderIds: expectedIoIds,
      ioLineItemIds: expectedIoLineItemIds,
      showIds: deletedShowIds,
      campaignIds: deletedCampaignIds,
    },
  });

  return NextResponse.json({ deleted });
}
