import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import {
  VIEW_AS_COOKIE,
  getBrandProfileByUserId,
  getShowProfileByUserId,
} from "@/lib/data/queries";

const ALLOWED_MODES = new Set(["brand", "show"]);

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

  cookieStore.set(VIEW_AS_COOKIE, mode, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  return NextResponse.json({ ok: true, viewAs: mode });
}
