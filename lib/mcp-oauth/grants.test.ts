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

vi.mock("@/lib/data/queries", () => ({
  getAuthenticatedUser: () => Promise.resolve(bridge.admin!.user),
}));

import { GET as authorize } from "@/app/api/oauth/authorize/route";
import { POST as consent } from "@/app/api/oauth/consent/route";
import { POST as register } from "@/app/api/oauth/register/route";
import { POST as tokenRoute } from "@/app/api/oauth/token/route";
import { POST as mcp } from "@/app/api/v1/mcp/route";
import { _setOauthClockForTests } from "./config";
import { hashToken } from "./tokens";
import {
  TEST_ORIGIN,
  TEST_REDIRECT,
  TEST_USER,
  createOauthTestAdmin,
  formPost,
  installOauthEnv,
  jsonPost,
  pkcePair,
  seedOperator,
} from "./test-store";

const STATE = "oauth-state-do-not-log-9f3a";
const SAVED_SITE = process.env.NEXT_PUBLIC_SITE_URL;

let now = Date.parse("2026-06-01T12:00:00.000Z");

beforeEach(() => {
  bridge.admin = createOauthTestAdmin();
  seedOperator(bridge.admin);
  installOauthEnv();
  now = Date.parse("2026-06-01T12:00:00.000Z");
  _setOauthClockForTests(() => new Date(now));
});

afterEach(() => {
  _setOauthClockForTests(null);
  if (SAVED_SITE === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
  else process.env.NEXT_PUBLIC_SITE_URL = SAVED_SITE;
});

function admin(): OauthTestAdmin {
  return bridge.admin!;
}

async function registerClient(name = "Cursor", redirect = TEST_REDIRECT): Promise<string> {
  const response = await register(
    jsonPost("https://www.taylslate.com/api/oauth/register", {
      client_name: name,
      redirect_uris: [redirect],
    })
  );
  expect(response.status).toBe(201);
  const body = (await response.json()) as { client_id: string; client_secret?: string };
  expect(body.client_secret).toBeUndefined();
  expect(JSON.stringify(body)).not.toContain(SECRET_DB);
  return body.client_id;
}

async function startAuthorize(clientId: string, challenge: string, scope?: string): Promise<string> {
  const url = new URL("https://www.taylslate.com/api/oauth/authorize");
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", TEST_REDIRECT);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("state", STATE);
  if (scope) url.searchParams.set("scope", scope);
  const response = await authorize(new Request(url));
  expect(response.status).toBe(302);
  const location = response.headers.get("location") ?? "";
  expect(location.startsWith(`${TEST_ORIGIN}/oauth/consent/`)).toBe(true);
  return location.slice(location.lastIndexOf("/") + 1);
}

async function allow(requestId: string): Promise<string> {
  const response = await consent(
    jsonPost("https://www.taylslate.com/api/oauth/consent", { requestId, decision: "allow" })
  );
  expect(response.status).toBe(200);
  const body = (await response.json()) as { redirect: string };
  expect(JSON.stringify(body)).not.toContain(SECRET_DB);
  return body.redirect;
}

function codeFrom(redirect: string): string {
  return new URL(redirect).searchParams.get("code") ?? "";
}

async function exchange(clientId: string, code: string, verifier: string, redirect = TEST_REDIRECT): Promise<Response> {
  return tokenRoute(
    formPost("https://www.taylslate.com/api/oauth/token", {
      grant_type: "authorization_code",
      code,
      client_id: clientId,
      redirect_uri: redirect,
      code_verifier: verifier,
    })
  );
}

async function refresh(clientId: string, refreshToken: string, scope?: string): Promise<Response> {
  const params: Record<string, string> = {
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: clientId,
  };
  if (scope) params.scope = scope;
  return tokenRoute(formPost("https://www.taylslate.com/api/oauth/token", params));
}

function mcpCall(token: string): Promise<Response> {
  return mcp(
    new Request("https://www.taylslate.com/api/v1/mcp", {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        "mcp-protocol-version": "2025-11-25",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
    })
  );
}

function assertNoPlaintext(secrets: string[]): void {
  const stored = JSON.stringify(admin().inserts);
  expect(stored).not.toContain("ts_live_");
  expect(stored).not.toContain("ts_oat_");
  expect(stored).not.toContain("ts_ort_");
  expect(stored).not.toContain("tsac_");
  for (const secret of secrets) {
    if (secret) expect(stored).not.toContain(secret);
  }
  const codeRow = admin().tables.mcp_oauth_codes[0];
  if (codeRow && typeof codeRow.code_hash === "string") {
    expect(codeRow.code_hash).toMatch(/^[0-9a-f]{64}$/);
  }
}

describe("OAuth grants", () => {
  it("registers, consents, lists tools, refreshes, and revokes the family on reuse", async () => {
    const leaks: string[] = [];
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((method) =>
      vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
        leaks.push(args.map((arg) => (typeof arg === "string" ? arg : JSON.stringify(arg))).join(" "));
      })
    );
    try {
      const { verifier, challenge } = pkcePair();
      const clientId = await registerClient();
      const requestId = await startAuthorize(clientId, challenge, "read write:campaigns");
      const redirect = await allow(requestId);
      const code = codeFrom(redirect);
      expect(code.startsWith("tsac_")).toBe(true);
      expect(new URL(redirect).searchParams.get("state")).toBe(STATE);
      expect(new URL(redirect).searchParams.get("iss")).toBe(TEST_ORIGIN);

      const issued = await exchange(clientId, code, verifier);
      expect(issued.status).toBe(200);
      expect(issued.headers.get("cache-control")).toBe("no-store");
      expect(issued.headers.get("pragma")).toBe("no-cache");
      const first = (await issued.json()) as {
        access_token: string;
        refresh_token: string;
        token_type: string;
        expires_in: number;
        scope: string;
      };
      expect(first.token_type).toBe("Bearer");
      expect(first.expires_in).toBe(3600);
      expect(first.access_token.startsWith("ts_oat_")).toBe(true);
      expect(first.refresh_token.startsWith("ts_ort_")).toBe(true);
      expect(first.scope).toBe("read write:campaigns");
      expect(JSON.stringify(first)).not.toContain("ts_live_");
      expect(JSON.stringify(first)).not.toContain(SECRET_DB);

      const listed = await mcpCall(first.access_token);
      expect(listed.status).toBe(200);
      const listedBody = (await listed.json()) as { result?: { tools?: unknown[] } };
      expect(Array.isArray(listedBody.result?.tools)).toBe(true);
      expect(admin().events).toEqual([
        expect.objectContaining({
          customerId: TEST_USER,
          operationType: "api_call",
          metadata: expect.objectContaining({
            path: "/api/v1/mcp",
            auth: "oauth",
            scopes: ["read", "write:campaigns"],
          }),
        }),
      ]);

      const rotated = await refresh(clientId, first.refresh_token, "read");
      expect(rotated.status).toBe(200);
      const second = (await rotated.json()) as { access_token: string; refresh_token: string; scope: string };
      expect(second.scope).toBe("read");
      expect(second.access_token).not.toBe(first.access_token);
      const still = await mcpCall(second.access_token);
      expect(still.status).toBe(200);

      const reused = await refresh(clientId, first.refresh_token);
      expect(reused.status).toBe(400);
      expect(await reused.json()).toEqual({
        error: "invalid_grant",
        error_description: "The grant is invalid, expired, or revoked.",
      });
      const family = admin().tables.mcp_oauth_tokens;
      expect(family.length).toBeGreaterThanOrEqual(4);
      expect(family.every((row) => row.revoked_at)).toBe(true);
      expect(admin().tables.api_keys[0].revoked_at).toBeTruthy();
      const cut = await mcpCall(second.access_token);
      expect(cut.status).toBe(401);

      const key = admin().tables.api_keys[0];
      expect(key?.name).toBe("MCP: Cursor");
      expect(String(key?.key_hash)).toMatch(/^[0-9a-f]{64}$/);
      expect(admin().tables.mcp_oauth_codes[0]?.code_hash).toBe(hashToken(code));
      expect(family.some((row) => row.token_hash === hashToken(first.access_token))).toBe(true);
      expect(family.some((row) => row.token_hash === hashToken(first.refresh_token))).toBe(true);
      assertNoPlaintext([verifier, code, first.access_token, first.refresh_token, second.access_token, second.refresh_token]);

      const log = leaks.join("\n");
      for (const secret of [verifier, code, first.access_token, first.refresh_token, second.access_token, second.refresh_token, STATE]) {
        expect(log).not.toContain(secret);
      }
      expect(log).not.toContain("ts_live_");
      expect(log).not.toContain(SECRET_DB);
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
  });

  it("rejects a second code exchange and revokes the first tokens", async () => {
    const { verifier, challenge } = pkcePair();
    const clientId = await registerClient();
    const requestId = await startAuthorize(clientId, challenge);
    const code = codeFrom(await allow(requestId));
    const first = await exchange(clientId, code, verifier);
    expect(first.status).toBe(200);
    const body = (await first.json()) as { access_token: string };
    const second = await exchange(clientId, code, verifier);
    expect(second.status).toBe(400);
    expect((await second.json()).error).toBe("invalid_grant");
    expect(admin().tables.mcp_oauth_tokens.every((row) => row.revoked_at)).toBe(true);
    expect(admin().tables.api_keys[0].revoked_at).toBeTruthy();
    expect((await mcpCall(body.access_token)).status).toBe(401);
  });

  it("rejects an expired code, a wrong verifier, a wrong redirect, and a wrong client", async () => {
    const { verifier, challenge } = pkcePair();
    const clientId = await registerClient();
    const otherId = await registerClient("Other");
    const requestId = await startAuthorize(clientId, challenge);
    const code = codeFrom(await allow(requestId));

    const wrongVerifier = await exchange(clientId, code, `${verifier}x`.slice(0, 64));
    expect(wrongVerifier.status).toBe(400);
    expect((await wrongVerifier.json()).error).toBe("invalid_grant");

    const { verifier: verifier2, challenge: challenge2 } = pkcePair();
    const request2 = await startAuthorize(clientId, challenge2);
    const code2 = codeFrom(await allow(request2));
    const wrongRedirect = await exchange(clientId, code2, verifier2, "https://app.example/other");
    expect(wrongRedirect.status).toBe(400);

    const { verifier: verifier3, challenge: challenge3 } = pkcePair();
    const request3 = await startAuthorize(clientId, challenge3);
    const code3 = codeFrom(await allow(request3));
    const wrongClient = await exchange(otherId, code3, verifier3);
    expect(wrongClient.status).toBe(400);

    const { verifier: verifier4, challenge: challenge4 } = pkcePair();
    const request4 = await startAuthorize(clientId, challenge4);
    const code4 = codeFrom(await allow(request4));
    now += 6 * 60 * 1000;
    const expired = await exchange(clientId, code4, verifier4);
    expect(expired.status).toBe(400);
    const expiredBody = await expired.json();
    expect(expiredBody.error).toBe("invalid_grant");
    expect(JSON.stringify(expiredBody)).not.toContain(SECRET_DB);
  });

  it("stops refresh when the backing key is revoked or the plan has no API access", async () => {
    const { verifier, challenge } = pkcePair();
    const clientId = await registerClient();
    const requestId = await startAuthorize(clientId, challenge);
    const code = codeFrom(await allow(requestId));
    const issued = await exchange(clientId, code, verifier);
    const body = (await issued.json()) as { access_token: string; refresh_token: string };
    admin().tables.api_keys[0].revoked_at = "2026-06-01T12:00:00.000Z";
    const revoked = await refresh(clientId, body.refresh_token);
    expect(revoked.status).toBe(400);
    expect((await revoked.json()).error).toBe("invalid_grant");
    expect((await mcpCall(body.access_token)).status).toBe(401);

    const { verifier: verifier2, challenge: challenge2 } = pkcePair();
    const request2 = await startAuthorize(clientId, challenge2);
    const code2 = codeFrom(await allow(request2));
    const issued2 = await exchange(clientId, code2, verifier2);
    const body2 = (await issued2.json()) as { access_token: string; refresh_token: string };
    admin().tables.profiles[0].plan = "pay_as_you_go";
    const blocked = await refresh(clientId, body2.refresh_token);
    expect(blocked.status).toBe(400);
    expect((await blocked.json()).error).toBe("invalid_grant");
    const denied = await mcpCall(body2.access_token);
    expect(denied.status).toBe(403);
    expect(await denied.json()).toEqual({
      error: "Your plan does not include API access.",
      code: "plan_no_api_access",
    });
  });

  it("rejects a widened refresh scope without burning the token", async () => {
    const { verifier, challenge } = pkcePair();
    const clientId = await registerClient();
    const requestId = await startAuthorize(clientId, challenge);
    const code = codeFrom(await allow(requestId));
    const issued = await exchange(clientId, code, verifier);
    const body = (await issued.json()) as { refresh_token: string };
    const widened = await refresh(clientId, body.refresh_token, "read write:outreach");
    expect(widened.status).toBe(400);
    expect((await widened.json()).error).toBe("invalid_scope");
    const row = admin().tables.mcp_oauth_tokens.find((item) => item.token_hash === hashToken(body.refresh_token));
    expect(row?.used_at).toBeNull();
    expect(admin().tables.api_keys[0].revoked_at).toBeNull();
  });

  function plantDecoys(): { sameId: Record<string, unknown>; otherId: Record<string, unknown> } {
    const real = admin().tables.api_keys[0];
    const sameId: Record<string, unknown> = {
      ...real,
      brand_id: "22222222-2222-4222-8222-222222222222",
      prefix: "decoysameid0001",
      revoked_at: null,
    };
    const otherId: Record<string, unknown> = {
      ...real,
      id: "99999999-9999-4999-8999-999999999999",
      prefix: "decoyotherid001",
      revoked_at: null,
    };
    admin().tables.api_keys.push(sameId, otherId);
    return { sameId, otherId };
  }

  async function issuedRefresh(): Promise<{ clientId: string; refreshToken: string }> {
    const { verifier, challenge } = pkcePair();
    const clientId = await registerClient();
    const requestId = await startAuthorize(clientId, challenge);
    const code = codeFrom(await allow(requestId));
    const issued = await exchange(clientId, code, verifier);
    expect(issued.status).toBe(200);
    const body = (await issued.json()) as { refresh_token: string };
    return { clientId, refreshToken: body.refresh_token };
  }

  it("revokes only the backing key on refresh replay", async () => {
    const { clientId, refreshToken } = await issuedRefresh();
    const rotated = await refresh(clientId, refreshToken);
    expect(rotated.status).toBe(200);
    const { sameId, otherId } = plantDecoys();
    const replay = await refresh(clientId, refreshToken);
    expect(replay.status).toBe(400);
    expect((await replay.json()).error).toBe("invalid_grant");
    expect(admin().tables.api_keys[0].revoked_at).toBe(new Date(now).toISOString());
    expect(sameId.revoked_at).toBeNull();
    expect(otherId.revoked_at).toBeNull();
    expect(admin().tables.mcp_oauth_tokens.every((row) => row.revoked_at)).toBe(true);
  });

  it("revokes only the backing key on code replay", async () => {
    const { verifier, challenge } = pkcePair();
    const clientId = await registerClient();
    const requestId = await startAuthorize(clientId, challenge);
    const code = codeFrom(await allow(requestId));
    const first = await exchange(clientId, code, verifier);
    expect(first.status).toBe(200);
    const { sameId, otherId } = plantDecoys();
    const second = await exchange(clientId, code, verifier);
    expect(second.status).toBe(400);
    expect(admin().tables.api_keys[0].revoked_at).toBe(new Date(now).toISOString());
    expect(sameId.revoked_at).toBeNull();
    expect(otherId.revoked_at).toBeNull();
  });

  it("revokes only the backing key when a refresh loses the compare-and-set", async () => {
    const { clientId, refreshToken } = await issuedRefresh();
    const { sameId, otherId } = plantDecoys();
    let armed = true;
    admin().beforeExecute = (table, op, patch) => {
      if (!armed || table !== "mcp_oauth_tokens" || op !== "update") return;
      if (!patch || !Object.prototype.hasOwnProperty.call(patch, "used_at")) return;
      const row = admin().tables.mcp_oauth_tokens.find(
        (item) => item.kind === "refresh" && item.token_hash === hashToken(refreshToken)
      );
      if (!row || row.used_at) return;
      row.used_at = new Date(now).toISOString();
      armed = false;
    };
    const lost = await refresh(clientId, refreshToken);
    expect(lost.status).toBe(400);
    expect((await lost.json()).error).toBe("invalid_grant");
    expect(admin().tables.api_keys[0].revoked_at).toBe(new Date(now).toISOString());
    expect(sameId.revoked_at).toBeNull();
    expect(otherId.revoked_at).toBeNull();
    expect(admin().tables.mcp_oauth_tokens.every((row) => row.revoked_at)).toBe(true);
  });

  it("revokes only the backing key when the winner sees the family already revoked", async () => {
    const { clientId, refreshToken } = await issuedRefresh();
    const old = admin().tables.mcp_oauth_tokens.find((item) => item.token_hash === hashToken(refreshToken));
    const decoys: { sameId?: Record<string, unknown>; otherId?: Record<string, unknown> } = {};
    let sawInsert = false;
    admin().beforeExecute = (table, op) => {
      if (table === "mcp_oauth_tokens" && op === "insert" && !sawInsert) {
        sawInsert = true;
        const planted = plantDecoys();
        decoys.sameId = planted.sameId;
        decoys.otherId = planted.otherId;
        return;
      }
      if (!sawInsert || table !== "mcp_oauth_tokens" || op !== "select") return;
      if (old) old.revoked_at = new Date(now).toISOString();
      sawInsert = false;
    };
    const won = await refresh(clientId, refreshToken);
    expect(won.status).toBe(400);
    expect((await won.json()).error).toBe("invalid_grant");
    expect(admin().tables.api_keys[0].revoked_at).toBe(new Date(now).toISOString());
    expect(decoys.sameId?.revoked_at ?? null).toBeNull();
    expect(decoys.otherId?.revoked_at ?? null).toBeNull();
    expect(admin().tables.mcp_oauth_tokens.every((row) => row.revoked_at)).toBe(true);
  });

  it("still returns invalid_grant when the backing key write fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const { clientId, refreshToken } = await issuedRefresh();
      await refresh(clientId, refreshToken);
      admin().failUpdates.add("api_keys");
      const replay = await refresh(clientId, refreshToken);
      expect(replay.status).toBe(400);
      const text = await replay.text();
      expect(text).not.toContain(SECRET_DB);
      expect(text).toContain("invalid_grant");
      for (const [name, value] of replay.headers.entries()) {
        expect(`${name}:${value}`).not.toContain(SECRET_DB);
      }
      expect(admin().tables.mcp_oauth_tokens.every((row) => row.revoked_at)).toBe(true);
      expect(admin().tables.api_keys[0].revoked_at).toBeNull();
      const lines = warn.mock.calls.map((call) => call.map(String).join(" ")).join("\n");
      expect(lines).toContain("[mcp-oauth] backing key revoke failed");
      expect(lines).not.toContain(SECRET_DB);
    } finally {
      warn.mockRestore();
    }
  });

  it("hides database text on authorization_code and refresh_token failures", async () => {
    const clientId = await registerClient();
    admin().missingTables.add("mcp_oauth_codes");
    admin().missingTables.add("mcp_oauth_tokens");
    const codeGrant = await exchange(clientId, `tsac_${"ab".repeat(32)}`, "b".repeat(43));
    const codeText = await codeGrant.text();
    expect(codeGrant.status).toBe(503);
    expect(codeText).not.toContain(SECRET_DB);
    for (const [name, value] of codeGrant.headers.entries()) {
      expect(`${name}:${value}`).not.toContain(SECRET_DB);
    }
    const refreshGrant = await refresh(clientId, `ts_ort_${"cd".repeat(32)}`);
    const refreshText = await refreshGrant.text();
    expect(refreshGrant.status).toBe(503);
    expect(refreshText).not.toContain(SECRET_DB);
    for (const [name, value] of refreshGrant.headers.entries()) {
      expect(`${name}:${value}`).not.toContain(SECRET_DB);
    }
  });
});
