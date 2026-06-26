// Wave 14 Phase 2C Layer 5 — portfolio override endpoint.
//
// POST { kind, ... } → apply ONE override (campaign spot-count, campaign or
// per-show placement, per-show CPM, or reset-to-default), recompute the
// test/scale/dropped split, and return the new counts. Money-adjacent: an
// override reshuffles which shows are buyable now vs deferred, so inputs are
// validated server-side before they touch the recompute.
//
// REQUEST-SCOPED on purpose: the recompute's tier pass loads shows via the admin
// client (it injects getShowsByIdsAdmin), so it's scope-safe; the campaign-level
// persist runs as the authenticated owner (RLS) — ownership is verified here
// first. The view re-reads the server component (router.refresh) on success.

import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser, getCampaignById } from "@/lib/data/queries";
import {
  applyPortfolioOverride,
  type PortfolioOverride,
} from "@/lib/discovery/recompute-portfolio";
import { dollarsToCents, type Placement } from "@/lib/discovery/spot-cost";

interface RouteContext {
  params: Promise<{ id: string }>;
}

const PLACEMENTS: ReadonlySet<Placement> = new Set([
  "preroll",
  "midroll",
  "postroll",
]);

/** A test cadence is realistically 1–N spots; bound it (mirrors migration 029). */
const MAX_SPOT_COUNT = 12;

type Body = Record<string, unknown>;

function bad(error: string) {
  return NextResponse.json({ error }, { status: 400 });
}

/**
 * Translate a validated request body into a PortfolioOverride, or return an error
 * string. Keeps the validation (the money-adjacent gate) in one place.
 */
function parseOverride(body: Body): { override: PortfolioOverride } | { error: string } {
  const kind = body.kind;
  switch (kind) {
    case "campaign_spot_count": {
      const n = body.spotCount;
      if (typeof n !== "number" || !Number.isInteger(n) || n < 1 || n > MAX_SPOT_COUNT) {
        return { error: `spotCount must be an integer between 1 and ${MAX_SPOT_COUNT}.` };
      }
      return { override: { kind, spotCount: n } };
    }
    case "campaign_placement": {
      const p = body.placement;
      if (typeof p !== "string" || !PLACEMENTS.has(p as Placement)) {
        return { error: "placement must be preroll, midroll, or postroll." };
      }
      return { override: { kind, placement: p as Placement } };
    }
    case "show_placement": {
      const showId = typeof body.showId === "string" ? body.showId : "";
      if (!showId) return { error: "showId is required." };
      const p = body.placement;
      // null clears the per-show override (fall back to the campaign default).
      if (p === null) return { override: { kind, showId, placementOverride: null } };
      if (typeof p !== "string" || !PLACEMENTS.has(p as Placement)) {
        return { error: "placement must be preroll, midroll, postroll, or null." };
      }
      return { override: { kind, showId, placementOverride: p as Placement } };
    }
    case "show_cpm": {
      const showId = typeof body.showId === "string" ? body.showId : "";
      if (!showId) return { error: "showId is required." };
      const d = body.cpmDollars;
      // null clears the override (revert to the band-derived CPM).
      if (d === null) return { override: { kind, showId, cpmOverrideCents: null } };
      if (typeof d !== "number" || !Number.isFinite(d) || d <= 0) {
        return { error: "cpmDollars must be a positive number, or null to clear." };
      }
      return { override: { kind, showId, cpmOverrideCents: dollarsToCents(d) } };
    }
    case "reset":
      return { override: { kind: "reset" } };
    default:
      return { error: "Unknown override kind." };
  }
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

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return bad("Invalid JSON");
  }

  const parsed = parseOverride(body);
  if ("error" in parsed) return bad(parsed.error);

  const result = await applyPortfolioOverride(id, parsed.override);
  if (!result.ok) {
    // No discovery pattern yet, or the input persist hard-failed.
    const noPattern = result.campaignPatternId == null;
    return NextResponse.json(
      {
        error: noPattern
          ? "Run discovery before adjusting the portfolio."
          : "Couldn't apply that change. Try again.",
      },
      { status: noPattern ? 409 : 500 }
    );
  }

  return NextResponse.json({
    ok: true,
    test_count: result.tier?.testCount ?? null,
    scale_count: result.tier?.scaleCount ?? null,
    dropped_count: result.tier?.droppedCount ?? null,
    test_underfilled: result.tier?.testUnderfilled ?? null,
    // True when some shows' tier cache didn't persist — the view warns rather
    // than silently showing a possibly-stale tier (read trusts the cache).
    cache_partial: result.cachePartial,
  });
}
