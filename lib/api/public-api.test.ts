import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import type { MemoryAdmin } from "@/lib/api/memory-admin";

const bridge = vi.hoisted(() => ({
  current: null as {
    from: (table: string) => unknown;
    rpc: (
      name: string,
      args: { p_key_id: string; p_window_start: string }
    ) => Promise<{ data: number | null; error: { code: string } | null }>;
    keys: Array<{
      id: string;
      brand_id: string;
      prefix: string;
      key_hash: string;
      scopes: string[];
      last_used_at: string | null;
      revoked_at: string | null;
    }>;
    selects: string[];
    windows: Array<{ key_id: string; window_start: string; count: number }>;
  } | null,
  recordEvent: vi.fn(async (_input: unknown) => undefined),
}));

vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: {
    from: (table: string) => bridge.current!.from(table),
    rpc: (name: string, args: { p_key_id: string; p_window_start: string }) =>
      bridge.current!.rpc(name, args),
  },
}));

vi.mock("@/lib/data/event-log", () => ({
  recordEvent: (input: unknown) => bridge.recordEvent(input),
}));

import { createMemoryAdmin } from "@/lib/api/memory-admin";
import {
  ApiKeyError,
  createKey,
  generateKey,
  hashKey,
  listKeys,
  parseApiToken,
  revokeKey,
} from "@/lib/api/keys";
import {
  ApiAuthError,
  requireScope,
  resolveApiRequest,
} from "@/lib/api/auth";
import {
  API_RATE_LIMIT_PER_MINUTE,
  _setApiRateClockForTests,
  apiRateRetryAfterSec,
  apiRateWindowStart,
  enforceApiRateLimit,
} from "@/lib/api/rate-limit";

const BRAND = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const FIXED_NOW = new Date("2026-10-21T23:18:45.000Z");

let admin: MemoryAdmin;

function request(token?: string, path = "/api/v1/health"): Request {
  const headers = new Headers();
  if (token) headers.set("authorization", `Bearer ${token}`);
  return new Request(`https://www.taylslate.com${path}`, { headers });
}

beforeEach(() => {
  admin = createMemoryAdmin();
  admin.profiles.push({ id: BRAND });
  bridge.current = admin;
  bridge.recordEvent.mockClear();
  _setApiRateClockForTests(() => FIXED_NOW);
});

afterEach(() => {
  _setApiRateClockForTests(null);
});

describe("api key material", () => {
  it("builds ts_live_<prefix>_<secret> from random bytes and hashes the full token", () => {
    const first = generateKey();
    const second = generateKey();
    expect(first.token).toBe(`ts_live_${first.prefix}_${first.secret}`);
    expect(first.prefix).toMatch(/^[0-9a-f]{16}$/);
    expect(first.secret).toMatch(/^[0-9a-f]{64}$/);
    expect(first.token).not.toBe(second.token);
    expect(parseApiToken(first.token)?.prefix).toBe(first.prefix);
    expect(hashKey(first.token)).toBe(
      createHash("sha256").update(first.token).digest("hex")
    );
    expect(hashKey(first.token)).not.toBe(hashKey(first.secret));
  });

  it("creates a key, lists it without the hash, and returns the secret once", async () => {
    const created = await createKey({
      brandId: BRAND,
      name: "  Warehouse  ",
      scopes: ["read", "read", "write:outreach"],
    });

    expect(created.secret).toMatch(/^ts_live_[0-9a-f]{16}_[0-9a-f]{64}$/);
    expect(created).not.toHaveProperty("key_hash");
    expect(created).not.toHaveProperty("keyHash");
    expect(created.name).toBe("Warehouse");
    expect(created.scopes).toEqual(["read", "write:outreach"]);
    expect(created.brandId).toBe(BRAND);

    expect(admin.keys).toHaveLength(1);
    expect(admin.keys[0].key_hash).toBe(hashKey(created.secret));
    expect(JSON.stringify(admin.keys)).not.toContain(created.secret);
    expect(admin.selects.every((columns) => !columns.includes("key_hash"))).toBe(
      true
    );

    const listed = await listKeys(BRAND);
    expect(listed.map((row) => row.id)).toEqual([created.id]);
    expect(listed[0]).not.toHaveProperty("key_hash");
    expect(JSON.stringify(listed)).not.toContain(created.secret);
    expect(await listKeys(OTHER)).toEqual([]);
  });

  it("rejects an unknown scope, an empty scope list, and a bad brand id", async () => {
    await expect(
      createKey({ brandId: BRAND, scopes: ["admin"] })
    ).rejects.toBeInstanceOf(ApiKeyError);
    await expect(createKey({ brandId: BRAND, scopes: [] })).rejects.toBeInstanceOf(
      ApiKeyError
    );
    await expect(
      createKey({ brandId: "not-a-uuid", scopes: ["read"] })
    ).rejects.toBeInstanceOf(ApiKeyError);
    expect(admin.keys).toHaveLength(0);
  });

  it("revokes a key once and refuses another brand", async () => {
    const created = await createKey({ brandId: BRAND, scopes: ["read"] });
    const revoked = await revokeKey(created.id, BRAND);
    expect(revoked.revokedAt).toBeTruthy();
    const again = await revokeKey(created.id, BRAND);
    expect(again.revokedAt).toBe(revoked.revokedAt);
    expect(again).not.toHaveProperty("key_hash");

    await expect(revokeKey(created.id, OTHER)).rejects.toThrow(
      "API key was not found."
    );
    expect(admin.keys[0].revoked_at).toBe(revoked.revokedAt);
  });
});

describe("api request resolver", () => {
  it("resolves a live key, touches last_used_at, and writes an api_call event", async () => {
    const created = await createKey({
      brandId: BRAND,
      scopes: ["read", "write:campaigns"],
    });
    bridge.recordEvent.mockClear();

    const resolved = await resolveApiRequest(request(created.secret));
    expect(resolved).toEqual({
      brandId: BRAND,
      scopes: ["read", "write:campaigns"],
      keyId: created.id,
    });
    expect(resolved).not.toHaveProperty("key_hash");
    expect(admin.keys[0].last_used_at).toBeTruthy();
    expect(bridge.recordEvent).toHaveBeenCalledWith({
      customerId: BRAND,
      operationType: "api_call",
      metadata: {
        key_id: created.id,
        path: "/api/v1/health",
        scopes: ["read", "write:campaigns"],
      },
    });
    expect(JSON.stringify(bridge.recordEvent.mock.calls)).not.toContain(
      created.secret
    );
    expect(JSON.stringify(bridge.recordEvent.mock.calls)).not.toContain(
      "key_hash"
    );
  });

  it("rejects a missing, wrong, or revoked key without an event", async () => {
    const created = await createKey({ brandId: BRAND, scopes: ["read"] });
    bridge.recordEvent.mockClear();

    await expect(resolveApiRequest(request())).rejects.toMatchObject({
      status: 401,
      message: "Missing or invalid API key.",
    });

    const wrong = generateKey();
    const forged = `ts_live_${created.prefix}_${wrong.secret}`;
    await expect(resolveApiRequest(request(forged))).rejects.toMatchObject({
      status: 401,
      message: "Invalid API key.",
    });
    expect(admin.keys[0].last_used_at).toBeNull();

    await revokeKey(created.id, BRAND);
    await expect(resolveApiRequest(request(created.secret))).rejects.toMatchObject({
      status: 401,
      message: "API key is revoked.",
    });
    expect(bridge.recordEvent).not.toHaveBeenCalled();
  });

  it("rejects a key that is not tied to a user account", async () => {
    const created = await createKey({ brandId: BRAND, scopes: ["read"] });
    admin.profiles.length = 0;
    bridge.recordEvent.mockClear();

    await expect(resolveApiRequest(request(created.secret))).rejects.toMatchObject({
      status: 401,
      message: "API key is not tied to a user.",
    });
    expect(admin.keys[0].last_used_at).toBeNull();
    expect(bridge.recordEvent).not.toHaveBeenCalled();

    admin.keys[0].brand_id = "not-a-user";
    admin.profiles.push({ id: BRAND });
    await expect(resolveApiRequest(request(created.secret))).rejects.toMatchObject({
      status: 401,
      message: "API key is not tied to a user.",
    });
  });

  it("requires the named scope", async () => {
    const created = await createKey({
      brandId: BRAND,
      scopes: ["write:outreach"],
    });
    const resolved = await resolveApiRequest(request(created.secret));
    expect(() => requireScope(resolved, "read")).toThrow(ApiAuthError);
    expect(() => requireScope(resolved, "read")).toThrow(
      "API key lacks the required scope."
    );
    expect(() => requireScope(resolved, "write:outreach")).not.toThrow();
  });
});

describe("api rate limit", () => {
  it("counts one window per key per minute and reports retry-after", async () => {
    const keyId = "33333333-3333-4333-8333-333333333333";
    for (let n = 1; n <= API_RATE_LIMIT_PER_MINUTE; n += 1) {
      const decision = await enforceApiRateLimit(keyId);
      expect(decision.ok).toBe(true);
      expect(decision.remaining).toBe(API_RATE_LIMIT_PER_MINUTE - n);
    }

    const blocked = await enforceApiRateLimit(keyId);
    expect(blocked).toEqual({
      ok: false,
      limit: API_RATE_LIMIT_PER_MINUTE,
      remaining: 0,
      retryAfterSec: 15,
    });
    expect(apiRateRetryAfterSec(FIXED_NOW)).toBe(15);
    expect(admin.windows).toEqual([
      {
        key_id: keyId,
        window_start: apiRateWindowStart(FIXED_NOW),
        count: API_RATE_LIMIT_PER_MINUTE + 1,
      },
    ]);
    expect(apiRateWindowStart(FIXED_NOW)).toBe("2026-10-21T23:18:00.000Z");
  });

  it("starts a new window on the next minute", async () => {
    const keyId = "33333333-3333-4333-8333-333333333333";
    await enforceApiRateLimit(keyId, FIXED_NOW);
    const next = new Date("2026-10-21T23:19:01.000Z");
    const decision = await enforceApiRateLimit(keyId, next);
    expect(decision.ok).toBe(true);
    expect(decision.remaining).toBe(API_RATE_LIMIT_PER_MINUTE - 1);
    expect(admin.windows).toHaveLength(2);
  });
});

describe("api key lifecycle", () => {
  it("creates, resolves, rate limits, and revokes one key", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const created = await createKey({
      brandId: BRAND,
      name: "Lifecycle",
      scopes: ["read"],
    });

    const resolved = await resolveApiRequest(
      request(created.secret, "/api/v1/health")
    );
    expect(resolved.brandId).toBe(BRAND);

    let lastOk = true;
    for (let n = 0; n < API_RATE_LIMIT_PER_MINUTE; n += 1) {
      lastOk = (await enforceApiRateLimit(resolved.keyId)).ok;
    }
    expect(lastOk).toBe(true);
    expect((await enforceApiRateLimit(resolved.keyId)).ok).toBe(false);

    const revoked = await revokeKey(created.id, BRAND);
    expect(revoked.revokedAt).not.toBeNull();
    await expect(resolveApiRequest(request(created.secret))).rejects.toMatchObject({
      status: 401,
    });

    const logged = JSON.stringify(warn.mock.calls);
    expect(logged).not.toContain(created.secret);
    warn.mockRestore();
  });
});
