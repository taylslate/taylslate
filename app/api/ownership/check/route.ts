// POST /api/ownership/check
// Looks up the caller's newest pending proof. The body is ignored.
// Cross-origin requests are refused.

import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/data/queries";
import {
  checkOwnership,
  enforceOwnershipCheck,
  OWNERSHIP_ERRORS,
  OWNERSHIP_MESSAGES,
  requestIsSameOrigin,
} from "@/lib/ownership/check";
import { requireShowProfile } from "@/lib/youtube-oauth/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MESSAGES = new Set<string>(Object.values(OWNERSHIP_MESSAGES));

function fixedError(status: number, error: string): NextResponse {
  const known = new Set<string>(Object.values(OWNERSHIP_ERRORS));
  if (!known.has(error)) {
    return NextResponse.json({ error: OWNERSHIP_ERRORS.unavailable }, { status: 503 });
  }
  return NextResponse.json({ error }, { status });
}

export async function POST(request: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) return fixedError(401, OWNERSHIP_ERRORS.unauthorized);

  const show = await requireShowProfile(user.id);
  if (!show.ok) return fixedError(403, OWNERSHIP_ERRORS.forbidden);

  if (!requestIsSameOrigin(request.headers.get("origin"))) {
    return fixedError(403, OWNERSHIP_ERRORS.forbidden);
  }

  const limited = await enforceOwnershipCheck(user.id);
  if (limited) return limited;

  try {
    await request.json();
  } catch {
    // An empty body is a valid check.
  }

  const result = await checkOwnership({ userId: user.id });
  if (!result.ok) return fixedError(result.status, result.error);
  if (!MESSAGES.has(result.message)) return fixedError(503, OWNERSHIP_ERRORS.unavailable);
  return NextResponse.json({ outcome: result.outcome, message: result.message });
}
