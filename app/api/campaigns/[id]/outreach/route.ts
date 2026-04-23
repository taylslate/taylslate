import { NextRequest, NextResponse } from "next/server";
import {
  getAuthenticatedUser,
  getCampaignById,
  getOutreachesForCampaign,
} from "@/lib/data/queries";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const campaign = await getCampaignById(id);
  if (!campaign || campaign.user_id !== user.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const outreaches = await getOutreachesForCampaign(id);
  return NextResponse.json({ outreaches });
}
