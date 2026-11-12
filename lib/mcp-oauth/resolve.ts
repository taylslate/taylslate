// Resolves Authorization: Bearer ts_oat_<64 hex> for POST /api/v1/mcp only.
// Other /api/v1 routes never call this. They keep rejecting the prefix.

import { ApiAuthError } from "@/lib/api/errors";
import { scopesFromDb, type ApiScope } from "@/lib/api/keys";
import { assertProfileApiAccess } from "@/lib/api/plan-gate";
import { recordEvent } from "@/lib/data/event-log";
import { oauthNow, requireSiteOrigin, resourceUrl } from "@/lib/mcp-oauth/config";
import { oauth, oauthAdmin } from "@/lib/mcp-oauth/errors";
import { hashToken } from "@/lib/mcp-oauth/tokens";

export interface ResolvedOAuthRequest {
  brandId: string;
  scopes: ApiScope[];
  keyId: string;
}

interface TokenRow {
  id: string;
  kind: string;
  user_id: string;
  api_key_id: string;
  scopes: unknown;
  resource: string;
  expires_at: string;
  revoked_at: string | null;
}

interface KeyRow {
  id: string;
  brand_id: string;
  scopes: unknown;
  revoked_at: string | null;
}

interface ProfileRow {
  id: string;
  role?: unknown;
  plan?: unknown;
}

function bearerToken(req: Request): string | null {
  const header = req.headers.get("authorization");
  if (!header) return null;
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
  return match?.[1] ?? null;
}

function requestPath(req: Request): string {
  try {
    return new URL(req.url).pathname;
  } catch {
    return "";
  }
}

function invalid(): ApiAuthError {
  return new ApiAuthError(401, "Invalid API key.");
}

export async function resolveOAuthAccessToken(req: Request): Promise<ResolvedOAuthRequest> {
  const token = bearerToken(req);
  if (!token || !token.startsWith("ts_oat_")) throw invalid();

  const origin = requireSiteOrigin();
  const resource = resourceUrl(origin);
  const row = (await oauth(
    oauthAdmin()
      .from("mcp_oauth_tokens")
      .select("id, kind, user_id, api_key_id, scopes, resource, expires_at, revoked_at")
      .eq("token_hash", hashToken(token))
      .maybeSingle()
  )) as TokenRow | null;

  if (!row || row.kind !== "access" || row.revoked_at) throw invalid();
  const expires = Date.parse(row.expires_at);
  if (!Number.isFinite(expires) || expires <= oauthNow().getTime()) throw invalid();
  if (row.resource !== resource) throw invalid();

  const key = (await oauth(
    oauthAdmin()
      .from("api_keys")
      .select("id, brand_id, scopes, revoked_at")
      .eq("id", row.api_key_id)
      .maybeSingle()
  )) as KeyRow | null;
  if (!key || key.revoked_at) throw invalid();
  if (key.brand_id.toLowerCase() !== row.user_id.toLowerCase()) throw invalid();

  const profile = (await oauth(
    oauthAdmin().from("profiles").select("id, role, plan").eq("id", row.user_id).maybeSingle()
  )) as ProfileRow | null;
  if (!profile || profile.id.toLowerCase() !== row.user_id.toLowerCase()) {
    throw new ApiAuthError(401, "API key is not tied to a user.");
  }
  assertProfileApiAccess(profile);

  const scopes = scopesFromDb(row.scopes).filter((scope) => scopesFromDb(key.scopes).includes(scope));
  await recordEvent({
    customerId: row.user_id,
    operationType: "api_call",
    metadata: {
      key_id: key.id,
      path: requestPath(req),
      scopes,
      auth: "oauth",
    },
  });

  return { brandId: row.user_id, scopes, keyId: key.id };
}
