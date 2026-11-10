// POST /api/admin/roster-links/owner-notices
// A shows admin runs the same 7-day owner heads-up sweep as the cron.
// Signed out is 401. Anyone else is 403. The body is the counts.

import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/data/queries";
import { sweepOwnerVerificationNotices } from "@/lib/reps/roster-notify";
import { isShowsAdmin } from "@/lib/shows/can-edit-show";

export const runtime = "nodejs";

export async function POST() {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!(await isShowsAdmin(user.id))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const counts = await sweepOwnerVerificationNotices();
  return NextResponse.json(counts);
}
