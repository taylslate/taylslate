import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { isInternalAdmin } from "@/lib/auth/admin";
import {
  adminViewAccountFromCookie,
  adminViewCookieValue,
  configuredAdminViewAccount,
  type AdminViewRole,
} from "@/lib/admin/test-accounts";
import {
  VIEW_AS_COOKIE,
  getBrandProfileByUserId,
  getShowProfileByUserId,
  getUserProfile,
} from "@/lib/data/queries";

const ALLOWED_MODES = new Set(["brand", "show"]);
const ADMIN_VIEW_ROLES = new Set<AdminViewRole>(["brand", "show", "agent"]);

function isAdminViewRole(mode: string): mode is AdminViewRole {
  return ADMIN_VIEW_ROLES.has(mode as AdminViewRole);
}

const VIEW_COOKIE = {
  httpOnly: true,
  sameSite: "lax" as const,
  path: "/",
  maxAge: 60 * 60 * 24 * 30,
};

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!isInternalAdmin(user.email)) {
    return NextResponse.json({ viewAs: null, label: null, agentConfigured: false });
  }

  const viewAs = (await cookies()).get(VIEW_AS_COOKIE)?.value;
  const account = adminViewAccountFromCookie(viewAs);
  return NextResponse.json({
    viewAs: account?.role ?? null,
    label: account?.label ?? null,
    agentConfigured: configuredAdminViewAccount("agent") !== null,
  });
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let mode: string | null = null;
  try {
    const body = await request.json();
    mode = typeof body?.mode === "string" ? body.mode : null;
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const cookieStore = await cookies();

  if (mode === null || mode === "" || mode === "clear") {
    cookieStore.delete(VIEW_AS_COOKIE);
    return NextResponse.json({ ok: true, viewAs: null });
  }

  // Admins point the view at a configured test account. The cookie stores
  // that account's key. It does not switch the session user.
  if (isInternalAdmin(user.email)) {
    if (!isAdminViewRole(mode)) {
      return NextResponse.json({ error: "Invalid mode" }, { status: 400 });
    }
    const account = configuredAdminViewAccount(mode);
    if (!account) {
      return NextResponse.json(
        {
          error:
            mode === "agent"
              ? "No test agent configured"
              : "No test profile configured",
        },
        { status: 403 },
      );
    }
    cookieStore.set(VIEW_AS_COOKIE, adminViewCookieValue(account), VIEW_COOKIE);
    return NextResponse.json({
      ok: true,
      viewAs: mode,
      label: account.label,
    });
  }

  if (!ALLOWED_MODES.has(mode)) {
    return NextResponse.json({ error: "Invalid mode" }, { status: 400 });
  }

  if (mode === "brand") {
    const brand = await getBrandProfileByUserId(user.id);
    if (!brand) {
      return NextResponse.json(
        { error: "No brand profile for this user" },
        { status: 403 }
      );
    }
  } else {
    const show = await getShowProfileByUserId(user.id);
    if (!show) {
      return NextResponse.json(
        { error: "No show profile for this user" },
        { status: 403 }
      );
    }
  }

  // Returning to the account's own role drops the cookie instead of
  // storing a view-as value that matches profiles.role.
  const profile = await getUserProfile(user.id);
  if (profile?.role === mode) {
    cookieStore.delete(VIEW_AS_COOKIE);
    return NextResponse.json({ ok: true, viewAs: null });
  }

  cookieStore.set(VIEW_AS_COOKIE, mode, VIEW_COOKIE);
  return NextResponse.json({ ok: true, viewAs: mode });
}
