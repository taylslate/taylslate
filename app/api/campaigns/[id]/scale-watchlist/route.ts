// Wave 14 Phase 2C Layer 4 — scale-tier watchlist curation.
//
// POST { showId, action } → curate the brand's scale tier. save/dismiss write
// the brand_saved / brand_dismissed flags on conviction_scores (per-(pattern,
// show)); promote writes no flag (the cart selection is persisted separately
// via /api/campaigns/selections) and only logs the intent. Every action emits a
// fail-soft domain event so the pattern library captures what the brand wanted.
//
// The view passes campaignId; the latest campaign pattern is resolved here.

import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser, getCampaignById } from "@/lib/data/queries";
import {
  getLatestCampaignPatternForCampaign,
  updateScaleShowCuration,
} from "@/lib/data/reasoning-log";
import { getTieredUniverse } from "@/lib/discovery/tiered-universe";
import { logEvent } from "@/lib/data/events";

type WatchlistAction = "save" | "unsave" | "dismiss" | "restore" | "promote";

const ACTIONS: ReadonlySet<WatchlistAction> = new Set([
  "save",
  "unsave",
  "dismiss",
  "restore",
  "promote",
]);

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

  let body: { showId?: unknown; action?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const showId = typeof body.showId === "string" ? body.showId : "";
  const action = body.action as WatchlistAction;
  if (!showId || !ACTIONS.has(action)) {
    return NextResponse.json(
      { error: "showId and a valid action are required." },
      { status: 400 }
    );
  }

  const pattern = await getLatestCampaignPatternForCampaign(id);
  if (!pattern) {
    return NextResponse.json(
      { error: "No discovery pattern for this campaign." },
      { status: 409 }
    );
  }

  // Tier-membership gate: every action here (save/unsave/dismiss/restore/promote)
  // operates on a SCALE-tier show, so validate the show is actually in this
  // campaign's scale tier before writing a flag or logging intent. Use the same
  // confirmed-ring-filtered, rolled-up universe the UI renders (getTieredUniverse)
  // so a bench/test/unknown show — or a rejected-ring leak — can't be curated.
  // getTieredUniverse is fail-soft (empty universe on read error), so this fails
  // CLOSED: a transient read rejects the action rather than writing blind. Low
  // harm — the brand can only act on their own campaign.
  const tiered = await getTieredUniverse(pattern.id);
  if (!tiered.scale.some((s) => s.showId === showId)) {
    return NextResponse.json(
      { error: "That show isn't in this campaign's scale tier." },
      { status: 400 }
    );
  }

  // Write the watchlist flag (save/dismiss and their inverses). promote writes
  // no flag — it's a cart action persisted via the selections endpoint.
  let persisted = true;
  if (action === "save") {
    // Saving a show un-dismisses it (the two states are mutually exclusive).
    persisted = await updateScaleShowCuration({
      campaignPatternId: pattern.id,
      showId,
      brandSaved: true,
      brandDismissed: false,
    });
  } else if (action === "unsave") {
    persisted = await updateScaleShowCuration({
      campaignPatternId: pattern.id,
      showId,
      brandSaved: false,
    });
  } else if (action === "dismiss") {
    persisted = await updateScaleShowCuration({
      campaignPatternId: pattern.id,
      showId,
      brandDismissed: true,
      brandSaved: false,
    });
  } else if (action === "restore") {
    persisted = await updateScaleShowCuration({
      campaignPatternId: pattern.id,
      showId,
      brandDismissed: false,
    });
  }

  // Fail-soft domain event (never blocks the response). save/unsave →
  // scale_show.saved; dismiss/restore → scale_show.dismissed; promote →
  // scale_show.promoted_to_test. The payload carries the resulting boolean.
  const eventType =
    action === "promote"
      ? "scale_show.promoted_to_test"
      : action === "save" || action === "unsave"
        ? "scale_show.saved"
        : "scale_show.dismissed";
  await logEvent({
    eventType,
    entityType: "campaign",
    entityId: id,
    payload: {
      campaignPatternId: pattern.id,
      showId,
      action,
      saved: action === "save",
      dismissed: action === "dismiss",
    },
  });

  if (!persisted) {
    return NextResponse.json(
      { error: "Couldn't update the watchlist. Try again." },
      { status: 500 }
    );
  }
  return NextResponse.json({ ok: true });
}
