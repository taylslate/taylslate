// GET /api/view-mode/clear?next=/dashboard
// Self-heal endpoint: clears the taylslate_view_as cookie and 302-redirects.
// Called from the dashboard layout when getEffectiveRole detects a stale
// cookie (cookie names a role for which the user has no profile row).
// Server Components can't mutate cookies, so we redirect through here.

import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { VIEW_AS_COOKIE } from "@/lib/data/queries";

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const requested = url.searchParams.get("next") || "/dashboard";
  const next = requested.startsWith("/") ? requested : "/dashboard";

  (await cookies()).delete(VIEW_AS_COOKIE);

  return NextResponse.redirect(new URL(next, url.origin));
}
