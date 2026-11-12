// POST /api/oauth/token. Authorization code and refresh token grants.

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
import { exchangeToken } from "@/lib/mcp-oauth/grants";
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
    const ipLimit = await enforceRules({
      failureMode: "closed",
      rules: [{ ...OAUTH_LIMITS.tokenIpMin, key: ip }],
    });
    if (ipLimit) return withOauthRate(ipLimit, true);
    if (requestMime(req) !== "application/x-www-form-urlencoded") {
      return oauthErrorResponse("invalid_request", true);
    }
    const body = await readCappedText(req, OAUTH_JSON_MAX_BYTES);
    if (!body.ok) return oauthErrorResponse(body.error, true);
    const params = new URLSearchParams(body.text);
    const clientId = params.get("client_id") ?? "";
    if (clientId.length > 0) {
      const clientLimit = await enforceRules({
        failureMode: "closed",
        rules: [{ ...OAUTH_LIMITS.tokenClientHour, key: clientId.slice(0, 200) }],
      });
      if (clientLimit) return withOauthRate(clientLimit, true);
    }
    const tokens = await exchangeToken(params);
    return oauthJson(tokens, 200, true);
  } catch (err) {
    return respondOauthFailure(err, true);
  }
}
