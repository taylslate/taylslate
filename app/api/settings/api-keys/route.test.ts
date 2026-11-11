import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { MemoryAdmin } from "@/lib/api/memory-admin";

const harness = vi.hoisted(() => ({
  admin: null as MemoryAdmin | null,
  events: [] as unknown[],
  rate: {
    mode: "count" as "count" | "deny" | "fail",
    counts: new Map<string, number>(),
    calls: [] as Array<Record<string, unknown>>,
  },
  session: {
    user: null as { id: string; email?: string } | null,
    profile: null as { role: string; plan: string | null } | null,
    error: null as { code: string; message?: string } | null,
    select: "",
    queriedId: "",
  },
}));

vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: {
    from: (table: string) => harness.admin!.from(table),
    rpc: (name: string, args: Record<string, unknown>) => {
      if (name === "rate_limit_hit") {
        harness.rate.calls.push(args);
        if (harness.rate.mode === "fail") {
          return Promise.resolve({ data: null, error: { message: "down", code: "57014" } });
        }
        if (harness.rate.mode === "deny") {
          return Promise.resolve({ data: false, error: null });
        }
        const id = `${String(args.p_bucket)}:${String(args.p_key)}`;
        const next = (harness.rate.counts.get(id) ?? 0) + 1;
        harness.rate.counts.set(id, next);
        return Promise.resolve({ data: next <= Number(args.p_max), error: null });
      }
      return harness.admin!.rpc(
        name,
        args as { p_key_id: string; p_window_start: string }
      );
    },
  },
}));

vi.mock("@/lib/data/queries", () => ({
  getAuthenticatedUser: async () => harness.session.user,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: () => ({
      select: (columns: string) => ({
        eq: (_column: string, id: string) => ({
          single: async () => {
            harness.session.select = columns;
            harness.session.queriedId = id;
            if (harness.session.error) return { data: null, error: harness.session.error };
            if (!harness.session.profile) {
              return { data: null, error: { code: "PGRST116", message: "no rows" } };
            }
            return { data: harness.session.profile, error: null };
          },
        }),
      }),
    }),
  }),
}));

vi.mock("@/lib/data/event-log", () => ({
  recordEvent: async (input: unknown) => {
    harness.events.push(input);
  },
}));

import { createMemoryAdmin } from "@/lib/api/memory-admin";
import { createKey } from "@/lib/api/keys";
import { API_KEY_RESPONSE_FIELDS } from "@/lib/api/key-settings";
import { GET as health } from "@/app/api/v1/health/route";
import { DELETE } from "./[id]/route";
import { GET, POST } from "./route";

const BRAND = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const ORIGIN = "https://www.taylslate.com";

let admin: MemoryAdmin;
let logs: string[];
const spies: Array<{ mockRestore: () => void }> = [];

function asBrand(plan: string | null = "operator", role = "brand") {
  harness.session.user = { id: BRAND, email: "brand@example.com" };
  harness.session.profile = { role, plan };
  harness.session.error = null;
}

function post(body: unknown, origin: string | null = ORIGIN, contentType = "application/json") {
  const headers = new Headers();
  if (contentType) headers.set("content-type", contentType);
  if (origin) headers.set("origin", origin);
  return POST(
    new NextRequest(`${ORIGIN}/api/settings/api-keys`, {
      method: "POST",
      headers,
      body: typeof body === "string" ? body : JSON.stringify(body),
    })
  );
}

function del(id: string, origin: string | null = ORIGIN) {
  const headers = new Headers();
  if (origin) headers.set("origin", origin);
  return DELETE(
    new NextRequest(`${ORIGIN}/api/settings/api-keys/${id}`, { method: "DELETE", headers }),
    { params: Promise.resolve({ id }) }
  );
}

function callHealth(token?: string) {
  const headers = new Headers();
  if (token) headers.set("authorization", `Bearer ${token}`);
  return health(new NextRequest(`${ORIGIN}/api/v1/health`, { headers }));
}

beforeEach(() => {
  admin = createMemoryAdmin();
  admin.profiles.push(
    { id: BRAND, role: "brand", plan: "operator" },
    { id: OTHER, role: "brand", plan: "operator" }
  );
  harness.admin = admin;
  harness.events = [];
  harness.rate.mode = "count";
  harness.rate.counts.clear();
  harness.rate.calls = [];
  asBrand();
  logs = [];
  for (const method of ["log", "info", "debug", "warn", "error"] as const) {
    spies.push(
      vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
        logs.push(args.map((arg) => String(arg)).join(" "));
      })
    );
  }
});

afterEach(() => {
  while (spies.length) spies.pop()?.mockRestore();
});

describe("GET and POST /api/settings/api-keys", () => {
  it("returns 401 when there is no session", async () => {
    harness.session.user = null;
    expect((await GET()).status).toBe(401);
    expect((await post({ name: "Planner", scopes: ["read"] })).status).toBe(401);
    expect(admin.keys).toHaveLength(0);
  });

  it("returns 403 for show, agent, and agency roles", async () => {
    for (const role of ["show", "agent", "agency"]) {
      asBrand("operator", role);
      expect((await GET()).status).toBe(403);
      expect((await post({ name: "Planner", scopes: ["read"] })).status).toBe(403);
    }
    expect(admin.keys).toHaveLength(0);
  });

  it("returns 403 for Free and Starter and still lists an existing key", async () => {
    const existing = await createKey({ brandId: BRAND, name: "Old", scopes: ["read"] });
    for (const plan of ["pay_as_you_go", "starter"]) {
      asBrand(plan);
      const denied = await post({ name: "Planner", scopes: ["read"] });
      expect(denied.status).toBe(403);
      expect(await denied.json()).toEqual({
        error: "API keys are part of the Operator plan.",
      });
      const listed = await GET();
      expect(listed.status).toBe(200);
      const body = await listed.json();
      expect(body.keys.map((key: { id: string }) => key.id)).toContain(existing.id);
    }
    expect(admin.keys).toHaveLength(1);
  });

  it("returns 422 for a bad name, an unknown scope, and an unknown field", async () => {
    const cases = [
      [{ name: "  ", scopes: ["read"] }, "Name is required."],
      [{ name: "a".repeat(61), scopes: ["read"] }, "Name must be 1 to 60 printable characters."],
      [{ name: "bad\nname", scopes: ["read"] }, "Name must be 1 to 60 printable characters."],
      [{ name: "Planner", scopes: ["campaigns:read"] }, "Unknown API scope."],
      [{ name: "Planner", scopes: [] }, "Choose at least one scope."],
      [{ name: "Planner", scopes: ["read"], brandId: OTHER }, "Unknown field brandId."],
    ] as const;
    for (const [body, message] of cases) {
      const res = await post(body);
      expect(res.status).toBe(422);
      expect(await res.json()).toEqual({ error: message });
    }
    expect(admin.keys).toHaveLength(0);
    expect(harness.session.queriedId).toBe(BRAND);
    expect(harness.session.select).toBe("role, plan");
  });

  it("returns 409 at 10 active keys and ignores revoked rows", async () => {
    for (let index = 0; index < 10; index += 1) {
      const created = await createKey({
        brandId: BRAND,
        name: `Revoked ${index}`,
        scopes: ["read"],
      });
      admin.keys.find((key) => key.id === created.id)!.revoked_at = "2026-01-01T00:00:00.000Z";
    }
    const afterRevoked = await post({ name: "Still room", scopes: ["read"] });
    expect(afterRevoked.status).toBe(200);

    for (let index = 0; index < 9; index += 1) {
      await createKey({ brandId: BRAND, name: `Active ${index}`, scopes: ["read"] });
    }
    const calls = harness.rate.calls.length;
    const full = await post({ name: "One too many", scopes: ["read"] });
    expect(full.status).toBe(409);
    expect(await full.json()).toEqual({
      error: "You have the maximum of 10 active keys. Revoke one first.",
    });
    expect(harness.rate.calls.length).toBe(calls);
  });

  it("returns 429 and 503 on the create bucket without storing a key", async () => {
    harness.rate.mode = "deny";
    const limited = await post({ name: "Planner", scopes: ["read"] });
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBe("3600");
    expect(admin.keys).toHaveLength(0);
    expect(harness.rate.calls[0]).toMatchObject({
      p_bucket: "api_key_create_user_hour",
      p_key: BRAND,
      p_max: 10,
      p_window_seconds: 3600,
    });
    expect(JSON.stringify(harness.rate.calls)).not.toContain("brand@example.com");

    harness.rate.mode = "fail";
    const closed = await post({ name: "Planner", scopes: ["read"] });
    expect(closed.status).toBe(503);
    expect(await closed.json()).toEqual({ error: "unavailable" });
    expect(admin.keys).toHaveLength(0);
  });

  it("returns 403 for a cross-origin or missing Origin", async () => {
    expect((await post({ name: "Planner", scopes: ["read"] }, "https://evil.example")).status).toBe(
      403
    );
    expect((await post({ name: "Planner", scopes: ["read"] }, null)).status).toBe(403);
    expect(admin.keys).toHaveLength(0);
  });

  it("creates a key once, lists the allowlist, and never logs the secret", async () => {
    const created = await post({
      name: "  Planner  ",
      scopes: ["write:outreach", "read", "read"],
    });
    expect(created.status).toBe(200);
    expect(created.headers.get("cache-control")).toBe("no-store");
    const body = await created.json();
    expect(Object.keys(body).sort()).toEqual(["key", "secret"]);
    expect(Object.keys(body.key)).toEqual([...API_KEY_RESPONSE_FIELDS]);
    expect(body.key).toMatchObject({
      name: "Planner",
      scopes: ["write:outreach", "read"],
      last_used_at: null,
      revoked_at: null,
    });
    expect(body.secret).toMatch(/^ts_live_[0-9a-f]{16}_[0-9a-f]{64}$/);
    expect(body.secret).toContain(body.key.prefix);
    expect(admin.keys[0]?.brand_id).toBe(BRAND);
    expect(JSON.stringify(admin.keys)).not.toContain(body.secret);
    expect(logs.join("\n")).not.toContain(body.secret);

    const ok = await callHealth(body.secret);
    expect(ok.status).toBe(200);

    const listed = await GET();
    expect(listed.headers.get("cache-control")).toBe("no-store");
    const listBody = await listed.json();
    expect(Object.keys(listBody.keys[0])).toEqual([...API_KEY_RESPONSE_FIELDS]);
    expect(listBody.keys[0].prefix).toBe(body.key.prefix);
    expect(listBody.keys[0].last_used_at).toEqual(expect.any(String));
    const listedText = JSON.stringify(listBody);
    expect(listedText).not.toContain(body.secret);
    expect(listedText).not.toContain("key_hash");
    expect(JSON.stringify(harness.events)).not.toContain(body.secret);
    expect(logs.join("\n")).not.toContain(body.secret);

    const revoked = await del(body.key.id);
    expect(revoked.status).toBe(200);
    const denied = await callHealth(body.secret);
    expect(denied.status).toBe(401);
    expect(await denied.json()).toEqual({ error: "API key is revoked." });
    expect(logs.join("\n")).not.toContain(body.secret);
    expect(JSON.stringify(harness.events)).not.toContain(body.secret);
  });

  it("lets an agency-plan brand create a key because apiAccess is true", async () => {
    asBrand("agency");
    const res = await post({ name: "Agency", scopes: ["read"] });
    expect(res.status).toBe(200);
  });
});
