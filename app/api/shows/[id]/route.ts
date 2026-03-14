import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getShowById, updateShow, getAgentShowRelationship, getUserProfile } from "@/lib/data/queries";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const show = await getShowById(id);
    if (!show) {
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

    // Verify user has permission to edit (is the agent for this show)
    const profile = await getUserProfile(user.id);
    const relationship = await getAgentShowRelationship(user.id, id);

    if (!relationship && profile?.role !== "show") {
      return NextResponse.json(
        { error: "You don't have permission to edit this show" },
        { status: 403 }
      );
    }

    const body = await request.json();

    // Don't allow changing id or created_at
    delete body.id;
    delete body.created_at;

    const show = await updateShow(id, body);
    if (!show) {
      return NextResponse.json({ error: "Failed to update show" }, { status: 500 });
    }

    return NextResponse.json({ show });
  } catch (error) {
    console.error("Error updating show:", error);
    return NextResponse.json({ error: "Failed to update show" }, { status: 500 });
  }
}
