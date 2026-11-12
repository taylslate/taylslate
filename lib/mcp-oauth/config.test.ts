import { afterEach, describe, expect, it, vi } from "vitest";
import { API_SCOPES } from "@/lib/api/keys";
import {
  ACCESS_TTL_SEC,
  CODE_TTL_MS,
  REFRESH_TTL_SEC,
  REQUEST_TTL_MS,
  authorizationServerMetadata,
  protectedResourceMetadata,
  siteOrigin,
  wwwAuthenticate,
} from "./config";

const ORIGINAL = process.env.NEXT_PUBLIC_SITE_URL;

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
  else process.env.NEXT_PUBLIC_SITE_URL = ORIGINAL;
  vi.unstubAllEnvs();
});

describe("site origin", () => {
  it("trims a trailing slash and builds both metadata documents", () => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://www.taylslate.com/";
    expect(siteOrigin()).toBe("https://www.taylslate.com");
    expect(protectedResourceMetadata()).toEqual({
      resource: "https://www.taylslate.com/api/v1/mcp",
      authorization_servers: ["https://www.taylslate.com"],
      scopes_supported: [...API_SCOPES],
      bearer_methods_supported: ["header"],
      resource_name: "Taylslate",
    });
    expect(authorizationServerMetadata()).toEqual({
      issuer: "https://www.taylslate.com",
      authorization_endpoint: "https://www.taylslate.com/api/oauth/authorize",
      token_endpoint: "https://www.taylslate.com/api/oauth/token",
      registration_endpoint: "https://www.taylslate.com/api/oauth/register",
      revocation_endpoint: "https://www.taylslate.com/api/oauth/revoke",
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
      scopes_supported: [...API_SCOPES],
    });
    expect(wwwAuthenticate(false)).toBe(
      'Bearer resource_metadata="https://www.taylslate.com/.well-known/oauth-protected-resource/api/v1/mcp"'
    );
    expect(wwwAuthenticate(true)).toBe(
      'Bearer error="invalid_token", resource_metadata="https://www.taylslate.com/.well-known/oauth-protected-resource/api/v1/mcp"'
    );
  });

  it("rejects a missing origin, a non-https origin, and http localhost in production", () => {
    delete process.env.NEXT_PUBLIC_SITE_URL;
    expect(siteOrigin()).toBeNull();
    expect(protectedResourceMetadata()).toBeNull();
    expect(wwwAuthenticate(true)).toBe("Bearer");
    process.env.NEXT_PUBLIC_SITE_URL = "http://example.com";
    expect(siteOrigin()).toBeNull();
    vi.stubEnv("NODE_ENV", "production");
    process.env.NEXT_PUBLIC_SITE_URL = "http://localhost:3000";
    expect(siteOrigin()).toBeNull();
  });

  it("allows http localhost outside production and keeps the TTLs", () => {
    vi.stubEnv("NODE_ENV", "test");
    process.env.NEXT_PUBLIC_SITE_URL = "http://localhost:3000/";
    expect(siteOrigin()).toBe("http://localhost:3000");
    expect(REQUEST_TTL_MS).toBe(10 * 60 * 1000);
    expect(CODE_TTL_MS).toBe(5 * 60 * 1000);
    expect(ACCESS_TTL_SEC).toBe(3600);
    expect(REFRESH_TTL_SEC).toBe(30 * 24 * 60 * 60);
  });
});
