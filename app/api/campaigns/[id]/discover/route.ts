// Wave 14 Phase 2B Layer 3 — conviction discovery trigger.
//
// POST → run discovery + three-dimensional conviction scoring against the
// campaign's confirmed rings, persist the scored universe to conviction_scores,
// and return a summary. This is the data-layer entry point the discovery view
// (Layer 5) calls after the brand confirms the interpretation; it builds no UI
// and generates no reasoning prose (Layer 4).
//
// Re-POST is safe: runConvictionDiscovery replaces prior scores for the pattern
// before writing. Persistence is fail-soft inside the orchestrator, so a
// partial-write run still returns 200 with whatever scored — the errors array
// surfaces any soft failures. Missing pattern / no confirmed rings is a 400
// (the brand must interpret + confirm first), not a crash.

import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser, getCampaignById } from "@/lib/data/queries";
import { runConvictionDiscovery } from "@/lib/discovery/conviction-discovery";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(_request: NextRequest, context: RouteContext) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await context.params;
  const campaign = await getCampaignById(id);
  if (!campaign || campaign.user_id !== user.id) {
    return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
  }

  let result;
  try {
    result = await runConvictionDiscovery(id);
  } catch (err) {
    // Defense-in-depth: the orchestrator is fail-soft internally, but never let
    // an unexpected throw become an unhandled rejection — return a clean 500.
    console.error(
      "[campaigns/discover] runConvictionDiscovery threw:",
      err instanceof Error ? err.message : err
    );
    return NextResponse.json(
      { error: "Discovery failed", code: "discovery_failed" },
      { status: 500 }
    );
  }

  // No pattern / no confirmed rings → nothing scored and a guard error: the
  // brand hasn't interpreted/confirmed yet. Surface as a 400.
  if (!result.campaignPatternId || result.rings.length === 0) {
    return NextResponse.json(
      {
        error:
          result.errors[0] ??
          "Interpret and confirm the brief before running discovery.",
        code: "not_ready",
      },
      { status: 400 }
    );
  }

  return NextResponse.json({
    ok: true,
    campaign_pattern_id: result.campaignPatternId,
    ring_count: result.rings.length,
    candidate_count: result.candidateCount,
    kept_show_count: result.keptShowCount,
    scored_count: result.scoredCount,
    errors: result.errors,
  });
}
