import { NextRequest, NextResponse } from "next/server";
import {
  getAuthenticatedUser,
  getCampaignById,
  getOutreachesForCampaign,
} from "@/lib/data/queries";
import { redactOutreachForViewer } from "@/lib/outreach/public";
import { isShowsAdmin } from "@/lib/shows/can-edit-show";
import { contactVisibleOutreachIds } from "@/lib/relay/contact-visibility";

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
  let visible = new Set<string>();
  try {
    if (await isShowsAdmin(user.id)) {
      visible = new Set(outreaches.map((row) => row.id));
    } else {
      visible = await contactVisibleOutreachIds(
        user.id,
        outreaches.map((row) => row.id)
      );
    }
  } catch {
    visible = new Set();
  }
  return NextResponse.json({
    outreaches: outreaches.map((row) =>
      redactOutreachForViewer(row, { contactVisible: visible.has(row.id) })
    ),
  });
}
