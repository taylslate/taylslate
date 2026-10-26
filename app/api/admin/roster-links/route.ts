// GET /api/admin/roster-links
// Pending roster links for a shows admin. Signed out is 401.
// A signed-in non-admin is 403. Writes are not done here.

import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/data/queries";
import { isShowsAdmin } from "@/lib/shows/can-edit-show";
import { listPendingRosterLinks } from "@/lib/reps/roster-review";

export const runtime = "nodejs";

async function requireShowsAdmin(): Promise<
  { ok: true; userId: string } | { ok: false; response: NextResponse }
> {
  const user = await getAuthenticatedUser();
  if (!user) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }
  if (!(await isShowsAdmin(user.id))) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    };
  }
  return { ok: true, userId: user.id };
}

export async function GET() {
  const gate = await requireShowsAdmin();
  if (!gate.ok) return gate.response;
  try {
    const links = await listPendingRosterLinks();
    return NextResponse.json({ links });
  } catch (error) {
    console.error(
      "[roster-links] list failed:",
      error instanceof Error ? error.message : error
    );
    return NextResponse.json({ error: "Couldn't load roster requests" }, { status: 500 });
  }
}
