import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/data/queries";
import { supabaseAdmin } from "@/lib/supabase/admin";

// Options on app/onboarding/page.tsx, from ONBOARDING_ROLES in
// app/onboarding/roles.tsx. "show" is not offered. "admin" is not a
// profiles role and is never accepted.
const ALLOWED_ROLES = ["brand", "agency", "agent"] as const;

type AllowedRole = (typeof ALLOWED_ROLES)[number];

interface ProfileRow {
  id: string;
  role: string | null;
}

interface OnboardedRow {
  onboarded_at: string | null;
}

function isAllowedRole(role: string): role is AllowedRole {
  return (ALLOWED_ROLES as readonly string[]).includes(role);
}

export async function POST(request: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Role is not available" }, { status: 400 });
  }

  const record = body as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.length !== 1 || keys[0] !== "role" || typeof record.role !== "string") {
    return NextResponse.json({ error: "Role is not available" }, { status: 400 });
  }

  const role = record.role;
  if (role === "admin" || !isAllowedRole(role)) {
    return NextResponse.json({ error: "Role is not available" }, { status: 400 });
  }

  const { data: profile, error: profileError } = await supabaseAdmin
    .from("profiles")
    .select("id, role")
    .eq("id", user.id)
    .maybeSingle<ProfileRow>();
  if (profileError) {
    return NextResponse.json({ error: "Failed to load profile" }, { status: 500 });
  }

  const allowed = await roleChangeAllowed(user.id, profile);
  if (!allowed) {
    return NextResponse.json({ error: "Onboarding is already finished." }, { status: 403 });
  }

  if (!profile) {
    const { error: insertError } = await supabaseAdmin.from("profiles").insert({
      id: user.id,
      email: user.email ?? "",
      full_name: "",
      role,
      tier: "free",
    });
    if (insertError) {
      return NextResponse.json({ error: "Failed to save role" }, { status: 500 });
    }
    return NextResponse.json({ role, tier: "free" });
  }

  const { error: updateError } = await supabaseAdmin
    .from("profiles")
    .update({ role, tier: "free" })
    .eq("id", user.id);
  if (updateError) {
    return NextResponse.json({ error: "Failed to save role" }, { status: 500 });
  }

  return NextResponse.json({ role, tier: "free" });
}

async function roleChangeAllowed(userId: string, profile: ProfileRow | null): Promise<boolean> {
  const [{ data: brand, error: brandError }, { data: show, error: showError }] = await Promise.all([
    supabaseAdmin
      .from("brand_profiles")
      .select("onboarded_at")
      .eq("user_id", userId)
      .maybeSingle<OnboardedRow>(),
    supabaseAdmin
      .from("show_profiles")
      .select("onboarded_at")
      .eq("user_id", userId)
      .maybeSingle<OnboardedRow>(),
  ]);
  if (brandError || showError) return false;

  // brand_profiles.onboarded_at and show_profiles.onboarded_at are the
  // completion signals the dashboard and onboarding indexes already use.
  if (brand?.onboarded_at || show?.onboarded_at) return false;

  // Neither signal is set. A show profile row is still a show link.
  // Allow the write only while role is unset or still the ensureProfile
  // default, and the account has no campaigns or show links.
  const currentRole = profile?.role ?? null;
  if (currentRole !== null && currentRole !== "brand") return false;
  if (show) return false;

  const [{ count: campaigns, error: campaignError }, { count: links, error: linkError }] =
    await Promise.all([
      supabaseAdmin
        .from("campaigns")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId),
      supabaseAdmin
        .from("agent_show_relationships")
        .select("id", { count: "exact", head: true })
        .eq("agent_id", userId),
    ]);
  if (campaignError || linkError) return false;
  if ((campaigns ?? 0) > 0) return false;
  if ((links ?? 0) > 0) return false;
  return true;
}
