// GET /api/admin/docusign-usage
//
// Auth: INTERNAL_ADMIN_EMAILS only, checked before any database read.
// No session is 401. A signed-in brand, show, or agent is 403.
// The body is the monthly envelope count. This route does not write,
// call DocuSign, or send mail.

import { NextResponse } from "next/server";
import { isInternalAdmin } from "@/lib/auth/admin";
import { getAuthenticatedUser } from "@/lib/data/queries";
import { getDocuSignUsage } from "@/lib/docusign/usage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

export async function GET() {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: NO_STORE });
  }
  if (!isInternalAdmin(user.email)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403, headers: NO_STORE });
  }

  try {
    const usage = await getDocuSignUsage();
    return NextResponse.json(usage, { headers: NO_STORE });
  } catch (err) {
    console.error(
      "[docusign-usage] read failed:",
      err instanceof Error ? err.message : "read failed",
    );
    return NextResponse.json(
      { error: "Could not read DocuSign usage" },
      { status: 500, headers: NO_STORE },
    );
  }
}
