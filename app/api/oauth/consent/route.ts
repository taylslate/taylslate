// POST /api/oauth/consent. The signed-in user allows or denies one request.

import { decideConsent } from "@/lib/mcp-oauth/consent";
import { OAUTH_LIMITS, requireSiteOrigin } from "@/lib/mcp-oauth/config";
import {
  OAUTH_JSON_MAX_BYTES,
  oauthErrorResponse,
  oauthJson,
  readCappedText,
  requestMime,
  respondOauthFailure,
  withOauthRate,
} from "@/lib/mcp-oauth/errors";
import { getAuthenticatedUser } from "@/lib/data/queries";
import { enforceRules } from "@/lib/security/rate-limit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request): Promise<Response> {
  try {
    const origin = requireSiteOrigin();
    const user = await getAuthenticatedUser();
    if (!user?.id) return oauthErrorResponse("invalid_request", false, 401);
    const headerOrigin = req.headers.get("origin");
    if (headerOrigin !== origin) return oauthErrorResponse("invalid_request", false, 403);
    if (requestMime(req) !== "application/json") {
      return oauthErrorResponse("invalid_request", false);
    }
    const limited = await enforceRules({
      failureMode: "closed",
      rules: [{ ...OAUTH_LIMITS.consentUserHour, key: user.id }],
    });
    if (limited) return withOauthRate(limited, false);
    const body = await readCappedText(req, OAUTH_JSON_MAX_BYTES);
    if (!body.ok) return oauthErrorResponse(body.error, false);
    let parsed: unknown;
    try {
      parsed = JSON.parse(body.text);
    } catch {
      return oauthErrorResponse("invalid_request", false);
    }
    const decision = await decideConsent(user.id, parsed);
    return oauthJson(decision, 200, false);
  } catch (err) {
    return respondOauthFailure(err, false);
  }
}
