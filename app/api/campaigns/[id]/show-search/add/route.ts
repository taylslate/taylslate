// POST /api/campaigns/[id]/show-search/add
// Body is JSON { key } only. The server re-resolves the show.

import { NextRequest, NextResponse } from "next/server";
import {
  BAD_KEY,
  addShowFromSearch,
  loadOwnedCampaign,
  parseShowKey,
} from "@/lib/discovery/direct-search";
import { enforceRules } from "@/lib/security/rate-limit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_BODY_BYTES = 2 * 1024;
const HOUR_SECONDS = 60 * 60;
const SEND_JSON = "Send JSON.";
const TOO_LARGE = "Request is too large.";

function json(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function withNoStore(response: NextResponse): NextResponse {
  response.headers.set("Cache-Control", "no-store");
  return response;
}

function isJsonRequest(request: Request): boolean {
  const mime = (request.headers.get("content-type") ?? "").split(";")[0]?.trim().toLowerCase();
  return mime === "application/json";
}

async function readKey(
  request: Request
): Promise<{ ok: true; key: unknown } | { ok: false; status: number; error: string }> {
  if (!isJsonRequest(request)) return { ok: false, status: 400, error: SEND_JSON };
  const declared = request.headers.get("content-length");
  if (declared !== null && /^\d+$/.test(declared.trim()) && Number(declared) > MAX_BODY_BYTES) {
    return { ok: false, status: 400, error: TOO_LARGE };
  }
  const raw = await request.text();
  if (Buffer.byteLength(raw, "utf8") > MAX_BODY_BYTES) {
    return { ok: false, status: 400, error: TOO_LARGE };
  }
  try {
    const parsed = JSON.parse(raw) as { key?: unknown };
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { ok: false, status: 400, error: SEND_JSON };
    }
    return { ok: true, key: parsed.key };
  } catch {
    return { ok: false, status: 400, error: SEND_JSON };
  }
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const access = await loadOwnedCampaign(id);
  if (!access.ok) return json({ error: access.error }, access.status);

  const body = await readKey(request);
  if (!body.ok) return json({ error: body.error }, body.status);
  if (!parseShowKey(body.key).ok) return json({ error: BAD_KEY }, 400);

  const limited = await enforceRules({
    failureMode: "closed",
    rules: [
      {
        bucket: "disc_search_add_user_hour",
        key: access.userId,
        max: 60,
        windowSeconds: HOUR_SECONDS,
      },
    ],
  });
  if (limited) return withNoStore(limited);

  const added = await addShowFromSearch(
    { id: access.campaign.id, user_id: access.userId },
    body.key
  );
  if (!added.ok) return json({ error: added.error }, added.status);
  return json({
    ok: true,
    showId: added.showId,
    alreadyInPlan: added.alreadyInPlan,
  });
}
