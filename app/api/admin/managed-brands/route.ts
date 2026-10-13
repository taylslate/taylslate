// GET  /api/admin/managed-brands — list brand profiles and is_managed
// PATCH /api/admin/managed-brands — flip is_managed on one brand profile
//
// Auth: INTERNAL_ADMIN_EMAILS only. A non-admin gets 403. The column
// itself is also locked to service_role by migration 041.

import { NextRequest, NextResponse } from "next/server";
import { listManagedBrands } from "@/lib/accounts/managed";
import { isInternalAdmin } from "@/lib/auth/admin";
import { getAuthenticatedUser } from "@/lib/data/queries";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";

async function requireAdmin(): Promise<
  { ok: true } | { ok: false; response: NextResponse }
> {
  const user = await getAuthenticatedUser();
  if (!user) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }
  if (!isInternalAdmin(user.email)) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    };
  }
  return { ok: true };
}

export async function GET() {
  const gate = await requireAdmin();
  if (!gate.ok) return gate.response;
  const brands = await listManagedBrands();
  return NextResponse.json({ brands });
}

export async function PATCH(request: NextRequest) {
  const gate = await requireAdmin();
  if (!gate.ok) return gate.response;

  let body: { profileId?: unknown; isManaged?: unknown };
  try {
    body = (await request.json()) as { profileId?: unknown; isManaged?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (typeof body.profileId !== "string" || typeof body.isManaged !== "boolean") {
    return NextResponse.json(
      { error: "profileId and isManaged are required" },
      { status: 400 },
    );
  }

  const { data: profile, error: readError } = await supabaseAdmin
    .from("profiles")
    .select("id, role, email")
    .eq("id", body.profileId)
    .single();
  if (readError || !profile) {
    return NextResponse.json({ error: "Profile not found" }, { status: 404 });
  }
  if (profile.role !== "brand") {
    return NextResponse.json(
      { error: "Only a brand profile can be marked managed" },
      { status: 400 },
    );
  }

  const { data, error } = await supabaseAdmin
    .from("profiles")
    .update({ is_managed: body.isManaged })
    .eq("id", body.profileId)
    .select("id, email, is_managed")
    .single();
  if (error || !data) {
    console.error("[managed-brands] update failed:", error?.message);
    return NextResponse.json({ error: "Couldn't update the profile" }, { status: 500 });
  }

  return NextResponse.json({
    id: data.id,
    email: data.email,
    isManaged: data.is_managed === true,
  });
}
