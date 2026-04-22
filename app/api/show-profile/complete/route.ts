import { NextResponse } from "next/server";
import {
  getAuthenticatedUser,
  getShowProfileByUserId,
  completeShowProfile,
} from "@/lib/data/queries";

/**
 * Marks the authenticated user's show profile as onboarded.
 * Enforces the minimum fields the platform needs to pair the show with
 * advertisers downstream: name, platform, cadence, audience size.
 */
export async function POST() {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const existing = await getShowProfileByUserId(user.id);
  if (!existing) {
    return NextResponse.json(
      { error: "No show profile to complete — start onboarding first" },
      { status: 400 }
    );
  }

  const missing: string[] = [];
  if (!existing.show_name?.trim()) missing.push("show_name");
  if (!existing.platform) missing.push("platform");
  if (!existing.episode_cadence) missing.push("episode_cadence");
  if (existing.audience_size == null) missing.push("audience_size");
  if (!existing.ad_formats || existing.ad_formats.length === 0) missing.push("ad_formats");
  if (!existing.placements || existing.placements.length === 0) missing.push("placements");

  if (missing.length > 0) {
    return NextResponse.json(
      { error: "Missing required fields", missing },
      { status: 400 }
    );
  }

  const result = await completeShowProfile(user.id);
  if (!result) {
    return NextResponse.json({ error: "Failed to complete show profile" }, { status: 500 });
  }

  return NextResponse.json({ show_profile: result });
}
