import { NextRequest, NextResponse } from "next/server";
import {
  getAuthenticatedUser,
  ensureProfile,
  getBrandProfileByUserId,
  upsertBrandProfile,
} from "@/lib/data/queries";
import type { BrandCampaignGoal, BrandProfile, BrandTargetGender } from "@/lib/data/types";

const ALLOWED_GENDERS: BrandTargetGender[] = [
  "mostly_men",
  "mostly_women",
  "mixed",
  "no_preference",
];
const ALLOWED_GOALS: BrandCampaignGoal[] = [
  "direct_sales",
  "brand_awareness",
  "new_product",
  "test_podcast",
];

/** Whitelist and sanitize the PATCH body so only known fields ever hit the DB. */
export function sanitizeBrandProfilePatch(
  body: Record<string, unknown>
): Partial<Omit<BrandProfile, "id" | "user_id" | "created_at" | "updated_at" | "onboarded_at">> {
  const patch: Partial<BrandProfile> = {};

  if (typeof body.brand_identity === "string") patch.brand_identity = body.brand_identity.trim() || null;
  if (typeof body.brand_website === "string") patch.brand_website = body.brand_website.trim() || null;
  if (typeof body.target_customer === "string") patch.target_customer = body.target_customer.trim() || null;
  if (typeof body.exclusions === "string") patch.exclusions = body.exclusions.trim() || null;

  if (typeof body.target_age_min === "number" && Number.isFinite(body.target_age_min)) {
    patch.target_age_min = Math.max(13, Math.min(120, Math.round(body.target_age_min)));
  }
  if (typeof body.target_age_max === "number" && Number.isFinite(body.target_age_max)) {
    patch.target_age_max = Math.max(13, Math.min(120, Math.round(body.target_age_max)));
  }

  if (typeof body.target_gender === "string" && ALLOWED_GENDERS.includes(body.target_gender as BrandTargetGender)) {
    patch.target_gender = body.target_gender as BrandTargetGender;
  }

  if (typeof body.campaign_goal === "string" && ALLOWED_GOALS.includes(body.campaign_goal as BrandCampaignGoal)) {
    patch.campaign_goal = body.campaign_goal as BrandCampaignGoal;
  }

  if (Array.isArray(body.content_categories)) {
    patch.content_categories = body.content_categories
      .filter((c): c is string => typeof c === "string" && c.trim().length > 0)
      .slice(0, 10);
  }

  return patch;
}

export async function GET() {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    await ensureProfile({ id: user.id, email: user.email ?? undefined });
  } catch (err) {
    console.error("[brand-profile/GET] ensureProfile failed:", err);
    return NextResponse.json({ error: "Failed to initialize profile" }, { status: 500 });
  }

  const brandProfile = await getBrandProfileByUserId(user.id);
  return NextResponse.json({ brand_profile: brandProfile });
}

export async function PUT(request: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  try {
    await ensureProfile({ id: user.id, email: user.email ?? undefined });
  } catch (err) {
    console.error("[brand-profile/PUT] ensureProfile failed:", err);
    return NextResponse.json({ error: "Failed to initialize profile" }, { status: 500 });
  }

  const patch = sanitizeBrandProfilePatch(body);
  const result = await upsertBrandProfile(user.id, patch);
  if (!result) {
    return NextResponse.json({ error: "Failed to save brand profile" }, { status: 500 });
  }

  return NextResponse.json({ brand_profile: result });
}
