import { NextRequest, NextResponse } from "next/server";
import {
  ensureProfile,
  getAuthenticatedUser,
  getShowProfileByUserId,
} from "@/lib/data/queries";
import { listOwnerSurfaces, replaceOwnerSurfaces } from "@/lib/data/show-surfaces";
import { sanitizeShowSurfaceDrafts } from "@/lib/shows/surfaces";

export async function GET() {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const surfaces = await listOwnerSurfaces(user.id);
  return NextResponse.json({ surfaces });
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
    console.error("[show-surfaces/PUT] ensureProfile failed:", err);
    return NextResponse.json({ error: "Failed to initialize profile" }, { status: 500 });
  }

  const profile = await getShowProfileByUserId(user.id);
  if (!profile) {
    return NextResponse.json(
      { error: "Finish the show profile before listing surfaces" },
      { status: 400 }
    );
  }

  const drafts = sanitizeShowSurfaceDrafts(body.surfaces);
  const surfaces = await replaceOwnerSurfaces(
    user.id,
    user.email ?? "",
    profile,
    drafts
  );
  if (!surfaces) {
    return NextResponse.json({ error: "Couldn't save surfaces" }, { status: 500 });
  }
  return NextResponse.json({ surfaces });
}
