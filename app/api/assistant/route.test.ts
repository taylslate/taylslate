import { beforeEach, describe, expect, it, vi } from "vitest";

const BRAND = "11111111-1111-4111-8111-111111111111";

const mocks = vi.hoisted(() => ({
  user: null as { id: string } | null,
  role: "brand" as string | null,
  roleError: false,
  listConversations: vi.fn(),
  createConversation: vi.fn(),
}));

vi.mock("@/lib/data/queries", () => ({
  getAuthenticatedUser: async () => mocks.user,
}));

vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: { from: () => profileQuery() },
}));

vi.mock("@/lib/command-agent/store", () => ({
  listConversations: (...args: unknown[]) => mocks.listConversations(...args),
  createConversation: (...args: unknown[]) => mocks.createConversation(...args),
}));

import { GET, POST } from "./route";

function profileQuery() {
  const api = {
    select() {
      return api;
    },
    eq() {
      return api;
    },
    maybeSingle() {
      if (mocks.roleError) return Promise.resolve({ data: null, error: { message: "down" } });
      return Promise.resolve({ data: mocks.role ? { role: mocks.role } : null, error: null });
    },
  };
  return api;
}

function post(body: unknown, headers: Record<string, string> = {}, raw?: string) {
  return POST(
    new Request("http://localhost/api/assistant", {
      method: "POST",
      headers: {
        origin: "http://localhost",
        host: "localhost",
        "content-type": "application/json",
        ...headers,
      },
      body: raw ?? JSON.stringify(body),
    })
  );
}

beforeEach(() => {
  mocks.user = { id: BRAND };
  mocks.role = "brand";
  mocks.roleError = false;
  mocks.listConversations.mockReset();
  mocks.createConversation.mockReset();
  mocks.listConversations.mockResolvedValue([]);
  mocks.createConversation.mockResolvedValue({
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
    brand_id: BRAND,
    title: null,
    created_at: "2026-11-10T00:00:00.000Z",
    updated_at: "2026-11-10T00:00:00.000Z",
    turn_started_at: null,
  });
});

describe("GET and POST /api/assistant", () => {
  it("returns 401 with no session and 403 for show, agent, and admin", async () => {
    mocks.user = null;
    expect((await GET()).status).toBe(401);
    expect((await post({})).status).toBe(401);
    mocks.user = { id: BRAND };
    for (const role of ["show", "agent", "admin"]) {
      mocks.role = role;
      expect((await GET()).status).toBe(403);
      expect((await post({})).status).toBe(403);
    }
  });

  it("rejects a foreign Origin on POST", async () => {
    const response = await post({}, { origin: "https://evil.example" });
    expect(response.status).toBe(403);
    expect(mocks.createConversation).not.toHaveBeenCalled();
  });

  it("rejects a non-JSON body, unknown keys, and a body over 16 KB", async () => {
    expect((await post(null, { "content-type": "text/plain" }, "hello")).status).toBe(415);
    expect((await post({ title: "Plan", message: "nope" })).status).toBe(422);
    const huge = await post({ title: "a".repeat(20_000) });
    expect(huge.status).toBe(413);
    expect(mocks.createConversation).not.toHaveBeenCalled();
  });

  it("lists and creates only for the session brand", async () => {
    const listed = await GET();
    expect(listed.headers.get("Cache-Control")).toBe("no-store");
    expect(mocks.listConversations).toHaveBeenCalledWith(BRAND);
    const created = await post({ title: "Quarter test" });
    expect(created.status).toBe(200);
    expect(mocks.createConversation).toHaveBeenCalledWith(BRAND, "Quarter test");
    const body = (await created.json()) as { conversation: { turn_started_at?: string } };
    expect(body.conversation.turn_started_at).toBeUndefined();
  });
});
