// GET /api/admin/ownership/[id] reads one proof, the show, the other
// proofs, and the rep links. POST approves or rejects. decided_by is
// the session admin. A body user id is ignored.

import { NextRequest } from "next/server";
import { getAuthenticatedUser } from "@/lib/data/queries";
import { isUuid } from "@/lib/api/v1/pagination";
import {
  adminOwnershipDecideRules,
  adminOwnershipReadRules,
  approveOwnershipProof,
  getOwnershipDetail,
  OWNERSHIP_ACTION,
  OWNERSHIP_APPROVE_FAILED,
  OWNERSHIP_BAD_REQUEST,
  OWNERSHIP_LOAD_FAILED,
  OWNERSHIP_REJECT_FAILED,
  ownershipClientError,
  ownershipJson,
  ownershipNoStore,
  readOwnershipBody,
  rejectOwnershipProof,
} from "@/lib/ownership/review";
import { OWNERSHIP_ERRORS, requestIsSameOrigin } from "@/lib/ownership/check";
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

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requireShowsAdmin();
  if (!gate.ok) return gate.response;
  const limited = await enforceRules({
    rules: adminOwnershipReadRules(gate.userId),
    failureMode: "closed",
  });
  if (limited) return ownershipNoStore(limited);
  const { id } = await params;
  if (!isUuid(id)) return ownershipJson({ error: OWNERSHIP_BAD_REQUEST }, 400);
  const detail = await getOwnershipDetail(id);
  if (!detail.ok) return ownershipClientError(detail.status, detail.error, OWNERSHIP_LOAD_FAILED);
  return ownershipJson({
    proof: detail.detail.proof,
    other_proofs: detail.detail.other_proofs,
    rep_links: detail.detail.rep_links,
  });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requireShowsAdmin();
  if (!gate.ok) return gate.response;
  if (!requestIsSameOrigin(request.headers.get("origin"))) {
    return ownershipJson({ error: OWNERSHIP_ERRORS.forbidden }, 403);
  }
  const limited = await enforceRules({
    rules: adminOwnershipDecideRules(gate.userId),
    failureMode: "closed",
  });
  if (limited) return ownershipNoStore(limited);
  const body = await readOwnershipBody(request);
  if (!body.ok) return ownershipJson({ error: body.error }, body.status);
  const { id } = await params;
  if (!isUuid(id)) return ownershipJson({ error: OWNERSHIP_BAD_REQUEST }, 400);
  if (body.value.action === "approve") {
    const result = await approveOwnershipProof({ proofId: id, adminId: gate.userId });
    if (!result.ok) return ownershipClientError(result.status, result.error, OWNERSHIP_APPROVE_FAILED);
    return ownershipJson({ ok: true, status: "verified" });
  }
  if (body.value.action === "reject") {
    const result = await rejectOwnershipProof({
      proofId: id,
      adminId: gate.userId,
      reason: body.value.reason,
    });
    if (!result.ok) return ownershipClientError(result.status, result.error, OWNERSHIP_REJECT_FAILED);
    return ownershipJson({ ok: true, status: "rejected" });
  }
  return ownershipJson({ error: OWNERSHIP_ACTION }, 400);
}
