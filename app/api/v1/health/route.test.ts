import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { MemoryAdmin } from "@/lib/api/memory-admin";

const { getUser } = vi.hoisted(() => ({ getUser: vi.fn() }));

const bridge = vi.hoisted(() => ({
  current: null as {
    from: (table: string) => unknown;
    rpc: (
      name: string,
      args: { p_key_id: string; p_window_start: string }
    ) => Promise<{ data: number | null; error: { code: string } | null }>;
  } | null,
  recordEvent: vi.fn(async (_input: unknown) => undefined),
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient: vi.fn(() => ({ auth: { getUser } })),
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
import { createKey, revokeKey } from "@/lib/api/keys";
import {
  API_RATE_LIMIT_PER_MINUTE,
  _setApiRateClockForTests,
} from "@/lib/api/rate-limit";
import { proxy } from "@/proxy";
import { GET } from "./route";

const BRAND = "11111111-1111-4111-8111-111111111111";
const FIXED_NOW = new Date("2026-10-21T23:18:10.000Z");

let admin: MemoryAdmin;

function call(token?: string) {
  const headers = new Headers();
  if (token) headers.set("authorization", `Bearer ${token}`);
  return GET(
    new NextRequest("https://www.taylslate.com/api/v1/health", { headers })
  );
}

beforeEach(() => {
  admin = createMemoryAdmin();
  admin.profiles.push({ id: BRAND });
  bridge.current = admin;
  bridge.recordEvent.mockClear();
  getUser.mockResolvedValue({ data: { user: null } });
  _setApiRateClockForTests(() => FIXED_NOW);
});

afterEach(() => {
  _setApiRateClockForTests(null);
});

describe("GET /api/v1/health", () => {
  it("returns 401 when the key is missing, wrong, or revoked", async () => {
    const missing = await call();
    expect(missing.status).toBe(401);
    expect(await missing.json()).toEqual({ error: "Missing or invalid API key." });

    const created = await createKey({ brandId: BRAND, scopes: ["read"] });
    const wrong = await call(`${created.secret}ff`);
    expect(wrong.status).toBe(401);

    const forged = created.secret.replace(/[0-9a-f]$/, (digit) =>
      digit === "a" ? "b" : "a"
    );
    const mismatch = await call(forged);
    expect(mismatch.status).toBe(401);
    expect(await mismatch.json()).toEqual({ error: "Invalid API key." });

    await revokeKey(created.id, BRAND);
    const revoked = await call(created.secret);
    expect(revoked.status).toBe(401);
    expect(await revoked.json()).toEqual({ error: "API key is revoked." });
    expect(JSON.stringify(bridge.recordEvent.mock.calls)).not.toContain(
      created.secret
    );
  });

  it("returns 403 when the key lacks read", async () => {
    const created = await createKey({
      brandId: BRAND,
      scopes: ["write:campaigns"],
    });
    const res = await call(created.secret);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      error: "API key lacks the required scope.",
    });
    expect(admin.windows).toHaveLength(1);
  });

  it("returns 200 with the brand and scopes", async () => {
    const created = await createKey({
      brandId: BRAND,
      scopes: ["read", "write:outreach"],
    });
    const res = await call(created.secret);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({
      brandId: BRAND,
      scopes: ["read", "write:outreach"],
    });
    const body = JSON.stringify(bridge.recordEvent.mock.calls);
    expect(body).toContain("api_call");
    expect(body).not.toContain(created.secret);
    expect(body).not.toContain("key_hash");
  });

  it("returns 429 with Retry-After once the minute window is full", async () => {
    const created = await createKey({ brandId: BRAND, scopes: ["read"] });
    for (let n = 0; n < API_RATE_LIMIT_PER_MINUTE; n += 1) {
      const ok = await call(created.secret);
      expect(ok.status).toBe(200);
    }
    const blocked = await call(created.secret);
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("retry-after")).toBe("50");
    expect(await blocked.json()).toEqual({ error: "Rate limit exceeded." });
  });

  it("returns 500 when the rate counter cannot be written", async () => {
    const created = await createKey({ brandId: BRAND, scopes: ["read"] });
    admin.rpc = async () => ({ data: null, error: { message: "down", code: "57014" } });
    const res = await call(created.secret);
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "API request failed." });
  });
});

describe("proxy /api/v1 allowance", () => {
  it("lets a signed-out /api/v1 request through and still gates the dashboard", async () => {
    const health = await proxy(
      new NextRequest("https://www.taylslate.com/api/v1/health")
    );
    expect(health.headers.get("location") ?? "").not.toContain("/login");

    const webhook = await proxy(
      new NextRequest("https://www.taylslate.com/api/webhooks/stripe")
    );
    expect(webhook.headers.get("location") ?? "").not.toContain("/login");

    const dashboard = await proxy(
      new NextRequest("https://www.taylslate.com/dashboard")
    );
    expect(dashboard.headers.get("location") ?? "").toContain("/login");
    expect(dashboard.headers.get("location")).toContain("next=%2Fdashboard");
  });
});
