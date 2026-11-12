// GET /api/oauth/authorize. Validates the client before any redirect.

import { beginAuthorization } from "@/lib/mcp-oauth/authorize";
import { OAUTH_LIMITS, requireSiteOrigin } from "@/lib/mcp-oauth/config";
import { oauthErrorResponse, respondOauthFailure, withOauthRate } from "@/lib/mcp-oauth/errors";
import { enforceRules, rateLimitClientIp } from "@/lib/security/rate-limit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request): Promise<Response> {
  try {
    requireSiteOrigin();
    const limited = await enforceRules({
      failureMode: "closed",
      rules: [
        {
          ...OAUTH_LIMITS.authorizeIpHour,
          key: rateLimitClientIp(req.headers),
        },
      ],
    });
    if (limited) return withOauthRate(limited, false);
    const params = new URL(req.url).searchParams;
    const result = await beginAuthorization(params);
    if (result.kind === "json") {
      return oauthErrorResponse(result.error, false, result.status, result.description);
    }
    return new Response(null, {
      status: 302,
      headers: {
        Location: result.location,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    return respondOauthFailure(err, false);
  }
}
