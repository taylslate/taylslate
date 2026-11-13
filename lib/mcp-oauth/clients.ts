// Dynamic client registration. Public clients only. No secret is stored or returned.

import { isApiScope, type ApiScope } from "@/lib/api/keys";
import { oauth, oauthAdmin, OAuthRequestError, OAuthUnavailableError } from "@/lib/mcp-oauth/errors";
import { newClientId } from "@/lib/mcp-oauth/tokens";

const PRIVATE_SCHEME = /^[a-z][a-z0-9+.-]{1,40}$/;
const BANNED_SCHEMES = new Set([
  "javascript",
  "data",
  "file",
  "vbscript",
  "about",
  "blob",
  "ftp",
  "ws",
  "wss",
  "mailto",
  "tel",
  "http",
  "https",
]);

const GRANT_TYPES = new Set(["authorization_code", "refresh_token"]);

export interface RegisteredClient {
  client_id: string;
  client_id_issued_at: number;
  client_name: string;
  redirect_uris: string[];
  grant_types: string[];
  response_types: string[];
  token_endpoint_auth_method: "none";
}

export interface ClientRecord {
  id: string;
  client_id: string;
  client_name: string;
  redirect_uris: string[];
}

function metadataError(): OAuthRequestError {
  return new OAuthRequestError("invalid_client_metadata");
}

function redirectError(): OAuthRequestError {
  return new OAuthRequestError("invalid_redirect_uri");
}

function isLoopback(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]";
}

export function isAllowedRedirectUri(raw: string): boolean {
  if (typeof raw !== "string") return false;
  if (raw.length < 1 || raw.length > 2000) return false;
  if (raw.includes("#") || /\s/.test(raw)) return false;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.hash || url.username || url.password) return false;
  if (url.protocol === "https:") return true;
  if (url.protocol === "http:") return isLoopback(url.hostname);
  const scheme = url.protocol.replace(/:$/, "").toLowerCase();
  if (!PRIVATE_SCHEME.test(scheme)) return false;
  if (BANNED_SCHEMES.has(scheme)) return false;
  return true;
}

function parseRedirects(value: unknown): string[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 5) throw redirectError();
  const out: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string" || !isAllowedRedirectUri(entry)) throw redirectError();
    if (!out.includes(entry)) out.push(entry);
  }
  if (out.length < 1) throw redirectError();
  return out;
}

function parseGrantTypes(value: unknown, present: boolean): string[] {
  if (!present) return ["authorization_code", "refresh_token"];
  if (!Array.isArray(value) || value.length < 1) throw metadataError();
  const out: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string" || !GRANT_TYPES.has(entry)) throw metadataError();
    if (!out.includes(entry)) out.push(entry);
  }
  if (out.length < 1) throw metadataError();
  return out;
}

function parseResponseTypes(value: unknown, present: boolean): string[] {
  if (!present) return ["code"];
  if (!Array.isArray(value) || value.length !== 1 || value[0] !== "code") throw metadataError();
  return ["code"];
}

function parseAuthMethod(value: unknown, present: boolean): "none" {
  if (!present) return "none";
  if (value !== "none") throw metadataError();
  return "none";
}

export function parseClientName(value: unknown, present: boolean): string {
  if (!present) return "MCP client";
  if (typeof value !== "string") throw metadataError();
  // Format characters (bidi overrides, zero-width joiners) can disguise a name.
  const cleaned = value.replace(/[\u0000-\u001F\u007F\p{Cf}]/gu, "").trim();
  if (cleaned.length < 1 || cleaned.length > 100) throw metadataError();
  return cleaned;
}

export function parseScopeList(value: string | null, defaultRead: boolean): ApiScope[] | null {
  if (value == null || value.trim() === "") {
    return defaultRead ? ["read"] : null;
  }
  const parts = value.split(" ").filter((part) => part.length > 0);
  if (parts.length === 0) return defaultRead ? ["read"] : null;
  const scopes: ApiScope[] = [];
  for (const part of parts) {
    if (!isApiScope(part)) return null;
    if (!scopes.includes(part)) scopes.push(part);
  }
  return scopes.length > 0 ? scopes : null;
}

export function narrowScopes(current: readonly ApiScope[], requested: string | null): ApiScope[] | null {
  if (requested == null || requested.trim() === "") return [...current];
  const parsed = parseScopeList(requested, false);
  if (!parsed) return null;
  if (parsed.some((scope) => !current.includes(scope))) return null;
  return parsed;
}

export async function findClientByPublicId(clientId: string): Promise<ClientRecord | null> {
  const row = await oauth(
    oauthAdmin()
      .from("mcp_oauth_clients")
      .select("id, client_id, client_name, redirect_uris")
      .eq("client_id", clientId)
      .maybeSingle()
  );
  return row as ClientRecord | null;
}

export async function findClientById(id: string): Promise<ClientRecord | null> {
  const row = await oauth(
    oauthAdmin()
      .from("mcp_oauth_clients")
      .select("id, client_id, client_name, redirect_uris")
      .eq("id", id)
      .maybeSingle()
  );
  return row as ClientRecord | null;
}

export async function registerClient(body: unknown): Promise<RegisteredClient> {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw metadataError();
  const record = body as Record<string, unknown>;
  const redirectUris = parseRedirects(record.redirect_uris);
  const grantTypes = parseGrantTypes(record.grant_types, Object.prototype.hasOwnProperty.call(record, "grant_types"));
  const responseTypes = parseResponseTypes(
    record.response_types,
    Object.prototype.hasOwnProperty.call(record, "response_types")
  );
  parseAuthMethod(
    record.token_endpoint_auth_method,
    Object.prototype.hasOwnProperty.call(record, "token_endpoint_auth_method")
  );
  const clientName = parseClientName(
    record.client_name,
    Object.prototype.hasOwnProperty.call(record, "client_name")
  );

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const clientId = newClientId();
    try {
      const row = await oauth(
        oauthAdmin()
          .from("mcp_oauth_clients")
          .insert({
            client_id: clientId,
            client_name: clientName,
            redirect_uris: redirectUris,
          })
          .select("client_id, client_name, redirect_uris, created_at")
          .single()
      );
      const created = row as {
        client_id: string;
        client_name: string;
        redirect_uris: string[];
        created_at: string;
      };
      const issued = Date.parse(created.created_at);
      return {
        client_id: created.client_id,
        client_id_issued_at: Number.isFinite(issued) ? Math.floor(issued / 1000) : Math.floor(Date.now() / 1000),
        client_name: created.client_name,
        redirect_uris: created.redirect_uris,
        grant_types: grantTypes,
        response_types: responseTypes,
        token_endpoint_auth_method: "none",
      };
    } catch (err) {
      if (err instanceof OAuthUnavailableError && err.code === "23505" && attempt < 2) continue;
      throw err;
    }
  }
  throw new OAuthUnavailableError("23505");
}
