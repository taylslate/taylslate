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
import { createOauthTestAdmin, formPost, installOauthEnv } from "@/lib/mcp-oauth/test-store";

const SAVED_SITE = process.env.NEXT_PUBLIC_SITE_URL;

beforeEach(() => {
  bridge.admin = createOauthTestAdmin();
  installOauthEnv();
});

afterEach(() => {
  if (SAVED_SITE === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
  else process.env.NEXT_PUBLIC_SITE_URL = SAVED_SITE;
});

describe("POST /api/oauth/token", () => {
  it("rejects a non-form body and an unsupported grant", async () => {
    const json = await POST(
      new Request("https://www.taylslate.com/api/oauth/token", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      })
    );
    expect(json.status).toBe(400);
    expect((await json.json()).error).toBe("invalid_request");

    const grant = await POST(
      formPost("https://www.taylslate.com/api/oauth/token", {
        grant_type: "client_credentials",
        client_id: `tsc_${"ab".repeat(16)}`,
      })
    );
    expect(grant.status).toBe(400);
    expect((await grant.json()).error).toBe("unsupported_grant_type");
    expect(grant.headers.get("cache-control")).toBe("no-store");
    expect(grant.headers.get("pragma")).toBe("no-cache");
    expect(grant.headers.get("access-control-allow-origin")).toBe("*");
  });

  it("answers 401 for an unknown client id shape", async () => {
    const response = await POST(
      formPost("https://www.taylslate.com/api/oauth/token", {
        grant_type: "authorization_code",
        code: `tsac_${"ab".repeat(32)}`,
        client_id: "nope",
        redirect_uri: "https://app.example/callback",
        code_verifier: "a".repeat(43),
      })
    );
    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.error).toBe("invalid_client");
    expect(JSON.stringify(body)).not.toContain(SECRET_DB);
  });

  it("answers 429 when either rule is hit and 503 when the store errors", async () => {
    bridge.admin!.denyBuckets.add("mcp_oauth_token_ip_min");
    const byIp = await POST(
      formPost("https://www.taylslate.com/api/oauth/token", { grant_type: "authorization_code" })
    );
    expect(byIp.status).toBe(429);

    bridge.admin = createOauthTestAdmin();
    installOauthEnv();
    bridge.admin.denyBuckets.add("mcp_oauth_token_client_hour");
    const byClient = await POST(
      formPost("https://www.taylslate.com/api/oauth/token", {
        grant_type: "authorization_code",
        client_id: `tsc_${"ab".repeat(16)}`,
      })
    );
    expect(byClient.status).toBe(429);
    expect(await byClient.json()).toEqual({ error: "Too many requests. Try again later." });

    bridge.admin = createOauthTestAdmin();
    installOauthEnv();
    bridge.admin.rateError = { code: "XX000", message: SECRET_DB };
    const closed = await POST(formPost("https://www.taylslate.com/api/oauth/token", { grant_type: "refresh_token" }));
    expect(closed.status).toBe(503);
    expect(await closed.json()).toEqual({ error: "unavailable" });
  });

  it("answers 503 when the origin is missing and allows preflight", async () => {
    delete process.env.NEXT_PUBLIC_SITE_URL;
    const response = await POST(formPost("https://www.taylslate.com/api/oauth/token", { grant_type: "authorization_code" }));
    expect(response.status).toBe(503);
    expect((await response.json()).error).toBe("temporarily_unavailable");
    expect(OPTIONS().status).toBe(204);
    expect(OPTIONS().headers.get("access-control-allow-origin")).toBe("*");
  });
});
