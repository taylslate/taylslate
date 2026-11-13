// GET /api/campaigns/[id]/show-search?q=
// Brand or agency name search over the catalog and Podscan.
// The body is a fixed public shape. Contact, rates, and descriptions stay off it.

import { NextRequest, NextResponse } from "next/server";
import {
  DIRECT_SEARCH_MAX,
  DIRECT_SEARCH_MIN,
  QUERY_INVALID,
  SEARCH_FAILED,
  loadOwnedCampaign,
  searchShowsByName,
  type DirectSearchHit,
} from "@/lib/discovery/direct-search";
import { enforceRules } from "@/lib/security/rate-limit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MINUTE_SECONDS = 60;
const DAY_SECONDS = 24 * 60 * 60;

function json(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function withNoStore(response: NextResponse): NextResponse {
  response.headers.set("Cache-Control", "no-store");
  return response;
}

function inPlan(hit: DirectSearchHit, selected: ReadonlySet<string>): boolean {
  if (!hit.key.startsWith("show:")) return false;
  return selected.has(hit.key.slice("show:".length).toLowerCase());
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const access = await loadOwnedCampaign(id);
  if (!access.ok) return json({ error: access.error }, access.status);

  const raw = request.nextUrl.searchParams.get("q");
  const trimmed = raw?.trim() ?? "";
  if (
    raw == null ||
    trimmed.length < DIRECT_SEARCH_MIN ||
    trimmed.length > DIRECT_SEARCH_MAX
  ) {
    return json({ error: QUERY_INVALID }, 400);
  }

  const limited = await enforceRules({
    failureMode: "closed",
    rules: [
      {
        bucket: "disc_search_user_min",
        key: access.userId,
        max: 20,
        windowSeconds: MINUTE_SECONDS,
      },
      {
        bucket: "disc_search_user_day",
        key: access.userId,
        max: 300,
        windowSeconds: DAY_SECONDS,
      },
    ],
  });
  if (limited) return withNoStore(limited);

  try {
    const found = await searchShowsByName(access.userId, raw);
    const selected = new Set(
      (access.campaign.selected_show_ids ?? []).map((showId) => showId.toLowerCase())
    );
    return json({
      results: found.results.map((hit) => ({
        key: hit.key,
        name: hit.name,
        platform: hit.platform,
        audienceSize: hit.audienceSize,
        categories: hit.categories,
        imageUrl: hit.imageUrl,
        origin: hit.origin,
        inPlan: inPlan(hit, selected),
      })),
      podscanAvailable: found.podscanAvailable,
    });
  } catch {
    return json({ error: SEARCH_FAILED }, 500);
  }
}
