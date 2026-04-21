import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser, updateCampaignMediaPlan } from "@/lib/data/queries";
import type { MediaPlan, MediaPlanLineItem, Placement, PlanSpacing } from "@/lib/data/types";

const ALLOWED_PLACEMENTS: Placement[] = ["pre-roll", "mid-roll", "post-roll"];
const ALLOWED_SPACINGS: PlanSpacing[] = ["weekly", "biweekly", "monthly"];

export async function PUT(request: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { campaign_id: string; media_plan: Partial<MediaPlan> };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.campaign_id) {
    return NextResponse.json({ error: "campaign_id required" }, { status: 400 });
  }

  const plan = body.media_plan;
  if (!plan) {
    return NextResponse.json({ error: "media_plan required" }, { status: 400 });
  }

  const defaultPlacement = ALLOWED_PLACEMENTS.includes(plan.default_placement as Placement)
    ? (plan.default_placement as Placement)
    : "mid-roll";
  const defaultEpisodes = Math.max(1, Math.min(6, Math.round(Number(plan.default_episodes) || 3)));
  const spacing = ALLOWED_SPACINGS.includes(plan.spacing as PlanSpacing)
    ? (plan.spacing as PlanSpacing)
    : "weekly";

  const lineItems: MediaPlanLineItem[] = Array.isArray(plan.line_items)
    ? plan.line_items
        .filter((li): li is MediaPlanLineItem => typeof li?.podcast_id === "string")
        .map((li) => ({
          podcast_id: li.podcast_id,
          placement: ALLOWED_PLACEMENTS.includes(li.placement) ? li.placement : defaultPlacement,
          num_episodes: Math.max(1, Math.min(6, Math.round(Number(li.num_episodes) || defaultEpisodes))),
        }))
    : [];

  const sanitized: MediaPlan = {
    default_placement: defaultPlacement,
    default_episodes: defaultEpisodes,
    spacing,
    line_items: lineItems,
    updated_at: new Date().toISOString(),
  };

  const success = await updateCampaignMediaPlan(
    body.campaign_id,
    sanitized as unknown as Record<string, unknown>
  );
  if (!success) {
    return NextResponse.json({ error: "Failed to save plan" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, media_plan: sanitized });
}
