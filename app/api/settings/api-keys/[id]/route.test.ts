import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { MemoryAdmin } from "@/lib/api/memory-admin";

const harness = vi.hoisted(() => ({
  admin: null as MemoryAdmin | null,
  rate: {
    mode: "count" as "count" | "deny" | "fail",
    calls: [] as Array<Record<string, unknown>>,
  },
  session: {
    user: null as { id: string; email?: string } | null,
    profile: null as { role: string; plan: string | null } | null,
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
        return Promise.resolve({ data: true, error: null });
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
      select: () => ({
        eq: () => ({
          single: async () => ({ data: harness.session.profile, error: null }),
        }),
      }),
    }),
  }),
}));

import { createMemoryAdmin } from "@/lib/api/memory-admin";
import { createKey, revokeKey } from "@/lib/api/keys";
import { API_KEY_RESPONSE_FIELDS } from "@/lib/api/key-settings";
import { DELETE } from "./route";

const BRAND = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const ORIGIN = "https://www.taylslate.com";

let admin: MemoryAdmin;
let logs: string[];
const spies: Array<{ mockRestore: () => void }> = [];

function del(id: string, origin: string | null = ORIGIN) {
  const headers = new Headers();
  if (origin) headers.set("origin", origin);
  return DELETE(
    new NextRequest(`${ORIGIN}/api/settings/api-keys/${id}`, { method: "DELETE", headers }),
    { params: Promise.resolve({ id }) }
  );
}

beforeEach(() => {
  admin = createMemoryAdmin();
  admin.profiles.push({ id: BRAND }, { id: OTHER });
  harness.admin = admin;
  harness.rate.mode = "count";
  harness.rate.calls = [];
  harness.session.user = { id: BRAND, email: "brand@example.com" };
  harness.session.profile = { role: "brand", plan: "pay_as_you_go" };
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

describe("DELETE /api/settings/api-keys/[id]", () => {
  it("returns 401 without a session and 403 for show and agent", async () => {
    const key = await createKey({ brandId: BRAND, name: "Planner", scopes: ["read"] });
    harness.session.user = null;
    expect((await del(key.id)).status).toBe(401);

    harness.session.user = { id: BRAND, email: "show@example.com" };
    harness.session.profile = { role: "show", plan: "operator" };
    expect((await del(key.id)).status).toBe(403);

    harness.session.profile = { role: "agent", plan: "operator" };
    expect((await del(key.id)).status).toBe(403);
    expect(admin.keys[0]?.revoked_at).toBeNull();
  });

  it("revokes the brand's own active key and returns the allowlist", async () => {
    const key = await createKey({ brandId: BRAND, name: "Planner", scopes: ["read"] });
    const res = await del(key.id);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = await res.json();
    expect(Object.keys(body.key)).toEqual([...API_KEY_RESPONSE_FIELDS]);
    expect(body.key.revoked_at).toEqual(expect.any(String));
    expect(JSON.stringify(body)).not.toContain("key_hash");
    expect(JSON.stringify(body)).not.toContain(key.secret);
    expect(logs.join("\n")).not.toContain(key.secret);
    expect(harness.rate.calls[0]).toMatchObject({
      p_bucket: "api_key_revoke_user_hour",
      p_key: BRAND,
      p_max: 30,
    });
  });

  it("returns 404 for another brand's key, a bad id, and an already revoked key", async () => {
    const foreign = await createKey({ brandId: OTHER, name: "Theirs", scopes: ["read"] });
    const foreignRes = await del(foreign.id);
    expect(foreignRes.status).toBe(404);
    expect(admin.keys.find((key) => key.id === foreign.id)?.revoked_at).toBeNull();

    expect((await del("not-a-uuid")).status).toBe(404);

    const owned = await createKey({ brandId: BRAND, name: "Mine", scopes: ["read"] });
    await revokeKey(owned.id, BRAND);
    expect((await del(owned.id)).status).toBe(404);
  });

  it("returns 403 for a cross-origin revoke and does not revoke", async () => {
    const key = await createKey({ brandId: BRAND, name: "Planner", scopes: ["read"] });
    expect((await del(key.id, "https://evil.example")).status).toBe(403);
    expect((await del(key.id, null)).status).toBe(403);
    expect(admin.keys[0]?.revoked_at).toBeNull();
    expect(harness.rate.calls).toHaveLength(0);
  });

  it("returns 429 and 503 on the revoke bucket without revoking", async () => {
    const key = await createKey({ brandId: BRAND, name: "Planner", scopes: ["read"] });
    harness.rate.mode = "deny";
    const limited = await del(key.id);
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBe("3600");

    harness.rate.mode = "fail";
    const closed = await del(key.id);
    expect(closed.status).toBe(503);
    expect(await closed.json()).toEqual({ error: "unavailable" });
    expect(admin.keys[0]?.revoked_at).toBeNull();
    expect(logs.join("\n")).not.toContain(key.secret);
  });
});
