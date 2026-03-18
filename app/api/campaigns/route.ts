import { NextResponse } from "next/server";
import { getAuthenticatedUser, getCampaignsForUser } from "@/lib/data/queries";

export async function GET() {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const campaigns = await getCampaignsForUser(user.id);
  return NextResponse.json({ campaigns });
}
