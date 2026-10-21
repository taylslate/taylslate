// Authenticated ping for the public API. Proves the key, the per-key
// rate limit, and the read scope. No campaign or outreach data.

import { NextResponse } from "next/server";
import { ApiAuthError, requireScope, resolveApiRequest } from "@/lib/api/auth";
import { enforceApiRateLimit } from "@/lib/api/rate-limit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function json(
  body: Record<string, unknown>,
  status: number,
  extra?: Record<string, string>
) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store", ...extra },
  });
}

export async function GET(req: Request) {
  try {
    const resolved = await resolveApiRequest(req);
    const limit = await enforceApiRateLimit(resolved.keyId);
    if (!limit.ok) {
      return json(
        { error: "Rate limit exceeded." },
        429,
        { "Retry-After": String(limit.retryAfterSec) }
      );
    }
    requireScope(resolved, "read");
    return json({ brandId: resolved.brandId, scopes: resolved.scopes }, 200);
  } catch (err) {
    if (err instanceof ApiAuthError) {
      return json({ error: err.message }, err.status);
    }
    console.warn(
      "[api.v1.health] failed:",
      err instanceof Error ? err.name : "unknown"
    );
    return json({ error: "API request failed." }, 500);
  }
}
