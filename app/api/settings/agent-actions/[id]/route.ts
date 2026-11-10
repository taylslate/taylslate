// One decision on the signed-in brand's action. The actor is the
// session user id. Approving outreach records the decision and
// sends nothing.

import { NextRequest, NextResponse } from "next/server";
import { enforceRules } from "@/lib/security/rate-limit";
import { requireBrand } from "@/lib/api/approvals/list";
import {
  apiActionDecideRule,
  decideAction,
  isSameOriginRequest,
  parseDecisionBody,
} from "@/lib/api/approvals/decide";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_BODY_BYTES = 8 * 1024;

type DecisionRoute = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, route: DecisionRoute) {
  const actor = await requireBrand();
  if (!actor.ok) {
    return NextResponse.json({ error: actor.error }, { status: actor.httpStatus });
  }

  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const limited = await enforceRules({
    rules: [apiActionDecideRule(actor.userId)],
    failureMode: "closed",
  });
  if (limited) return limited;

  const raw = await request.text();
  if (Buffer.byteLength(raw, "utf8") > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "Request body is too large." }, { status: 413 });
  }
  let parsed: unknown;
  try {
    parsed = raw.trim() === "" ? null : JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const body = parseDecisionBody(parsed);
  if (!body.ok) {
    return NextResponse.json({ error: body.error }, { status: 422 });
  }

  const { id } = await route.params;
  const result = await decideAction({
    userId: actor.userId,
    actionId: id,
    decision: body.decision,
    note: body.note,
  });
  if (!result.ok) {
    return NextResponse.json(
      {
        error: result.error,
        ...(result.status ? { status: result.status } : {}),
        ...(result.action ? { action: result.action } : {}),
      },
      { status: result.httpStatus, headers: { "Cache-Control": "no-store" } }
    );
  }
  return NextResponse.json(
    { action: result.action, message: result.message },
    { status: 200, headers: { "Cache-Control": "no-store" } }
  );
}
