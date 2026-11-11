import { beforeEach, describe, expect, it, vi } from "vitest";

const BRAND = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const CONV = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";

const mocks = vi.hoisted(() => ({
  user: null as { id: string } | null,
  role: "brand" as string | null,
  getConversation: vi.fn(),
  listMessages: vi.fn(),
  deleteConversation: vi.fn(),
}));

vi.mock("@/lib/data/queries", () => ({
  getAuthenticatedUser: async () => mocks.user,
}));

vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: { from: () => profileQuery() },
}));

vi.mock("@/lib/command-agent/store", async () => {
  const actual = await vi.importActual<typeof import("@/lib/command-agent/store")>(
    "@/lib/command-agent/store"
  );
  return {
    getConversation: (...args: unknown[]) => mocks.getConversation(...args),
    listMessages: (...args: unknown[]) => mocks.listMessages(...args),
    deleteConversation: (...args: unknown[]) => mocks.deleteConversation(...args),
    turnIsFresh: actual.turnIsFresh,
  };
});

import { DELETE, GET } from "./route";

function profileQuery() {
  const api = {
    select() {
      return api;
    },
    eq() {
      return api;
    },
    maybeSingle() {
      return Promise.resolve({ data: mocks.role ? { role: mocks.role } : null, error: null });
    },
  };
  return api;
}

function call(method: "GET" | "DELETE", id = CONV, headers: Record<string, string> = {}) {
  const handler = method === "GET" ? GET : DELETE;
  return handler(
    new Request(`http://localhost/api/assistant/${id}`, {
      method,
      headers: {
        origin: "http://localhost",
        host: "localhost",
        ...headers,
      },
    }),
    { params: Promise.resolve({ id }) }
  );
}

beforeEach(() => {
  mocks.user = { id: BRAND };
  mocks.role = "brand";
  mocks.getConversation.mockReset();
  mocks.listMessages.mockReset();
  mocks.deleteConversation.mockReset();
  mocks.getConversation.mockImplementation(async (brandId: string, id: string) => {
    if (brandId !== BRAND || id !== CONV) return { ok: true, row: null };
    return {
      ok: true,
      row: {
        id: CONV,
        brand_id: BRAND,
        title: "Quarter test",
        created_at: "2026-11-10T00:00:00.000Z",
        updated_at: "2026-11-10T00:00:00.000Z",
        turn_started_at: null,
      },
    };
  });
  mocks.listMessages.mockImplementation(async (brandId: string) => {
    if (brandId !== BRAND) return [{ content: { text: "BRAND_B_SECRET" } }];
    return [
      {
        id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1",
        role: "assistant",
        content: { text: "Scores are in." },
        action_ids: [],
        created_at: "2026-11-10T00:00:01.000Z",
      },
    ];
  });
  mocks.deleteConversation.mockImplementation(async (brandId: string, id: string) => {
    if (brandId !== BRAND || id !== CONV) return "missing";
    return "deleted";
  });
});

describe("GET and DELETE /api/assistant/[id]", () => {
  it("returns 401 with no session and 403 for show, agent, and admin", async () => {
    mocks.user = null;
    expect((await call("GET")).status).toBe(401);
    expect((await call("DELETE")).status).toBe(401);
    mocks.user = { id: BRAND };
    for (const role of ["show", "agent", "admin"]) {
      mocks.role = role;
      expect((await call("GET")).status).toBe(403);
      expect((await call("DELETE")).status).toBe(403);
    }
    expect(mocks.getConversation).not.toHaveBeenCalled();
  });

  it("returns 404 for another brand's conversation on GET and DELETE", async () => {
    mocks.user = { id: OTHER };
    expect((await call("GET")).status).toBe(404);
    expect((await call("DELETE")).status).toBe(404);
    const body = await (await call("GET")).json();
    expect(JSON.stringify(body)).not.toContain("BRAND_B_SECRET");
    expect(mocks.listMessages).not.toHaveBeenCalled();
    expect(mocks.deleteConversation).not.toHaveBeenCalled();
  });

  it("rejects a foreign Origin and a delete while a turn is running", async () => {
    const foreign = await call("DELETE", CONV, { origin: "https://evil.example" });
    expect(foreign.status).toBe(403);
    expect(mocks.deleteConversation).not.toHaveBeenCalled();
    mocks.getConversation.mockResolvedValueOnce({
      ok: true,
      row: {
        id: CONV,
        brand_id: BRAND,
        title: "Quarter test",
        created_at: "2026-11-10T00:00:00.000Z",
        updated_at: "2026-11-10T00:00:00.000Z",
        turn_started_at: new Date().toISOString(),
      },
    });
    const busy = await call("DELETE");
    expect(busy.status).toBe(409);
    expect(mocks.deleteConversation).not.toHaveBeenCalled();
  });

  it("returns the thread and deletes without touching write actions", async () => {
    const response = await call("GET");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(mocks.listMessages).toHaveBeenCalledWith(BRAND, CONV);
    const removed = await call("DELETE");
    expect(removed.status).toBe(200);
    expect(mocks.deleteConversation).toHaveBeenCalledWith(BRAND, CONV);
  });
});
