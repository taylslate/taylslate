// POST /api/oauth/revoke. Unknown tokens still return 200.

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
import { revokePresentedToken } from "@/lib/mcp-oauth/grants";
import { enforceRules, rateLimitClientIp } from "@/lib/security/rate-limit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function OPTIONS(): Response {
  return corsPreflight("POST, OPTIONS");
}

export async function POST(req: Request): Promise<Response> {
  try {
    requireSiteOrigin();
    const limited = await enforceRules({
      failureMode: "closed",
      rules: [
        {
          ...OAUTH_LIMITS.revokeIpMin,
          key: rateLimitClientIp(req.headers),
        },
      ],
    });
    if (limited) return withOauthRate(limited, true);
    if (requestMime(req) !== "application/x-www-form-urlencoded") {
      return oauthJson({}, 200, true);
    }
    const body = await readCappedText(req, OAUTH_JSON_MAX_BYTES);
    if (!body.ok) return oauthErrorResponse(body.error, true);
    const params = new URLSearchParams(body.text);
    await revokePresentedToken(params.get("token") ?? "", params.get("client_id") ?? "");
    return oauthJson({}, 200, true);
  } catch (err) {
    return respondOauthFailure(err, true);
  }
}
