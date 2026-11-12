import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OauthTestAdmin } from "@/lib/mcp-oauth/test-store";
import { SECRET_DB } from "@/lib/mcp-oauth/test-store";

const bridge = vi.hoisted(() => ({ admin: null as OauthTestAdmin | null }));

vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: {
    from: (table: string) => bridge.admin!.from(table),
    rpc: (name: string, args: Record<string, unknown>) => bridge.admin!.rpc(name, args),
  },
}));

import { OPTIONS, POST } from "./route";
import { createOauthTestAdmin, installOauthEnv, jsonPost } from "@/lib/mcp-oauth/test-store";

const SAVED_SITE = process.env.NEXT_PUBLIC_SITE_URL;

beforeEach(() => {
  bridge.admin = createOauthTestAdmin();
  installOauthEnv();
});

afterEach(() => {
  if (SAVED_SITE === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
  else process.env.NEXT_PUBLIC_SITE_URL = SAVED_SITE;
});

function post(body: unknown, headers: Record<string, string> = {}): Promise<Response> {
  return POST(jsonPost("https://www.taylslate.com/api/oauth/register", body, headers));
}

describe("POST /api/oauth/register", () => {
  it("accepts https, loopback http, and cursor, and returns no secret", async () => {
    const response = await post({
      client_name: "  Cursor\u0007  ",
      redirect_uris: [
        "https://example.com/callback",
        "http://127.0.0.1:9/cb",
        "http://[::1]:8080/cb",
        "cursor://anysphere.cursor-mcp/oauth/callback",
      ],
      client_secret: "do-not-store",
      extra: true,
    });
    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.token_endpoint_auth_method).toBe("none");
    expect(body.client_secret).toBeUndefined();
    expect(String(body.client_id)).toMatch(/^tsc_[0-9a-f]{32}$/);
    expect(body.client_name).toBe("Cursor");
    expect(body.grant_types).toEqual(["authorization_code", "refresh_token"]);
    expect(body.response_types).toEqual(["code"]);
    const stored = bridge.admin!.tables.mcp_oauth_clients[0];
    expect(stored.client_secret).toBeUndefined();
    expect(JSON.stringify(stored)).not.toContain("do-not-store");
    expect(JSON.stringify(body)).not.toContain(SECRET_DB);
  });

  it("rejects banned redirects, too many URIs, a secret auth method, and a bad grant", async () => {
    for (const redirect_uris of [
      ["javascript:alert(1)"],
      ["data:text/html,hi"],
      ["file:///tmp/x"],
      ["http://example.com/cb"],
      ["https://example.com/cb#frag"],
      Array.from({ length: 6 }, (_, index) => `https://example.com/${index}`),
    ]) {
      const response = await post({ redirect_uris });
      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toBe("invalid_redirect_uri");
      expect(JSON.stringify(body)).not.toContain(SECRET_DB);
    }
    const secret = await post({
      redirect_uris: ["https://example.com/cb"],
      token_endpoint_auth_method: "client_secret_basic",
    });
    expect((await secret.json()).error).toBe("invalid_client_metadata");
    const grant = await post({
      redirect_uris: ["https://example.com/cb"],
      grant_types: ["client_credentials"],
    });
    expect((await grant.json()).error).toBe("invalid_client_metadata");
    const token = await post({
      redirect_uris: ["https://example.com/cb"],
      response_types: ["token"],
    });
    expect((await token.json()).error).toBe("invalid_client_metadata");
  });

  it("answers 429 when the rule is hit and 503 when the store errors", async () => {
    bridge.admin!.denyBuckets.add("mcp_oauth_register_ip_hour");
    const limited = await post({ redirect_uris: ["https://example.com/cb"] });
    expect(limited.status).toBe(429);
    expect(await limited.json()).toEqual({ error: "Too many requests. Try again later." });

    bridge.admin = createOauthTestAdmin();
    installOauthEnv();
    bridge.admin.rateError = { code: "XX000", message: SECRET_DB };
    const closed = await post({ redirect_uris: ["https://example.com/cb"] });
    expect(closed.status).toBe(503);
    expect(await closed.json()).toEqual({ error: "unavailable" });

    bridge.admin = createOauthTestAdmin();
    installOauthEnv();
    bridge.admin.missingTables.add("mcp_oauth_clients");
    const missing = await post({ redirect_uris: ["https://example.com/cb"] });
    expect(missing.status).toBe(503);
    const body = await missing.json();
    expect(body).toEqual({
      error: "temporarily_unavailable",
      error_description: "The authorization server is temporarily unavailable.",
    });
    expect(JSON.stringify(body)).not.toContain(SECRET_DB);
  });

  it("answers 503 when the origin is missing and allows CORS preflight", async () => {
    delete process.env.NEXT_PUBLIC_SITE_URL;
    const response = await post({ redirect_uris: ["https://example.com/cb"] });
    expect(response.status).toBe(503);
    expect((await response.json()).error).toBe("temporarily_unavailable");
    const preflight = OPTIONS();
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-origin")).toBe("*");
    expect(preflight.headers.get("access-control-allow-credentials")).toBeNull();
  });
});
