// Consent decision. The session user id is the only identity.
// The request is consumed once, then allow mints a code or deny redirects.

import { ApiAuthError } from "@/lib/api/errors";
import { assertProfileApiAccess } from "@/lib/api/plan-gate";
import { scopesFromDb, type ApiScope } from "@/lib/api/keys";
import { oauthNow, CODE_TTL_MS, requireSiteOrigin } from "@/lib/mcp-oauth/config";
import { oauth, oauthAdmin, OAuthRequestError, redirectWith } from "@/lib/mcp-oauth/errors";
import { EXPIRED_COPY, PLAN_COPY } from "@/lib/mcp-oauth/copy";
import { hashToken, newAuthCode } from "@/lib/mcp-oauth/tokens";

export { EXPIRED_COPY, PLAN_COPY, UNAVAILABLE_COPY } from "@/lib/mcp-oauth/copy";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ConsentView =
  | { state: "expired" }
  | { state: "unavailable" }
  | { state: "no_api" }
  | {
      state: "ready";
      requestId: string;
      clientName: string;
      redirectHost: string;
      scopes: ApiScope[];
    };

interface RequestRow {
  id: string;
  client_id: string;
  redirect_uri: string;
  scopes: unknown;
  state: string | null;
  code_challenge: string;
  resource: string;
  expires_at: string;
  consumed_at: string | null;
}

interface ProfileRow {
  id: string;
  role?: unknown;
  plan?: unknown;
}

export function redirectHost(uri: string): string {
  try {
    const host = new URL(uri).host;
    return host || "the app";
  } catch {
    return "the app";
  }
}

function isExpired(row: { expires_at?: unknown; consumed_at?: unknown } | null): boolean {
  if (!row) return true;
  if (row.consumed_at) return true;
  const ms = Date.parse(String(row.expires_at ?? ""));
  if (!Number.isFinite(ms)) return true;
  return ms <= oauthNow().getTime();
}

export async function loadConsentView(requestId: string, userId: string): Promise<ConsentView> {
  if (!UUID_RE.test(requestId) || !UUID_RE.test(userId)) return { state: "expired" };
  requireSiteOrigin();
  const request = (await oauth(
    oauthAdmin().from("mcp_oauth_requests").select("*").eq("id", requestId).maybeSingle()
  )) as RequestRow | null;
  if (isExpired(request) || !request) return { state: "expired" };

  const client = (await oauth(
    oauthAdmin()
      .from("mcp_oauth_clients")
      .select("id, client_name")
      .eq("id", request.client_id)
      .maybeSingle()
  )) as { id: string; client_name: string } | null;
  if (!client) return { state: "expired" };

  const profile = (await oauth(
    oauthAdmin().from("profiles").select("id, role, plan").eq("id", userId).maybeSingle()
  )) as ProfileRow | null;
  if (!profile || profile.id.toLowerCase() !== userId.toLowerCase()) return { state: "no_api" };
  try {
    assertProfileApiAccess(profile);
  } catch (err) {
    if (err instanceof ApiAuthError) return { state: "no_api" };
    throw err;
  }

  return {
    state: "ready",
    requestId: request.id,
    clientName: client.client_name,
    redirectHost: redirectHost(request.redirect_uri),
    scopes: scopesFromDb(request.scopes),
  };
}

export async function decideConsent(
  userId: string,
  body: unknown
): Promise<{ redirect: string }> {
  if (!UUID_RE.test(userId)) {
    throw new OAuthRequestError("invalid_request", 401);
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new OAuthRequestError("invalid_request");
  }
  const record = body as Record<string, unknown>;
  const requestId = record.requestId;
  const decision = record.decision;
  if (typeof requestId !== "string" || !UUID_RE.test(requestId)) {
    throw new OAuthRequestError("invalid_request", 400, EXPIRED_COPY);
  }
  if (decision !== "allow" && decision !== "deny") {
    throw new OAuthRequestError("invalid_request");
  }

  const now = oauthNow().toISOString();
  const request = (await oauth(
    oauthAdmin()
      .from("mcp_oauth_requests")
      .update({ consumed_at: now })
      .eq("id", requestId)
      .is("consumed_at", null)
      .gt("expires_at", now)
      .select("*")
      .maybeSingle()
  )) as RequestRow | null;
  if (!request) throw new OAuthRequestError("invalid_request", 400, EXPIRED_COPY);

  const origin = requireSiteOrigin();
  const state = typeof request.state === "string" ? request.state : "";
  if (decision === "deny") {
    return {
      redirect: redirectWith(request.redirect_uri, {
        error: "access_denied",
        state,
        iss: origin,
      }),
    };
  }

  const profile = (await oauth(
    oauthAdmin().from("profiles").select("id, role, plan").eq("id", userId).maybeSingle()
  )) as ProfileRow | null;
  if (!profile || profile.id.toLowerCase() !== userId.toLowerCase()) {
    throw new OAuthRequestError("access_denied", 403, PLAN_COPY);
  }
  try {
    assertProfileApiAccess(profile);
  } catch (err) {
    if (err instanceof ApiAuthError) {
      throw new OAuthRequestError("access_denied", 403, PLAN_COPY);
    }
    throw err;
  }

  const code = newAuthCode();
  await oauth(
    oauthAdmin()
      .from("mcp_oauth_codes")
      .insert({
        code_hash: hashToken(code),
        request_id: request.id,
        client_id: request.client_id,
        user_id: userId,
        redirect_uri: request.redirect_uri,
        code_challenge: request.code_challenge,
        scopes: scopesFromDb(request.scopes),
        resource: request.resource,
        expires_at: new Date(oauthNow().getTime() + CODE_TTL_MS).toISOString(),
      })
      .select("id")
      .single()
  );

  return {
    redirect: redirectWith(request.redirect_uri, { code, state, iss: origin }),
  };
}
