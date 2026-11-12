// POST /api/ownership/start
// A signed-in show owner gets one code. The plaintext is in this
// response only. Cross-origin requests are refused.

import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/data/queries";
import { isOwnershipCode } from "@/lib/ownership/code";
import {
  enforceOwnershipStart,
  OWNERSHIP_ERRORS,
  OWNERSHIP_MESSAGES,
  requestIsSameOrigin,
  startOwnership,
  type OwnershipMedium,
} from "@/lib/ownership/check";
import { requireShowProfile } from "@/lib/youtube-oauth/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MESSAGES = new Set<string>(Object.values(OWNERSHIP_MESSAGES));

function noStore(response: NextResponse): NextResponse {
  response.headers.set("Cache-Control", "no-store");
  return response;
}

function noStoreJson(body: unknown, status = 200): NextResponse {
  return noStore(NextResponse.json(body, { status }));
}

function fixedError(status: number, error: string): NextResponse {
  const known = new Set<string>(Object.values(OWNERSHIP_ERRORS));
  if (!known.has(error)) {
    return noStoreJson({ error: OWNERSHIP_ERRORS.unavailable }, 503);
  }
  return noStoreJson({ error }, status);
}

export async function POST(request: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) return fixedError(401, OWNERSHIP_ERRORS.unauthorized);

  const show = await requireShowProfile(user.id);
  if (!show.ok) return fixedError(403, OWNERSHIP_ERRORS.forbidden);

  if (!requestIsSameOrigin(request.headers.get("origin"))) {
    return fixedError(403, OWNERSHIP_ERRORS.forbidden);
  }

  const limited = await enforceOwnershipStart(user.id);
  if (limited) return noStore(limited);

  let body: unknown = null;
  try {
    body = await request.json();
  } catch {
    body = null;
  }
  const record = body && typeof body === "object" && !Array.isArray(body)
    ? (body as { medium?: unknown; channel?: unknown })
    : null;
  const medium = record?.medium;
  if (medium !== "podcast" && medium !== "youtube") {
    return fixedError(400, OWNERSHIP_ERRORS.medium);
  }

  const result = await startOwnership({
    userId: user.id,
    showProfileId: show.showProfileId,
    medium: medium as OwnershipMedium,
    channel: typeof record?.channel === "string" ? record.channel : "",
  });
  if (!result.ok) return fixedError(result.status, result.error);
  if (!isOwnershipCode(result.code) || !MESSAGES.has(result.message)) {
    return fixedError(503, OWNERSHIP_ERRORS.unavailable);
  }
  return noStoreJson({
    code: result.code,
    message: result.message,
    target: result.target,
    medium: result.medium,
  });
}
