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
  updateCampaignScoredShows,
  updateCampaignSelections,
} from "@/lib/data/queries";
import { getLatestCampaignPatternForCampaign } from "@/lib/data/reasoning-log";
import { getTieredUniverse } from "@/lib/discovery/tiered-universe";
import { tieredShowToScoredShowRecord } from "@/lib/discovery/scored-show-adapter";

interface RouteContext {
  params: Promise<{ id: string }>;
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

  let body: { showIds?: unknown };
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

  // Re-read the tiered universe server-side. Eligible = test ∪ scale: test
  // shows are the default cart, and the brand can explicitly promote a scale
  // show ("Move to test"). Bench / needs-quote shows are NEVER eligible — they
  // carry no usable cost, so they're excluded by construction (they're in
  // neither partition). This is the server-authoritative guard: a crafted body
  // cannot push an un-pricable show into the media plan.
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

  const wroteShows = await updateCampaignScoredShows(id, scoredShows, {
    source: "tiered_handoff",
    pattern_id: pattern.id,
    count: scoredShows.length,
  });
  const wroteSelections = await updateCampaignSelections(id, selectedIds);
  if (!wroteShows || !wroteSelections) {
    return NextResponse.json(
      { error: "Couldn't hand off to the media plan. Try again." },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true, count: scoredShows.length });
}
