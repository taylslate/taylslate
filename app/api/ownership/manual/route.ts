// POST /api/ownership/manual
// A show owner asks for manual review. The show-owner gate matches
// O2. The link is stored as text and is never fetched.

import { NextRequest } from "next/server";
import { getAuthenticatedUser } from "@/lib/data/queries";
import {
  OWNERSHIP_ERRORS,
  OWNERSHIP_MESSAGES,
  requestIsSameOrigin,
} from "@/lib/ownership/check";
import {
  ownershipClientError,
  ownershipJson,
  ownershipManualRules,
  ownershipNoStore,
  readOwnershipBody,
  requestManualOwnership,
} from "@/lib/ownership/review";
import { enforceRules } from "@/lib/security/rate-limit";
import { requireShowProfile } from "@/lib/youtube-oauth/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) return ownershipJson({ error: OWNERSHIP_ERRORS.unauthorized }, 401);

  const show = await requireShowProfile(user.id);
  if (!show.ok) return ownershipJson({ error: OWNERSHIP_ERRORS.forbidden }, 403);

  if (!requestIsSameOrigin(request.headers.get("origin"))) {
    return ownershipJson({ error: OWNERSHIP_ERRORS.forbidden }, 403);
  }

  const limited = await enforceRules({
    rules: ownershipManualRules(user.id),
    failureMode: "closed",
  });
  if (limited) return ownershipNoStore(limited);

  const body = await readOwnershipBody(request);
  if (!body.ok) return ownershipJson({ error: body.error }, body.status);

  const result = await requestManualOwnership({
    userId: user.id,
    showProfileId: show.showProfileId,
    medium: body.value.medium,
    explanation: body.value.explanation,
    link: body.value.link,
    channel: body.value.channel,
  });
  if (!result.ok) return ownershipClientError(result.status, result.error, OWNERSHIP_ERRORS.unavailable);
  if (result.message !== OWNERSHIP_MESSAGES.review) {
    return ownershipJson({ error: OWNERSHIP_ERRORS.unavailable }, 503);
  }
  return ownershipJson({ ok: true, message: result.message });
}
