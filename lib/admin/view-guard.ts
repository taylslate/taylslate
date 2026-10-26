// Blocks charges, payouts, and card changes while an admin is in a
// test-account view. The cookie is not authority: the session email is
// checked against INTERNAL_ADMIN_EMAILS on every call. A cookie without
// that session is ignored.

import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/data/queries";
import { isInternalAdmin } from "@/lib/auth/admin";
import {
  adminViewAccountFromCookie,
  isAdminViewCookie,
} from "@/lib/admin/test-accounts";

// Same name as VIEW_AS_COOKIE in lib/data/queries.ts. Kept here so this
// guard does not pull that export through route tests that mock queries.
const VIEW_AS_COOKIE = "taylslate_view_as";

const BLOCKED_MESSAGE =
  "Money actions are blocked while viewing as a test account";

export function readRequestCookie(
  cookieHeader: string | null,
  name: string,
): string | null {
  if (!cookieHeader || !name) return null;
  for (const part of cookieHeader.split(";")) {
    const trimmed = part.trim();
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    if (trimmed.slice(0, eq) !== name) continue;
    const raw = trimmed.slice(eq + 1);
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  }
  return null;
}

export async function rejectSwitchedViewMoneyAction(
  request: { headers: { get(name: string): string | null } },
): Promise<NextResponse | null> {
  const viewAs = readRequestCookie(request.headers.get("cookie"), VIEW_AS_COOKIE);
  if (!isAdminViewCookie(viewAs)) return null;

  const user = await getAuthenticatedUser();
  if (!user || !isInternalAdmin(user.email)) return null;

  const account = adminViewAccountFromCookie(viewAs);
  if (!account) return null;

  return NextResponse.json({ error: BLOCKED_MESSAGE }, { status: 403 });
}
