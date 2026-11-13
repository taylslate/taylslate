// Site origin and OAuth endpoints. No new environment variable.
// A missing or non-https origin makes every OAuth route unavailable.
// Bearer API keys do not call this.

import { API_SCOPES, type ApiScope } from "@/lib/api/keys";
import { OAuthUnavailableError } from "@/lib/mcp-oauth/errors";

export const OAUTH_SCOPES: readonly ApiScope[] = API_SCOPES;

export const REQUEST_TTL_MS = 10 * 60 * 1000;
export const CODE_TTL_MS = 5 * 60 * 1000;
export const ACCESS_TTL_SEC = 60 * 60;
export const REFRESH_TTL_SEC = 30 * 24 * 60 * 60;

export const OAUTH_LIMITS = {
  registerIpHour: { bucket: "mcp_oauth_register_ip_hour", max: 10, windowSeconds: 60 * 60 },
  registerIpDay: { bucket: "mcp_oauth_register_ip_day", max: 50, windowSeconds: 24 * 60 * 60 },
  authorizeIpHour: { bucket: "mcp_oauth_authorize_ip_hour", max: 60, windowSeconds: 60 * 60 },
  consentUserHour: { bucket: "mcp_oauth_consent_user_hour", max: 20, windowSeconds: 60 * 60 },
  tokenIpMin: { bucket: "mcp_oauth_token_ip_min", max: 30, windowSeconds: 60 },
  tokenClientHour: { bucket: "mcp_oauth_token_client_hour", max: 300, windowSeconds: 60 * 60 },
  revokeIpMin: { bucket: "mcp_oauth_revoke_ip_min", max: 30, windowSeconds: 60 },
} as const;

let clock: () => Date = () => new Date();

export function oauthNow(): Date {
  return clock();
}

/** Pins time in tests. Pass null to restore the system clock. */
export function _setOauthClockForTests(next: (() => Date) | null): void {
  clock = next ?? (() => new Date());
}

export function siteOrigin(): string | null {
  const raw = process.env.NEXT_PUBLIC_SITE_URL;
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim().replace(/\/+$/, "");
  if (!trimmed) return null;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.username || url.password || url.search || url.hash) return null;
  if (url.pathname !== "/" && url.pathname !== "") return null;
  if (url.protocol === "https:") return url.origin;
  if (
    url.protocol === "http:" &&
    url.hostname === "localhost" &&
    process.env.NODE_ENV !== "production"
  ) {
    return url.origin;
  }
  return null;
}

export function requireSiteOrigin(): string {
  const origin = siteOrigin();
  if (!origin) throw new OAuthUnavailableError("origin");
  return origin;
}

export function resourceUrl(origin: string): string {
  return `${origin}/api/v1/mcp`;
}

export function protectedResourceMetadata(): Record<string, unknown> | null {
  const origin = siteOrigin();
  if (!origin) return null;
  return {
    resource: resourceUrl(origin),
    authorization_servers: [origin],
    scopes_supported: [...OAUTH_SCOPES],
    bearer_methods_supported: ["header"],
    resource_name: "Taylslate",
  };
}

export function authorizationServerMetadata(): Record<string, unknown> | null {
  const origin = siteOrigin();
  if (!origin) return null;
  return {
    issuer: origin,
    authorization_endpoint: `${origin}/api/oauth/authorize`,
    token_endpoint: `${origin}/api/oauth/token`,
    registration_endpoint: `${origin}/api/oauth/register`,
    revocation_endpoint: `${origin}/api/oauth/revoke`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    authorization_response_iss_parameter_supported: true,
    scopes_supported: [...OAUTH_SCOPES],
  };
}

export function wwwAuthenticate(presented: boolean): string {
  const origin = siteOrigin();
  if (!origin) return "Bearer";
  const metadata = `${origin}/.well-known/oauth-protected-resource/api/v1/mcp`;
  if (presented) {
    return `Bearer error="invalid_token", resource_metadata="${metadata}"`;
  }
  return `Bearer resource_metadata="${metadata}"`;
}

export function metadataJson(body: Record<string, unknown>): Response {
  const headers = new Headers();
  headers.set("Cache-Control", "public, max-age=3600");
  headers.set("Access-Control-Allow-Origin", "*");
  headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
  return Response.json(body, { status: 200, headers });
}
