import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser, updateCampaignSelections } from "@/lib/data/queries";

export async function PUT(request: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { campaign_id: string; selected_show_ids: string[] };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.campaign_id) {
    return NextResponse.json({ error: "campaign_id required" }, { status: 400 });
  }

  const success = await updateCampaignSelections(body.campaign_id, body.selected_show_ids);

  if (!success) {
    return NextResponse.json({ error: "Failed to update selections" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
