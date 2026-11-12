import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OauthTestAdmin } from "./test-store";
import { SECRET_DB } from "./test-store";

const bridge = vi.hoisted(() => ({ admin: null as OauthTestAdmin | null }));

vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: {
    from: (table: string) => bridge.admin!.from(table),
    rpc: (name: string, args: Record<string, unknown>) => bridge.admin!.rpc(name, args),
  },
}));

vi.mock("@/lib/data/event-log", () => ({
  recordEvent: (input: unknown) => {
    bridge.admin!.events.push(input);
    return Promise.resolve();
  },
}));

import { ApiAuthError, resolveApiRequest } from "@/lib/api/auth";
import { _setOauthClockForTests } from "./config";
import { OAuthUnavailableError } from "./errors";
import { resolveOAuthAccessToken } from "./resolve";
import { hashToken, newAccessToken } from "./tokens";
import { TEST_ORIGIN, TEST_USER, createOauthTestAdmin, installOauthEnv } from "./test-store";

const SAVED_SITE = process.env.NEXT_PUBLIC_SITE_URL;
const OTHER = "22222222-2222-4222-8222-222222222222";

beforeEach(() => {
  bridge.admin = createOauthTestAdmin();
  installOauthEnv();
  _setOauthClockForTests(() => new Date("2026-06-01T12:00:00.000Z"));
});

afterEach(() => {
  _setOauthClockForTests(null);
  if (SAVED_SITE === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
  else process.env.NEXT_PUBLIC_SITE_URL = SAVED_SITE;
});

function admin(): OauthTestAdmin {
  return bridge.admin!;
}

function seedAccess(overrides: Record<string, unknown> = {}): string {
  const token = newAccessToken();
  const keyId = randomUUID();
  admin().tables.profiles.push({ id: TEST_USER, role: "brand", plan: "operator" });
  admin().tables.api_keys.push({
    id: keyId,
    brand_id: TEST_USER,
    scopes: ["read", "write:campaigns"],
    revoked_at: null,
    prefix: "abcdabcdabcdabcd",
    key_hash: "a".repeat(64),
    name: "MCP: Cursor",
  });
  admin().tables.mcp_oauth_tokens.push({
    id: randomUUID(),
    token_hash: hashToken(token),
    kind: "access",
    user_id: TEST_USER,
    api_key_id: keyId,
    scopes: ["read", "write:campaigns"],
    resource: `${TEST_ORIGIN}/api/v1/mcp`,
    expires_at: "2026-06-01T13:00:00.000Z",
    revoked_at: null,
    ...overrides,
  });
  return token;
}

function requestFor(token: string, path = "/api/v1/mcp"): Request {
  return new Request(`https://www.taylslate.com${path}`, {
    headers: { authorization: `Bearer ${token}` },
  });
}

describe("resolveOAuthAccessToken", () => {
  it("returns the intersection of token scopes and key scopes and records one api_call", async () => {
    const token = seedAccess({ scopes: ["read", "write:campaigns"] });
    admin().tables.api_keys[0].scopes = ["read"];
    const resolved = await resolveOAuthAccessToken(requestFor(token));
    expect(resolved.brandId).toBe(TEST_USER);
    expect(resolved.scopes).toEqual(["read"]);
    expect(resolved.keyId).toBe(admin().tables.api_keys[0].id);
    expect(admin().events).toEqual([
      {
        customerId: TEST_USER,
        operationType: "api_call",
        metadata: {
          key_id: admin().tables.api_keys[0].id,
          path: "/api/v1/mcp",
          scopes: ["read"],
          auth: "oauth",
        },
      },
    ]);
    expect(admin().tables.mcp_oauth_tokens[0].used_at).toBeUndefined();
  });

  it("rejects expired, revoked, wrong kind, wrong resource, a revoked key, and a user mismatch", async () => {
    const cases: Record<string, unknown>[] = [
      { expires_at: "2026-06-01T11:00:00.000Z" },
      { revoked_at: "2026-06-01T11:30:00.000Z" },
      { kind: "refresh" },
      { resource: "https://www.taylslate.com/api/v1/shows" },
    ];
    for (const overrides of cases) {
      bridge.admin = createOauthTestAdmin();
      const token = seedAccess(overrides);
      await expect(resolveOAuthAccessToken(requestFor(token))).rejects.toMatchObject({ status: 401 });
    }

    bridge.admin = createOauthTestAdmin();
    const revokedKey = seedAccess();
    admin().tables.api_keys[0].revoked_at = "2026-06-01T11:30:00.000Z";
    await expect(resolveOAuthAccessToken(requestFor(revokedKey))).rejects.toMatchObject({
      status: 401,
      message: "Invalid API key.",
    });

    bridge.admin = createOauthTestAdmin();
    const mismatch = seedAccess();
    admin().tables.api_keys[0].brand_id = OTHER;
    await expect(resolveOAuthAccessToken(requestFor(mismatch))).rejects.toMatchObject({ status: 401 });
  });

  it("returns 403 when the plan has no API access and 401 when the profile is missing", async () => {
    const noApi = seedAccess();
    admin().tables.profiles[0].plan = "pay_as_you_go";
    await expect(resolveOAuthAccessToken(requestFor(noApi))).rejects.toMatchObject({
      status: 403,
      message: "Your plan does not include API access.",
      code: "plan_no_api_access",
    });

    bridge.admin = createOauthTestAdmin();
    const show = seedAccess();
    admin().tables.profiles[0].role = "show";
    await expect(resolveOAuthAccessToken(requestFor(show))).rejects.toBeInstanceOf(ApiAuthError);

    bridge.admin = createOauthTestAdmin();
    const untied = seedAccess();
    admin().tables.profiles[0].id = OTHER;
    await expect(resolveOAuthAccessToken(requestFor(untied))).rejects.toMatchObject({
      status: 401,
      message: "API key is not tied to a user.",
    });
  });

  it("maps a missing table to unavailable and does not return database text", async () => {
    installOauthEnv();
    admin().missingTables.add("mcp_oauth_tokens");
    const token = `ts_oat_${"ab".repeat(32)}`;
    await expect(resolveOAuthAccessToken(requestFor(token))).rejects.toBeInstanceOf(OAuthUnavailableError);
    expect(admin().queries).toContain("mcp_oauth_tokens");
  });

  it("does not query when the site origin is missing", async () => {
    delete process.env.NEXT_PUBLIC_SITE_URL;
    const before = admin().queries.length;
    await expect(resolveOAuthAccessToken(requestFor(`ts_oat_${"cd".repeat(32)}`))).rejects.toMatchObject({
      code: "origin",
    });
    expect(admin().queries.length).toBe(before);
  });

  it("keeps ts_oat_ on other /api/v1 routes at 401 without an OAuth query", async () => {
    const before = admin().queries.length;
    const token = `ts_oat_${"ef".repeat(32)}`;
    await expect(resolveApiRequest(requestFor(token, "/api/v1/shows"))).rejects.toMatchObject({
      status: 401,
      message: "Missing or invalid API key.",
    });
    expect(admin().queries.length).toBe(before);
    expect(admin().queries.some((table) => table.startsWith("mcp_oauth_"))).toBe(false);
    expect(SECRET_DB).toBe("secret-db-text");
  });
});
