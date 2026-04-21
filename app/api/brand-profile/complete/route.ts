import { NextResponse } from "next/server";
import {
  getAuthenticatedUser,
  getBrandProfileByUserId,
  completeBrandProfile,
} from "@/lib/data/queries";

/**
 * Marks the authenticated user's brand profile as onboarded.
 * Requires that the profile already exists (i.e. they got past the welcome
 * page) and has the minimum fields the scoring engine needs downstream.
 */
export async function POST() {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const existing = await getBrandProfileByUserId(user.id);
  if (!existing) {
    return NextResponse.json(
      { error: "No brand profile to complete — start onboarding first" },
      { status: 400 }
    );
  }

  // Minimum viable: identity + customer description + at least one category.
  const missing: string[] = [];
  if (!existing.brand_identity?.trim()) missing.push("brand_identity");
  if (!existing.target_customer?.trim()) missing.push("target_customer");
  if (!existing.content_categories || existing.content_categories.length === 0) {
    missing.push("content_categories");
  }
  if (missing.length > 0) {
    return NextResponse.json(
      { error: "Missing required fields", missing },
      { status: 400 }
    );
  }

  const result = await completeBrandProfile(user.id);
  if (!result) {
    return NextResponse.json({ error: "Failed to complete brand profile" }, { status: 500 });
  }

  return NextResponse.json({ brand_profile: result });
}
