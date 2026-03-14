import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getShowById, getUserProfile, claimShow, getAgentShowRelationship } from "@/lib/data/queries";

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

    // Verify show exists
    const show = await getShowById(showId);
    if (!show) {
      return NextResponse.json({ error: "Show not found" }, { status: 404 });
    }

    // Check if already claimed
    const existing = await getAgentShowRelationship(user.id, showId);
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

    const relationship = await claimShow(user.id, showId, commissionRate);

    return NextResponse.json({ relationship, show }, { status: 201 });
  } catch (error) {
    console.error("Claim error:", error);
    return NextResponse.json(
      { error: "Failed to claim show" },
      { status: 500 }
    );
  }
}
