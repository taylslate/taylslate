// Authorization code request. The client and redirect URI are checked
// before any redirect. Later failures go back to the registered URI.

import {
  CLIENT_OR_REDIRECT_DESCRIPTION,
  oauth,
  oauthAdmin,
  OAuthRequestError,
  redirectWith,
} from "@/lib/mcp-oauth/errors";
import { findClientByPublicId, parseScopeList } from "@/lib/mcp-oauth/clients";
import { oauthNow, REQUEST_TTL_MS, requireSiteOrigin, resourceUrl } from "@/lib/mcp-oauth/config";
import { isS256Challenge } from "@/lib/mcp-oauth/pkce";
import { CLIENT_ID_RE } from "@/lib/mcp-oauth/tokens";

export type AuthorizeResult =
  | { kind: "json"; status: number; error: "invalid_request"; description: string }
  | { kind: "redirect"; location: string };

function plainReject(): AuthorizeResult {
  return {
    kind: "json",
    status: 400,
    error: "invalid_request",
    description: CLIENT_OR_REDIRECT_DESCRIPTION,
  };
}

export async function beginAuthorization(params: URLSearchParams): Promise<AuthorizeResult> {
  const clientId = params.get("client_id") ?? "";
  const redirectUri = params.get("redirect_uri") ?? "";
  if (!CLIENT_ID_RE.test(clientId) || redirectUri.length === 0) return plainReject();

  const client = await findClientByPublicId(clientId);
  if (!client || !client.redirect_uris.includes(redirectUri)) return plainReject();

  const origin = requireSiteOrigin();
  const state = params.get("state");
  const safeState = state != null && state.length <= 500 ? state : "";

  const fail = (error: "invalid_request" | "invalid_scope" | "invalid_target"): AuthorizeResult => ({
    kind: "redirect",
    location: redirectWith(redirectUri, { error, state: safeState, iss: origin }),
  });

  if ((params.get("response_type") ?? "") !== "code") return fail("invalid_request");
  const challenge = params.get("code_challenge") ?? "";
  if ((params.get("code_challenge_method") ?? "") !== "S256" || !isS256Challenge(challenge)) {
    return fail("invalid_request");
  }
  if (state != null && state.length > 500) return fail("invalid_request");

  const scopes = parseScopeList(params.get("scope"), true);
  if (!scopes) return fail("invalid_scope");

  const resourceParam = params.get("resource");
  const resource = resourceUrl(origin);
  if (resourceParam != null && resourceParam !== resource) return fail("invalid_target");

  const now = oauthNow();
  const inserted = await oauth(
    oauthAdmin()
      .from("mcp_oauth_requests")
      .insert({
        client_id: client.id,
        redirect_uri: redirectUri,
        scopes,
        state: state && state.length > 0 ? state : null,
        code_challenge: challenge,
        resource,
        expires_at: new Date(now.getTime() + REQUEST_TTL_MS).toISOString(),
      })
      .select("id")
      .single()
  );
  const requestId = (inserted as { id?: unknown }).id;
  if (typeof requestId !== "string" || requestId.length === 0) {
    throw new OAuthRequestError("temporarily_unavailable");
  }

  await oauth(
    oauthAdmin()
      .from("mcp_oauth_clients")
      .update({ last_used_at: now.toISOString() })
      .eq("id", client.id)
      .select("id")
      .maybeSingle()
  );

  return { kind: "redirect", location: `${origin}/oauth/consent/${requestId}` };
}
