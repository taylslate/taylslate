// Wave 14 Phase 2C Layer 4 — media-plan handoff adapter.
//
// POST { showIds } → take the brand's selected TEST-tier shows and write them
// into the path the legacy Wave 7 plan page reads (campaigns.scored_shows +
// selected_show_ids), so the existing media-plan builder consumes them without
// a v2-specific fork. The view navigates to /campaigns/[id]/plan on success.
//
// Server-authoritative: only ids that are actually in the campaign's test tier
// are honored. A scale/bench/unknown id is silently dropped — the brand cannot
// smuggle a deferred or un-pricable show into the plan through a crafted body.

import { NextRequest, NextResponse } from "next/server";
import {
  getAuthenticatedUser,
  getCampaignById,
  updateCampaignPlanHandoff,
} from "@/lib/data/queries";
import { getLatestCampaignPatternForCampaign } from "@/lib/data/reasoning-log";
import { getTieredUniverse } from "@/lib/discovery/tiered-universe";
import { tieredShowToScoredShowRecord } from "@/lib/discovery/scored-show-adapter";
import { logEvent } from "@/lib/data/events";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/** Loosely read the client's active discovery filters for the selection-signal
 *  event. Best-effort — a malformed value degrades to null, never throws. */
function readFilters(
  v: unknown
): { ring: string | null; band: string | null; sort: string | null } | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const str = (x: unknown) => (typeof x === "string" ? x : null);
  return { ring: str(o.ring), band: str(o.band), sort: str(o.sort) };
}

export async function POST(request: NextRequest, context: RouteContext) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await context.params;
  const campaign = await getCampaignById(id);
  if (!campaign || campaign.user_id !== user.id) {
    return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
  }

  let body: { showIds?: unknown; shownShowIds?: unknown; filters?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const requested = Array.isArray(body.showIds)
    ? body.showIds.filter((s): s is string => typeof s === "string")
    : [];
  if (requested.length === 0) {
    return NextResponse.json(
      { error: "Select at least one test show first." },
      { status: 400 }
    );
  }

  const pattern = await getLatestCampaignPatternForCampaign(id);
  if (!pattern) {
    return NextResponse.json(
      { error: "Confirm an interpretation and run discovery first." },
      { status: 409 }
    );
  }

  // Re-read the tiered universe server-side. Eligible = test ∪ scale: both are
  // directly cart-selectable (a scale show is over the 25% test guideline but
  // still selectable — the ceiling is a warning, not an exclusion). Bench /
  // needs-quote shows are NEVER eligible — they carry no usable cost, so they're
  // excluded by construction (they're in neither partition). This is the
  // server-authoritative guard: a crafted body cannot push an un-pricable show
  // into the media plan.
  const tiered = await getTieredUniverse(pattern.id);
  const requestedSet = new Set(requested);
  const selected = [...tiered.test, ...tiered.scale].filter((t) =>
    requestedSet.has(t.showId)
  );

  const scoredShows = selected
    .map(tieredShowToScoredShowRecord)
    .filter((r): r is NonNullable<typeof r> => r != null);

  if (scoredShows.length === 0) {
    return NextResponse.json(
      { error: "None of the selected shows are in the test portfolio." },
      { status: 400 }
    );
  }

  const selectedIds = scoredShows.map((s) => s.podcastId);

  // Atomic write: scored_shows + selected_show_ids both live on the campaigns
  // row, so a single UPDATE either lands both or neither — a partial failure
  // can't leave a selection pointing at shows that were never written.
  const wrote = await updateCampaignPlanHandoff(
    id,
    scoredShows,
    { source: "tiered_handoff", pattern_id: pattern.id, count: scoredShows.length },
    selectedIds
  );
  if (!wrote) {
    return NextResponse.json(
      { error: "Couldn't hand off to the media plan. Try again." },
      { status: 500 }
    );
  }

  // Selection signal (append-only, one snapshot per discovery session). Captures
  // what the brand was shown, what they selected, the filters they had active,
  // and the estimated prices at selection time — preserving optionality for
  // later intelligence without any new tables/aggregation. Prices are snapshot
  // SERVER-side from the tiered universe (not trusted from the client). logEvent
  // is fail-soft, so a failure here never blocks the successful handoff.
  const allShown = [...tiered.test, ...tiered.scale, ...tiered.bench];
  const shownShowIds = Array.isArray(body.shownShowIds)
    ? body.shownShowIds.filter((s): s is string => typeof s === "string")
    : allShown.map((t) => t.showId);
  const estimatedPrices = allShown.map((t) => ({
    show_id: t.showId,
    tier: t.tier,
    per_spot_cents: t.perSpotCents,
    three_spot_cents: t.threeSpotCents,
    cpm_used_cents: t.cpmUsedCents,
    cost_basis: t.costBasis,
    is_estimate: t.isEstimate,
    needs_quote: t.needsQuote,
  }));
  await logEvent({
    eventType: "discovery.selection_captured",
    entityType: "campaign",
    entityId: id,
    actorId: user.id,
    payload: {
      campaign_pattern_id: pattern.id,
      shown_show_ids: shownShowIds,
      shown_count: shownShowIds.length,
      selected_show_ids: selectedIds,
      selected_count: selectedIds.length,
      filters_applied: readFilters(body.filters),
      estimated_prices: estimatedPrices,
    },
  });

  return NextResponse.json({ ok: true, count: scoredShows.length });
}
