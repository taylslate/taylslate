// Who may write a catalog show.
//
// True only for an internal admin (INTERNAL_ADMIN_EMAILS on the auth
// login, via showEditGrant) or a show that same helper grants: a
// server owner row, a verified proof tied to this auth user, or the
// dormant sourced-deal rule. A deal show_profile_id is not enough.
// A show_owner email without the server slug is not enough.
// An approved roster link is not an edit grant. shows.agent_id is
// not an edit grant. profiles.email and profiles.role are not read.
// Role admin is not a profiles value.

import { isInternalAdmin } from "@/lib/auth/admin";
import { getAuthEmail } from "@/lib/auth/auth-email";
import { showEditGrant } from "@/lib/ownership/edit-rights";

const ADMIN_WRITE_FIELDS = [
  "agent_id",
  "is_verified",
  "is_claimed",
  "podscan_id",
  "is_discoverable",
  "data_sources",
  "slug",
] as const;

/** Ranking state. Only the ownership writer sets this. Never a client patch. */
const OWNERSHIP_WRITE_FIELDS = ["ownership_status"] as const;

export async function isShowsAdmin(userId: string): Promise<boolean> {
  if (!userId) return false;
  return isInternalAdmin(await getAuthEmail(userId));
}

export async function canEditShow(userId: string, showId: string): Promise<boolean> {
  if (!userId || !showId) return false;
  return showEditGrant(userId, showId);
}

/** Drop id, created_at, and admin-only columns unless the caller is an admin. */
export function showWritePatch(
  body: Record<string, unknown>,
  admin: boolean
): Record<string, unknown> {
  const next = { ...body };
  delete next.id;
  delete next.created_at;
  for (const field of OWNERSHIP_WRITE_FIELDS) delete next[field];
  if (!admin) {
    for (const field of ADMIN_WRITE_FIELDS) delete next[field];
  }
  return next;
}
