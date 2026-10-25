import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  getShowById,
  getUserProfile,
  claimShow,
  getAgentShowRelationshipAnyStatus,
} from "@/lib/data/queries";
import { isShowsAdmin } from "@/lib/shows/can-edit-show";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const profile = await getUserProfile(user.id);
    if (!profile || profile.role !== "agent") {
      return NextResponse.json({ error: "Only agents can claim shows" }, { status: 403 });
    }

    const { id: showId } = await params;

    const show = await getShowById(showId);
    if (!show) {
      return NextResponse.json({ error: "Show not found" }, { status: 404 });
    }

    // A hidden show is 404 unless the caller created it or is an admin.
    // The success body below still omits the row, so a hidden show is
    // never returned in full.
    const hidden = show.is_discoverable === false;
    if (hidden) {
      const creator = Boolean(show.agent_id) && show.agent_id === user.id;
      if (!creator && !(await isShowsAdmin(user.id))) {
        return NextResponse.json({ error: "Show not found" }, { status: 404 });
      }
    }

    // Any existing row blocks a second claim, including pending and rejected.
    const existing = await getAgentShowRelationshipAnyStatus(user.id, showId);
    if (existing) {
      return NextResponse.json(
        { error: "You already represent this show", relationship: existing },
        { status: 409 }
      );
    }

    // Parse optional commission rate from body
    let commissionRate: number | undefined;
    try {
      const body = await request.json();
      commissionRate = body.commission_rate;
    } catch {
      // No body is fine
    }

    const relationship = await claimShow(showId, commissionRate);

    return NextResponse.json(
      hidden
        ? { relationship, status: "pending" }
        : { relationship, show, status: "pending" },
      { status: 201 }
    );
  } catch (error) {
    console.error("Claim error:", error);
    return NextResponse.json(
      { error: "Failed to claim show" },
      { status: 500 }
    );
  }
}
