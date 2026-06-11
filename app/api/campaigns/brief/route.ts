// Wave 14 Phase 2A Layer 3 — brief intake endpoint.
//
// POST { stage: 'draft' } → creates a minimal draft campaign row and
// returns { campaign_id }. The intake form needs a campaign id before the
// brand finishes the form because the derive-product endpoint (Layer 2) is
// scoped to an existing campaign.
//
// POST { stage: 'submit', ... } → validates the full brief, creates or
// updates the campaign row with the v2 brief shape, fires brief.submitted,
// and returns { campaign_id }. The returning-brand "nothing has changed"
// path submits without ever creating a draft, so submit must also create.
//
// Status stays 'draft' after submit — the Layer 5 confirm step owns the
// transition once the brand confirms the interpretation.

import { NextRequest, NextResponse } from "next/server";
import {
  createCampaign,
  ensureProfile,
  getAuthenticatedUser,
  getCampaignById,
  updateCampaignBrief,
} from "@/lib/data/queries";
import { getCampaignPatternById } from "@/lib/data/reasoning-log";
import { logEvent } from "@/lib/data/events";
import type {
  BriefFlight,
  BriefGoal,
  BriefProduct,
  CampaignBriefV2,
} from "@/lib/data/types";

const MIN_BUDGET = 5000;
const MAX_GOALS = 3;
const VALID_GOALS: BriefGoal[] = [
  "test_channel",
  "scale_winner",
  "direct_response",
  "brand_awareness",
  "lead_gen",
];
const VALID_PRESETS = ["asap", "next_30_days", "next_60_days", "next_quarter"];

interface BriefRequestBody {
  stage?: "draft" | "submit";
  campaign_id?: string;
  product?: BriefProduct;
  customer_text?: string;
  customer_context?: {
    reused_from_pattern_id?: string;
    delta_text?: string;
  };
  goals?: BriefGoal[];
  goals_context?: string;
  budget_total?: number;
  flight?: BriefFlight;
  exclusions_text?: string;
}

export async function POST(request: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: BriefRequestBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (body.stage !== "draft" && body.stage !== "submit") {
    return NextResponse.json(
      { error: "stage must be 'draft' or 'submit'" },
      { status: 400 }
    );
  }

  // campaigns.user_id references profiles(id); make sure the row exists.
  await ensureProfile(user);

  // Ownership check when updating an existing row.
  if (body.campaign_id) {
    const existing = await getCampaignById(body.campaign_id);
    if (!existing || existing.user_id !== user.id) {
      return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
    }
  }

  if (body.stage === "draft") {
    if (body.campaign_id) {
      // Draft already exists — nothing to do.
      return NextResponse.json({ campaign_id: body.campaign_id });
    }
    const campaign = await createCampaign({
      user_id: user.id,
      name: "Untitled campaign",
      brief: { version: 2 } satisfies CampaignBriefV2 as unknown as Record<string, unknown>,
      budget_total: 0,
      // 2B's ring-driven discovery owns surface selection; the new intake
      // has no platform picker.
      platforms: ["podcast"],
      status: "draft",
      recommendations: [],
    });
    if (!campaign) {
      return NextResponse.json(
        { error: "Could not create campaign" },
        { status: 500 }
      );
    }
    return NextResponse.json({ campaign_id: campaign.id });
  }

  // ---- stage === 'submit' ----

  const validationError = await validateSubmit(body, user.id);
  if (validationError) {
    return NextResponse.json({ error: validationError }, { status: 400 });
  }

  const brief: CampaignBriefV2 = {
    version: 2,
    product: body.product,
    customer_text: body.customer_text,
    customer_context: body.customer_context,
    goals: body.goals,
    goals_context: body.goals_context,
    flight: body.flight,
    exclusions_text: body.exclusions_text,
    submitted_at: new Date().toISOString(),
  };

  const name = await deriveCampaignName(body);

  let campaignId = body.campaign_id;
  if (campaignId) {
    const updated = await updateCampaignBrief(campaignId, {
      name,
      brief: brief as unknown as Record<string, unknown>,
      budget_total: body.budget_total,
    });
    if (!updated) {
      return NextResponse.json(
        { error: "Could not save brief" },
        { status: 500 }
      );
    }
  } else {
    const campaign = await createCampaign({
      user_id: user.id,
      name,
      brief: brief as unknown as Record<string, unknown>,
      budget_total: body.budget_total as number,
      platforms: ["podcast"],
      status: "draft",
      recommendations: [],
    });
    if (!campaign) {
      return NextResponse.json(
        { error: "Could not create campaign" },
        { status: 500 }
      );
    }
    campaignId = campaign.id;
  }

  await logEvent({
    eventType: "brief.submitted",
    entityType: "campaign",
    entityId: campaignId,
    actorId: user.id,
    payload: {
      reused_from_pattern_id:
        body.customer_context?.reused_from_pattern_id ?? null,
      goals: body.goals ?? [],
      budget_total: body.budget_total ?? null,
    },
  });

  return NextResponse.json({ campaign_id: campaignId });
}

/** Returns an error string, or null if the submit body is valid. */
async function validateSubmit(
  body: BriefRequestBody,
  userId: string
): Promise<string | null> {
  const reusedPatternId = body.customer_context?.reused_from_pattern_id;

  if (reusedPatternId) {
    // The pattern being reused must belong to this brand — it feeds the
    // Layer 4 interpretation prompt.
    const pattern = await getCampaignPatternById(reusedPatternId);
    if (!pattern || pattern.customer_id !== userId) {
      return "Reused campaign pattern not found";
    }
  } else {
    // Fresh brief: product and customer truth are required.
    if (!body.product || !body.product.brand_name?.trim()) {
      return "Product details are required";
    }
    if (!body.customer_text?.trim()) {
      return "Tell us about your customer";
    }
  }

  if (
    !Array.isArray(body.goals) ||
    body.goals.length < 1 ||
    body.goals.length > MAX_GOALS ||
    body.goals.some((g) => !VALID_GOALS.includes(g))
  ) {
    return `Pick 1-${MAX_GOALS} campaign goals`;
  }

  if (typeof body.budget_total !== "number" || body.budget_total < MIN_BUDGET) {
    return `Budget must be at least $${MIN_BUDGET.toLocaleString()}`;
  }

  const flight = body.flight;
  if (!flight) {
    return "Pick a flight window";
  }
  if (flight.mode === "preset") {
    if (!flight.preset || !VALID_PRESETS.includes(flight.preset)) {
      return "Pick a flight window preset";
    }
  } else if (flight.mode === "dates") {
    if (!flight.start_date || !flight.end_date) {
      return "Pick flight start and end dates";
    }
  } else {
    return "Invalid flight window";
  }

  return null;
}

/** "{Brand} — June 2026". Reuse path pulls the brand from the pattern row. */
async function deriveCampaignName(body: BriefRequestBody): Promise<string> {
  let brandName = body.product?.brand_name?.trim();
  const reusedPatternId = body.customer_context?.reused_from_pattern_id;
  if (!brandName && reusedPatternId) {
    const pattern = await getCampaignPatternById(reusedPatternId);
    const fromPattern = pattern?.product_attributes?.brand_name;
    if (typeof fromPattern === "string" && fromPattern.trim()) {
      brandName = fromPattern.trim();
    }
  }
  const monthYear = new Date().toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });
  return `${brandName || "Campaign"} — ${monthYear}`;
}
