// Authorization code exchange, refresh rotation, and revocation.
// Plaintext tokens are returned from issuePair and nowhere else.

import { randomUUID } from "node:crypto";
import { ApiAuthError } from "@/lib/api/errors";
import { createKey, scopesFromDb, type ApiScope } from "@/lib/api/keys";
import { assertProfileApiAccess } from "@/lib/api/plan-gate";
import { findClientByPublicId, narrowScopes } from "@/lib/mcp-oauth/clients";
import {
  ACCESS_TTL_SEC,
  oauthNow,
  REFRESH_TTL_SEC,
  requireSiteOrigin,
  resourceUrl,
} from "@/lib/mcp-oauth/config";
import { oauth, oauthAdmin, OAuthRequestError, OAuthUnavailableError } from "@/lib/mcp-oauth/errors";
import { verifyPkce } from "@/lib/mcp-oauth/pkce";
import { CLIENT_ID_RE, hashToken, newAccessToken, newRefreshToken } from "@/lib/mcp-oauth/tokens";

export interface TokenResponse {
  access_token: string;
  token_type: "Bearer";
  expires_in: number;
  refresh_token: string;
  scope: string;
}

interface CodeRow {
  id: string;
  code_hash: string;
  request_id: string;
  client_id: string;
  user_id: string;
  redirect_uri: string;
  code_challenge: string;
  scopes: unknown;
  resource: string;
  expires_at: string;
  used_at: string | null;
}

interface TokenRow {
  id: string;
  token_hash: string;
  kind: string;
  family_id: string;
  code_id: string;
  client_id: string;
  user_id: string;
  api_key_id: string;
  scopes: unknown;
  resource: string;
  expires_at: string;
  used_at: string | null;
  revoked_at: string | null;
}

interface ProfileRow {
  id: string;
  role?: unknown;
  plan?: unknown;
}

interface KeyRow {
  id: string;
  brand_id: string;
  scopes: unknown;
  revoked_at: string | null;
}

function invalidGrant(): OAuthRequestError {
  return new OAuthRequestError("invalid_grant");
}

function invalidClient(): OAuthRequestError {
  return new OAuthRequestError("invalid_client");
}

function mcpKeyName(clientName: string): string {
  return `MCP: ${clientName}`.slice(0, 60);
}

async function loadProfile(userId: string): Promise<ProfileRow | null> {
  return (await oauth(
    oauthAdmin().from("profiles").select("id, role, plan").eq("id", userId).maybeSingle()
  )) as ProfileRow | null;
}

async function assertProfile(userId: string): Promise<void> {
  const profile = await loadProfile(userId);
  if (!profile || profile.id.toLowerCase() !== userId.toLowerCase()) throw invalidGrant();
  try {
    assertProfileApiAccess(profile);
  } catch (err) {
    if (err instanceof ApiAuthError) throw invalidGrant();
    throw err;
  }
}

async function assertLiveKey(apiKeyId: string, userId: string): Promise<void> {
  const key = (await oauth(
    oauthAdmin()
      .from("api_keys")
      .select("id, brand_id, scopes, revoked_at")
      .eq("id", apiKeyId)
      .maybeSingle()
  )) as KeyRow | null;
  if (!key || key.revoked_at) throw invalidGrant();
  if (key.brand_id.toLowerCase() !== userId.toLowerCase()) throw invalidGrant();
  await assertProfile(userId);
}

async function revokeFamily(familyId: string): Promise<void> {
  const now = oauthNow().toISOString();
  await oauth(
    oauthAdmin().from("mcp_oauth_tokens").update({ revoked_at: now }).eq("family_id", familyId)
  );
}

async function revokeByCode(codeId: string): Promise<void> {
  const now = oauthNow().toISOString();
  await oauth(
    oauthAdmin().from("mcp_oauth_tokens").update({ revoked_at: now }).eq("code_id", codeId)
  );
}

async function issuePair(input: {
  familyId: string;
  codeId: string;
  clientId: string;
  userId: string;
  apiKeyId: string;
  scopes: ApiScope[];
  resource: string;
}): Promise<TokenResponse> {
  const access = newAccessToken();
  const refresh = newRefreshToken();
  const now = oauthNow();
  await oauth(
    oauthAdmin()
      .from("mcp_oauth_tokens")
      .insert([
        {
          token_hash: hashToken(access),
          kind: "access",
          family_id: input.familyId,
          code_id: input.codeId,
          client_id: input.clientId,
          user_id: input.userId,
          api_key_id: input.apiKeyId,
          scopes: input.scopes,
          resource: input.resource,
          expires_at: new Date(now.getTime() + ACCESS_TTL_SEC * 1000).toISOString(),
        },
        {
          token_hash: hashToken(refresh),
          kind: "refresh",
          family_id: input.familyId,
          code_id: input.codeId,
          client_id: input.clientId,
          user_id: input.userId,
          api_key_id: input.apiKeyId,
          scopes: input.scopes,
          resource: input.resource,
          expires_at: new Date(now.getTime() + REFRESH_TTL_SEC * 1000).toISOString(),
        },
      ])
      .select("id")
  );
  return {
    access_token: access,
    token_type: "Bearer",
    expires_in: ACCESS_TTL_SEC,
    refresh_token: refresh,
    scope: input.scopes.join(" "),
  };
}

async function requireClient(clientId: string) {
  if (!CLIENT_ID_RE.test(clientId)) throw invalidClient();
  const client = await findClientByPublicId(clientId);
  if (!client) throw invalidClient();
  return client;
}

function requireParam(params: URLSearchParams, name: string): string {
  const value = params.get(name);
  if (value == null || value.length === 0) throw new OAuthRequestError("invalid_request");
  return value;
}

export async function exchangeAuthorizationCode(params: URLSearchParams): Promise<TokenResponse> {
  const code = requireParam(params, "code");
  const clientId = requireParam(params, "client_id");
  const redirectUri = requireParam(params, "redirect_uri");
  const verifier = requireParam(params, "code_verifier");
  const client = await requireClient(clientId);
  requireSiteOrigin();

  const now = oauthNow().toISOString();
  const marked = (await oauth(
    oauthAdmin()
      .from("mcp_oauth_codes")
      .update({ used_at: now })
      .eq("code_hash", hashToken(code))
      .is("used_at", null)
      .gt("expires_at", now)
      .select("*")
      .maybeSingle()
  )) as CodeRow | null;

  if (!marked) {
    const existing = (await oauth(
      oauthAdmin().from("mcp_oauth_codes").select("*").eq("code_hash", hashToken(code)).maybeSingle()
    )) as CodeRow | null;
    if (existing?.used_at) await revokeByCode(existing.id);
    throw invalidGrant();
  }

  if (marked.client_id !== client.id || marked.redirect_uri !== redirectUri) throw invalidGrant();
  if (!verifyPkce(verifier, marked.code_challenge)) throw invalidGrant();

  const resource = resourceUrl(requireSiteOrigin());
  if (marked.resource !== resource) throw invalidGrant();

  await assertProfile(marked.user_id);
  const scopes = scopesFromDb(marked.scopes);
  if (scopes.length === 0) throw invalidGrant();

  let created: { id: string };
  try {
    created = await createKey({
      brandId: marked.user_id,
      name: mcpKeyName(client.client_name),
      scopes,
    });
  } catch (err) {
    if (err instanceof OAuthUnavailableError) throw err;
    console.warn("[mcp-oauth]", "key");
    throw new OAuthUnavailableError("key");
  }

  return issuePair({
    familyId: randomUUID(),
    codeId: marked.id,
    clientId: client.id,
    userId: marked.user_id,
    apiKeyId: created.id,
    scopes,
    resource,
  });
}

export async function exchangeRefreshToken(params: URLSearchParams): Promise<TokenResponse> {
  const refreshToken = requireParam(params, "refresh_token");
  const clientId = requireParam(params, "client_id");
  const client = await requireClient(clientId);
  const scopeParam = params.get("scope");

  const existing = (await oauth(
    oauthAdmin()
      .from("mcp_oauth_tokens")
      .select("*")
      .eq("token_hash", hashToken(refreshToken))
      .maybeSingle()
  )) as TokenRow | null;

  if (!existing || existing.kind !== "refresh" || existing.client_id !== client.id) {
    throw invalidGrant();
  }
  if (existing.used_at) {
    await revokeFamily(existing.family_id);
    throw invalidGrant();
  }
  if (existing.revoked_at) throw invalidGrant();
  const expires = Date.parse(existing.expires_at);
  if (!Number.isFinite(expires) || expires <= oauthNow().getTime()) throw invalidGrant();

  const scopes = narrowScopes(scopesFromDb(existing.scopes), scopeParam);
  if (!scopes || scopes.length === 0) throw new OAuthRequestError("invalid_scope");

  const now = oauthNow().toISOString();
  const marked = (await oauth(
    oauthAdmin()
      .from("mcp_oauth_tokens")
      .update({ used_at: now })
      .eq("id", existing.id)
      .eq("kind", "refresh")
      .eq("client_id", client.id)
      .is("used_at", null)
      .is("revoked_at", null)
      .gt("expires_at", now)
      .select("id")
      .maybeSingle()
  )) as { id: string } | null;
  if (!marked) {
    await revokeFamily(existing.family_id);
    throw invalidGrant();
  }

  await assertLiveKey(existing.api_key_id, existing.user_id);
  const resource = resourceUrl(requireSiteOrigin());
  if (existing.resource !== resource) throw invalidGrant();

  const issued = await issuePair({
    familyId: existing.family_id,
    codeId: existing.code_id,
    clientId: client.id,
    userId: existing.user_id,
    apiKeyId: existing.api_key_id,
    scopes,
    resource,
  });

  const after = (await oauth(
    oauthAdmin().from("mcp_oauth_tokens").select("revoked_at").eq("id", existing.id).maybeSingle()
  )) as { revoked_at: string | null } | null;
  if (after?.revoked_at) {
    await revokeFamily(existing.family_id);
    throw invalidGrant();
  }
  return issued;
}

export async function exchangeToken(params: URLSearchParams): Promise<TokenResponse> {
  const grant = params.get("grant_type");
  if (grant === "authorization_code") return exchangeAuthorizationCode(params);
  if (grant === "refresh_token") return exchangeRefreshToken(params);
  if (grant == null || grant.length === 0) throw new OAuthRequestError("invalid_request");
  throw new OAuthRequestError("unsupported_grant_type");
}

export async function revokePresentedToken(token: string, clientId: string): Promise<void> {
  if (!token || !CLIENT_ID_RE.test(clientId)) return;
  const client = await findClientByPublicId(clientId);
  if (!client) return;
  const row = (await oauth(
    oauthAdmin()
      .from("mcp_oauth_tokens")
      .select("id, kind, family_id, client_id")
      .eq("token_hash", hashToken(token))
      .maybeSingle()
  )) as Pick<TokenRow, "id" | "kind" | "family_id" | "client_id"> | null;
  if (!row || row.client_id !== client.id) return;
  const now = oauthNow().toISOString();
  if (row.kind === "refresh") {
    await revokeFamily(row.family_id);
    return;
  }
  await oauth(
    oauthAdmin().from("mcp_oauth_tokens").update({ revoked_at: now }).eq("id", row.id)
  );
}
