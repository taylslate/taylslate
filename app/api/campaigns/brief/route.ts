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
  getRecentUnsubmittedDraft,
  updateCampaignBrief,
} from "@/lib/data/queries";
import { getCampaignPatternById } from "@/lib/data/reasoning-log";
import { logEvent } from "@/lib/data/events";
import { validateFlightDates } from "@/lib/validation/flight-dates";
import type {
  BriefChangedField,
  BriefChangedFieldKey,
  BriefFlight,
  BriefGoal,
  BriefProduct,
  CampaignBriefV2,
  ProductDerivation,
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
    product_url?: string | null;
    changed_fields?: Partial<Record<BriefChangedFieldKey, BriefChangedField>>;
    /** Brand-confirmed re-derivation when the product URL changed. */
    product_attributes?: ProductDerivation;
  };
  goals?: BriefGoal[];
  goals_context?: string;
  budget_total?: number;
  flight?: BriefFlight;
  exclusions_text?: string;
}

/** Structured validation error: message for humans, code/field for clients. */
interface ValidationError {
  message: string;
  code?: string;
  field?: string;
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
  try {
    await ensureProfile(user);
  } catch (err) {
    console.error("[campaigns/brief] ensureProfile failed:", err);
    return NextResponse.json(
      { error: "Failed to initialize user profile" },
      { status: 500 }
    );
  }

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
    // Idempotency: a recent unsubmitted draft (double-fired blur, page
    // reload mid-intake) is reused instead of orphaning a new row.
    const recentDraft = await getRecentUnsubmittedDraft(user.id);
    if (recentDraft) {
      return NextResponse.json({ campaign_id: recentDraft.id });
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
    return NextResponse.json(
      {
        error: validationError.message,
        ...(validationError.code ? { code: validationError.code } : {}),
        ...(validationError.field ? { field: validationError.field } : {}),
      },
      { status: 400 }
    );
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
      changed_fields: Object.keys(body.customer_context?.changed_fields ?? {}),
      goals: body.goals ?? [],
      budget_total: body.budget_total ?? null,
    },
  });

  return NextResponse.json({ campaign_id: campaignId });
}

const CHANGED_FIELD_KEYS: BriefChangedFieldKey[] = [
  "product_url",
  "customer_description",
  "exclusions",
];

/** Shape check for a brand-confirmed product re-derivation. */
function isValidProductAttributes(value: unknown): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const v = value as Record<string, unknown>;
  return (
    typeof v.brand_name === "string" &&
    v.brand_name.trim().length > 0 &&
    typeof v.category === "string" &&
    v.category.trim().length > 0 &&
    (v.aov_bucket === "low" || v.aov_bucket === "mid" || v.aov_bucket === "high") &&
    (v.key_attributes === undefined ||
      (Array.isArray(v.key_attributes) &&
        v.key_attributes.every((a) => typeof a === "string")))
  );
}

/** Shape check for the check-in's field-level changes record. */
function isValidChangedFields(value: unknown): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  return Object.entries(value).every(([key, entry]) => {
    if (!CHANGED_FIELD_KEYS.includes(key as BriefChangedFieldKey)) return false;
    if (typeof entry !== "object" || entry === null) return false;
    const { before, after } = entry as Record<string, unknown>;
    const ok = (v: unknown) => typeof v === "string" || v === null;
    return ok(before) && ok(after);
  });
}

/** Returns a structured error, or null if the submit body is valid. */
async function validateSubmit(
  body: BriefRequestBody,
  userId: string
): Promise<ValidationError | null> {
  const reusedPatternId = body.customer_context?.reused_from_pattern_id;

  if (reusedPatternId) {
    // The pattern being reused must belong to this brand — it feeds the
    // Layer 4 interpretation prompt.
    const pattern = await getCampaignPatternById(reusedPatternId);
    if (!pattern || pattern.customer_id !== userId) {
      return { message: "Reused campaign pattern not found" };
    }
    const changedFields = body.customer_context?.changed_fields;
    if (changedFields !== undefined && !isValidChangedFields(changedFields)) {
      return {
        message: "Invalid changed fields record",
        code: "invalid_changed_fields",
        field: "customer_context",
      };
    }
    // Re-derivation from a changed product URL. Layer 4 treats this as
    // canonical over the prior pattern, so it must arrive well-formed.
    const productAttributes = body.customer_context?.product_attributes;
    if (
      productAttributes !== undefined &&
      !isValidProductAttributes(productAttributes)
    ) {
      return {
        message: "Invalid product attributes",
        code: "invalid_product_attributes",
        field: "customer_context",
      };
    }
  } else {
    // Fresh brief: product and customer truth are required.
    if (!body.product || !body.product.brand_name?.trim()) {
      return { message: "Product details are required" };
    }
    if (!body.customer_text?.trim()) {
      return { message: "Tell us about your customer" };
    }
  }

  if (
    !Array.isArray(body.goals) ||
    body.goals.length < 1 ||
    body.goals.length > MAX_GOALS ||
    body.goals.some((g) => !VALID_GOALS.includes(g))
  ) {
    return { message: `Pick 1-${MAX_GOALS} campaign goals` };
  }

  if (typeof body.budget_total !== "number" || body.budget_total < MIN_BUDGET) {
    return { message: `Budget must be at least $${MIN_BUDGET.toLocaleString()}` };
  }

  const flight = body.flight;
  if (!flight) {
    return { message: "Pick a flight window" };
  }
  if (flight.mode === "preset") {
    if (!flight.preset || !VALID_PRESETS.includes(flight.preset)) {
      return { message: "Pick a flight window preset" };
    }
  } else if (flight.mode === "dates") {
    if (!flight.start_date || !flight.end_date) {
      return { message: "Pick flight start and end dates" };
    }
    const dateError = validateFlightDates(flight.start_date, flight.end_date);
    if (dateError) {
      return { message: dateError.message, code: dateError.code, field: "flight" };
    }
  } else {
    return { message: "Invalid flight window" };
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
