// POST /api/oauth/register. Dynamic client registration. No client secret.

import { registerClient } from "@/lib/mcp-oauth/clients";
import { OAUTH_LIMITS, requireSiteOrigin } from "@/lib/mcp-oauth/config";
import {
  corsPreflight,
  OAUTH_JSON_MAX_BYTES,
  oauthErrorResponse,
  oauthJson,
  readCappedText,
  requestMime,
  respondOauthFailure,
  withOauthRate,
} from "@/lib/mcp-oauth/errors";
import { enforceRules, rateLimitClientIp } from "@/lib/security/rate-limit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function OPTIONS(): Response {
  return corsPreflight("POST, OPTIONS");
}

export async function POST(req: Request): Promise<Response> {
  try {
    requireSiteOrigin();
    const ip = rateLimitClientIp(req.headers);
    const limited = await enforceRules({
      failureMode: "closed",
      rules: [
        { ...OAUTH_LIMITS.registerIpHour, key: ip },
        { ...OAUTH_LIMITS.registerIpDay, key: ip },
      ],
    });
    if (limited) return withOauthRate(limited, true);
    if (requestMime(req) !== "application/json") {
      return oauthErrorResponse("invalid_request", true);
    }
    const body = await readCappedText(req, OAUTH_JSON_MAX_BYTES);
    if (!body.ok) return oauthErrorResponse(body.error, true);
    let parsed: unknown;
    try {
      parsed = JSON.parse(body.text);
    } catch {
      return oauthErrorResponse("invalid_request", true);
    }
    const registered = await registerClient(parsed);
    return oauthJson(registered, 201, true);
  } catch (err) {
    return respondOauthFailure(err, true);
  }
}
