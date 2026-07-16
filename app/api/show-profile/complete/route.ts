import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  getAuthenticatedUser,
  getShowProfileByUserId,
  completeShowProfile,
} from "@/lib/data/queries";
import {
  ONBOARDING_RETURN_COOKIE,
  ONBOARDING_RETURN_COOKIE_OPTIONS,
  sanitizeReturnPath,
} from "@/lib/auth/onboarding-return";

/**
 * Marks the authenticated user's show profile as onboarded.
 * Enforces the minimum fields the platform needs to pair the show with
 * advertisers downstream: name, platform, cadence, audience size.
 */
export async function POST(request: Request) {
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

  // If the show arrived from a public pitch (magic-link onboarding), the
  // /api/auth/magic landing stashed the pitch URL in a cookie. Hand it back so
  // the client can hard-navigate straight to accept/counter/decline — a hard nav
  // (not router.push) forces the pitch page's server component to re-run, so the
  // now-onboarded show sees "Accept offer" immediately without a manual refresh.
  const { origin } = new URL(request.url);
  const cookieStore = await cookies();
  const redirectTo = sanitizeReturnPath(
    cookieStore.get(ONBOARDING_RETURN_COOKIE)?.value,
    origin
  );

  const response = NextResponse.json({ show_profile: result, redirect_to: redirectTo });
  // One-shot: clear the cookie whether or not it was present/valid.
  response.cookies.set(ONBOARDING_RETURN_COOKIE, "", {
    ...ONBOARDING_RETURN_COOKIE_OPTIONS,
    maxAge: 0,
  });
  return response;
}
