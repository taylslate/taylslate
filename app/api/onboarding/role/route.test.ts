import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const USER_ID = "22222222-2222-4222-8222-222222222222";

const { getAuthenticatedUser, writes, tables } = vi.hoisted(() => ({
  getAuthenticatedUser: vi.fn(),
  writes: [] as Array<{ table: string; op: string; payload: unknown }>,
  tables: {} as Record<string, { data: unknown; error: unknown; count: number | null }>,
}));

vi.mock("@/lib/data/queries", () => ({
  getAuthenticatedUser: (...a: unknown[]) => getAuthenticatedUser(...a),
}));

vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: {
    from: (table: string) => {
      const result = tables[table] ?? { data: null, error: null, count: 0 };
      const builder = {
        select() {
          return builder;
        },
        eq() {
          return builder;
        },
        insert(payload: unknown) {
          writes.push({ table, op: "insert", payload });
          return builder;
        },
        update(payload: unknown) {
          writes.push({ table, op: "update", payload });
          return builder;
        },
        maybeSingle: () => Promise.resolve(result),
        then(onFulfilled: (value: typeof result) => unknown, onRejected?: (reason: unknown) => unknown) {
          return Promise.resolve(result).then(onFulfilled, onRejected);
        },
      };
      return builder;
    },
  },
}));

import { POST } from "./route";

function post(body: unknown): NextRequest {
  return new NextRequest("http://x/api/onboarding/role", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function openProfile(role: string | null = "brand") {
  tables.profiles = { data: { id: USER_ID, role }, error: null, count: null };
  tables.brand_profiles = { data: null, error: null, count: null };
  tables.show_profiles = { data: null, error: null, count: null };
  tables.campaigns = { data: null, error: null, count: 0 };
  tables.agent_show_relationships = { data: null, error: null, count: 0 };
}

beforeEach(() => {
  vi.clearAllMocks();
  writes.length = 0;
  getAuthenticatedUser.mockResolvedValue({ id: USER_ID, email: "owner@example.com" });
  openProfile("brand");
});

describe("POST /api/onboarding/role", () => {
  it("returns 401 with no session", async () => {
    getAuthenticatedUser.mockResolvedValue(null);
    const res = await POST(post({ role: "brand" }));
    expect(res.status).toBe(401);
    expect(writes).toEqual([]);
  });

  it("rejects admin", async () => {
    const res = await POST(post({ role: "admin" }));
    expect(res.status).toBe(400);
    expect(writes).toEqual([]);
  });

  it("rejects a role outside the allowlist", async () => {
    const res = await POST(post({ role: "show" }));
    expect(res.status).toBe(400);
    expect(writes).toEqual([]);
  });

  it("rejects a second role change once onboarding is finished", async () => {
    tables.brand_profiles = {
      data: { onboarded_at: "2026-04-21T00:00:00Z" },
      error: null,
      count: null,
    };
    const res = await POST(post({ role: "agency" }));
    expect(res.status).toBe(403);
    expect(writes).toEqual([]);
  });

  it("sets the role and tier free on a valid first pick", async () => {
    const res = await POST(post({ role: "agent" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ role: "agent", tier: "free" });
    expect(writes).toEqual([
      { table: "profiles", op: "update", payload: { role: "agent", tier: "free" } },
    ]);
  });
});
