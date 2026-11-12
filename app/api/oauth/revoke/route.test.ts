import { randomUUID } from "node:crypto";
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
import { hashToken, newAccessToken, newRefreshToken } from "@/lib/mcp-oauth/tokens";
import { createOauthTestAdmin, formPost, installOauthEnv } from "@/lib/mcp-oauth/test-store";

const SAVED_SITE = process.env.NEXT_PUBLIC_SITE_URL;
const CLIENT = "33333333-3333-4333-8333-333333333333";
const CLIENT_ID = `tsc_${"ab".repeat(16)}`;

beforeEach(() => {
  bridge.admin = createOauthTestAdmin();
  installOauthEnv();
  bridge.admin.tables.mcp_oauth_clients.push({
    id: CLIENT,
    client_id: CLIENT_ID,
    client_name: "Cursor",
    redirect_uris: ["https://app.example/callback"],
  });
});

afterEach(() => {
  if (SAVED_SITE === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
  else process.env.NEXT_PUBLIC_SITE_URL = SAVED_SITE;
});

function revoke(token: string, extra: Record<string, string> = {}): Promise<Response> {
  return POST(
    formPost("https://www.taylslate.com/api/oauth/revoke", {
      token,
      client_id: CLIENT_ID,
      token_type_hint: "access_token",
      ...extra,
    })
  );
}

describe("POST /api/oauth/revoke", () => {
  it("returns 200 for an unknown token and revokes a refresh family", async () => {
    const unknown = await revoke(`ts_oat_${"11".repeat(32)}`);
    expect(unknown.status).toBe(200);
    expect(await unknown.json()).toEqual({});

    const access = newAccessToken();
    const refresh = newRefreshToken();
    const family = randomUUID();
    const base = {
      family_id: family,
      code_id: randomUUID(),
      client_id: CLIENT,
      user_id: "11111111-1111-4111-8111-111111111111",
      api_key_id: randomUUID(),
      scopes: ["read"],
      resource: "https://www.taylslate.com/api/v1/mcp",
      expires_at: "2026-07-01T00:00:00.000Z",
      revoked_at: null,
      used_at: null,
    };
    bridge.admin!.tables.mcp_oauth_tokens.push(
      { ...base, id: randomUUID(), token_hash: hashToken(access), kind: "access" },
      { ...base, id: randomUUID(), token_hash: hashToken(refresh), kind: "refresh" }
    );
    const response = await revoke(refresh, { token_type_hint: "refresh_token" });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({});
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(bridge.admin!.tables.mcp_oauth_tokens.every((row) => row.revoked_at)).toBe(true);
    expect(JSON.stringify(bridge.admin!.inserts)).not.toContain(refresh);
  });

  it("returns 200 for a non-form body, 429 when limited, and 503 when the table is missing", async () => {
    const mime = await POST(
      new Request("https://www.taylslate.com/api/oauth/revoke", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      })
    );
    expect(mime.status).toBe(200);
    expect(await mime.json()).toEqual({});

    bridge.admin!.denyBuckets.add("mcp_oauth_revoke_ip_min");
    const limited = await revoke("x");
    expect(limited.status).toBe(429);
    expect(await limited.json()).toEqual({ error: "Too many requests. Try again later." });

    bridge.admin = createOauthTestAdmin();
    installOauthEnv();
    bridge.admin.rateError = { code: "XX000", message: SECRET_DB };
    const closed = await revoke("x");
    expect(closed.status).toBe(503);
    expect(await closed.json()).toEqual({ error: "unavailable" });

    bridge.admin = createOauthTestAdmin();
    installOauthEnv();
    bridge.admin.tables.mcp_oauth_clients.push({
      id: CLIENT,
      client_id: CLIENT_ID,
      client_name: "Cursor",
      redirect_uris: ["https://app.example/callback"],
    });
    bridge.admin.missingTables.add("mcp_oauth_tokens");
    const missing = await revoke(`ts_oat_${"22".repeat(32)}`);
    expect(missing.status).toBe(503);
    const body = await missing.json();
    expect(body.error).toBe("temporarily_unavailable");
    expect(JSON.stringify(body)).not.toContain(SECRET_DB);
    expect(OPTIONS().headers.get("access-control-allow-origin")).toBe("*");
  });
});
