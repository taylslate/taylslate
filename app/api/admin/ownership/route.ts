// GET /api/admin/ownership
// Contested proofs, and expired proofs with no newer proof for that
// show and user. Signed out is 401. A non-admin is 403.

import { NextRequest } from "next/server";
import { getAuthenticatedUser } from "@/lib/data/queries";
import {
  adminOwnershipReadRules,
  listOwnershipQueue,
  OWNERSHIP_LOAD_FAILED,
  ownershipClientError,
  ownershipJson,
  ownershipNoStore,
  parseOwnershipQueueStatus,
} from "@/lib/ownership/review";
import { enforceRules } from "@/lib/security/rate-limit";
import { isShowsAdmin } from "@/lib/shows/can-edit-show";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function requireShowsAdmin(): Promise<
  { ok: true; userId: string } | { ok: false; response: Response }
> {
  const user = await getAuthenticatedUser();
  if (!user) return { ok: false, response: ownershipJson({ error: "Unauthorized" }, 401) };
  if (!(await isShowsAdmin(user.id))) {
    return { ok: false, response: ownershipJson({ error: "Forbidden" }, 403) };
  }
  return { ok: true, userId: user.id };
}

export async function GET(request: NextRequest) {
  const gate = await requireShowsAdmin();
  if (!gate.ok) return gate.response;
  const limited = await enforceRules({
    rules: adminOwnershipReadRules(gate.userId),
    failureMode: "closed",
  });
  if (limited) return ownershipNoStore(limited);
  const parsed = parseOwnershipQueueStatus(request.nextUrl.searchParams.get("status"));
  if (!parsed.ok) return ownershipClientError(400, parsed.error, OWNERSHIP_LOAD_FAILED);
  const listed = await listOwnershipQueue({ status: parsed.status });
  if (!listed.ok) return ownershipClientError(listed.status, listed.error, OWNERSHIP_LOAD_FAILED);
  return ownershipJson({ proofs: listed.proofs });
}
