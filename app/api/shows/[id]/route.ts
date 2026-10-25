import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getShowById, updateShow } from "@/lib/data/queries";
import type { Show } from "@/lib/data/types";
import { canEditShow, isShowsAdmin, showWritePatch } from "@/lib/shows/can-edit-show";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const show = await getShowById(id);
    // Non-discoverable shows (accept-materialized non-catalog rows, seeds) are
    // transaction artifacts, not catalog entries — never expose them on this
    // brand-facing detail read, even by direct UUID (migration 031). Deal/IO
    // surfaces resolve the show through show_profiles, not this route.
    if (!show || show.is_discoverable === false) {
      return NextResponse.json({ error: "Show not found" }, { status: 404 });
    }
    return NextResponse.json({ show });
  } catch (error) {
    console.error("Error fetching show:", error);
    return NextResponse.json({ error: "Failed to fetch show" }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;

    // Verify show exists
    const existing = await getShowById(id);
    if (!existing) {
      return NextResponse.json({ error: "Show not found" }, { status: 404 });
    }

    if (!(await canEditShow(user.id, id))) {
      return NextResponse.json(
        { error: "You don't have permission to edit this show" },
        { status: 403 }
      );
    }

    const body = showWritePatch(
      (await request.json()) as Record<string, unknown>,
      await isShowsAdmin(user.id)
    );

    const show = await updateShow(id, body as Partial<Show>);
    if (!show) {
      return NextResponse.json({ error: "Failed to update show" }, { status: 500 });
    }

    return NextResponse.json({ show });
  } catch (error) {
    console.error("Error updating show:", error);
    return NextResponse.json({ error: "Failed to update show" }, { status: 500 });
  }
}
