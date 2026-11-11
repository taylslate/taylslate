import { beforeEach, describe, expect, it, vi } from "vitest";

const BRAND = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const CONV = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const CONV2 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";

const mocks = vi.hoisted(() => ({
  user: null as { id: string } | null,
  role: "brand" as string | null,
  rpc: vi.fn(),
  getConversation: vi.fn(),
  claimTurn: vi.fn(),
  releaseTurn: vi.fn(),
  insertMessage: vi.fn(),
  setTitleIfEmpty: vi.fn(),
  sumTokensSince: vi.fn(),
  runAgentTurn: vi.fn(),
  logEvent: vi.fn(),
  held: false,
}));

vi.mock("@/lib/data/queries", () => ({
  getAuthenticatedUser: async () => mocks.user,
}));

vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: {
    from: (table: string) => {
      if (table !== "profiles") throw new Error(`unexpected table ${table}`);
      return profileQuery();
    },
    rpc: (...args: unknown[]) => mocks.rpc(...args),
  },
}));

vi.mock("@/lib/command-agent/store", () => ({
  getConversation: (...args: unknown[]) => mocks.getConversation(...args),
  claimTurn: (...args: unknown[]) => mocks.claimTurn(...args),
  releaseTurn: (...args: unknown[]) => mocks.releaseTurn(...args),
  insertMessage: (...args: unknown[]) => mocks.insertMessage(...args),
  setTitleIfEmpty: (...args: unknown[]) => mocks.setTitleIfEmpty(...args),
  sumTokensSince: (...args: unknown[]) => mocks.sumTokensSince(...args),
}));

vi.mock("@/lib/command-agent/run", () => ({
  runAgentTurn: (...args: unknown[]) => mocks.runAgentTurn(...args),
}));

vi.mock("@/lib/data/events", () => ({
  logEvent: (...args: unknown[]) => mocks.logEvent(...args),
}));

import { POST } from "./route";

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

function post(
  id = CONV,
  body: unknown = { message: "What did my last campaign score?" },
  headers: Record<string, string> = {},
  raw?: string
) {
  return POST(
    new Request(`http://localhost/api/assistant/${id}/messages`, {
      method: "POST",
      headers: {
        origin: "http://localhost",
        host: "localhost",
        "content-type": "application/json",
        ...headers,
      },
      body: raw ?? JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) }
  );
}

beforeEach(() => {
  mocks.user = { id: BRAND };
  mocks.role = "brand";
  mocks.held = false;
  mocks.rpc.mockReset();
  mocks.getConversation.mockReset();
  mocks.claimTurn.mockReset();
  mocks.releaseTurn.mockReset();
  mocks.insertMessage.mockReset();
  mocks.setTitleIfEmpty.mockReset();
  mocks.sumTokensSince.mockReset();
  mocks.runAgentTurn.mockReset();
  mocks.logEvent.mockReset();
  mocks.rpc.mockResolvedValue({ data: true, error: null });
  mocks.getConversation.mockImplementation(async (brandId: string, id: string) => {
    if (brandId !== BRAND || (id !== CONV && id !== CONV2)) return { ok: true, row: null };
    return {
      ok: true,
      row: {
        id,
        brand_id: BRAND,
        title: null,
        created_at: "2026-11-10T00:00:00.000Z",
        updated_at: "2026-11-10T00:00:00.000Z",
        turn_started_at: null,
      },
    };
  });
  mocks.claimTurn.mockImplementation(async () => {
    if (mocks.held) return "busy";
    mocks.held = true;
    return "claimed";
  });
  mocks.releaseTurn.mockImplementation(async () => {
    mocks.held = false;
  });
  mocks.insertMessage.mockImplementation(async (input: { content: { text: string } }) => ({
    id: "dddddddd-dddd-4ddd-8ddd-ddddddddddd1",
    role: "user",
    content: input.content,
    action_ids: [],
    created_at: "2026-11-10T00:00:02.000Z",
  }));
  mocks.sumTokensSince.mockResolvedValue({ ok: true, total: 0 });
  mocks.runAgentTurn.mockResolvedValue({
    ok: true,
    messages: [
      {
        id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1",
        role: "assistant",
        content: { text: "Scores are in." },
        action_ids: [],
        created_at: "2026-11-10T00:00:03.000Z",
      },
    ],
  });
  mocks.logEvent.mockResolvedValue(null);
});

describe("POST /api/assistant/[id]/messages", () => {
  it("returns 401 with no session and 403 for show, agent, and admin", async () => {
    mocks.user = null;
    expect((await post()).status).toBe(401);
    mocks.user = { id: BRAND };
    for (const role of ["show", "agent", "admin"]) {
      mocks.role = role;
      expect((await post()).status).toBe(403);
    }
    expect(mocks.runAgentTurn).not.toHaveBeenCalled();
  });

  it("rejects a foreign Origin before the turn", async () => {
    const response = await post(CONV, { message: "hello" }, { origin: "https://evil.example" });
    expect(response.status).toBe(403);
    expect(mocks.runAgentTurn).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("returns 404 for another brand and passes only the session brand into the turn", async () => {
    mocks.user = { id: OTHER };
    const response = await post();
    expect(response.status).toBe(404);
    expect(mocks.runAgentTurn).not.toHaveBeenCalled();
    mocks.user = { id: BRAND };
    const ok = await post();
    expect(ok.status).toBe(200);
    expect(mocks.runAgentTurn).toHaveBeenCalledWith(
      expect.objectContaining({ brandId: BRAND, conversationId: CONV })
    );
    expect(mocks.getConversation).toHaveBeenCalledWith(BRAND, CONV);
  });

  it("returns 429 with Retry-After for the hour and day buckets", async () => {
    mocks.rpc.mockImplementation(async (_name: string, args: { p_bucket: string }) => {
      if (args.p_bucket === "command_agent_user_hour") return { data: false, error: null };
      return { data: true, error: null };
    });
    const hour = await post();
    expect(hour.status).toBe(429);
    expect(hour.headers.get("Retry-After")).toBe("3600");
    mocks.rpc.mockImplementation(async (_name: string, args: { p_bucket: string }) => {
      if (args.p_bucket === "command_agent_user_day") return { data: false, error: null };
      return { data: true, error: null };
    });
    const day = await post();
    expect(day.status).toBe(429);
    expect(day.headers.get("Retry-After")).toBe("86400");
    expect(mocks.runAgentTurn).not.toHaveBeenCalled();
  });

  it("stays capped on the next post after a conversation delete", async () => {
    mocks.sumTokensSince.mockResolvedValue({ ok: true, total: 300_000 });
    const response = await post();
    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({
      error: "Daily assistant limit reached. Try again tomorrow.",
    });
    expect(mocks.runAgentTurn).not.toHaveBeenCalled();
    expect(mocks.sumTokensSince).toHaveBeenCalledWith(BRAND, expect.any(String));
  });

  it("returns 409 for a second conversation while a turn is running", async () => {
    mocks.runAgentTurn.mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve({ ok: true, messages: [] }), 40))
    );
    const [first, second] = await Promise.all([post(CONV), post(CONV2)]);
    expect([first.status, second.status].sort()).toEqual([200, 409]);
    expect(mocks.runAgentTurn).toHaveBeenCalledTimes(1);
  });

  it("returns 429 at 300000 tokens and 503 when the cap cannot be read", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    mocks.sumTokensSince.mockResolvedValueOnce({ ok: true, total: 300_000 });
    const capped = await post(CONV, { message: "SECRET_MESSAGE_TEXT" });
    expect(capped.status).toBe(429);
    expect(await capped.json()).toEqual({
      error: "Daily assistant limit reached. Try again tomorrow.",
    });
    expect(mocks.logEvent).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: "command_agent.cap_hit", actorId: BRAND })
    );
    expect(JSON.stringify(mocks.logEvent.mock.calls)).not.toContain("SECRET_MESSAGE_TEXT");
    expect(info.mock.calls.flat().join(" ")).not.toContain("SECRET_MESSAGE_TEXT");
    mocks.sumTokensSince.mockResolvedValueOnce({ ok: false });
    expect((await post()).status).toBe(503);
    expect(mocks.runAgentTurn).not.toHaveBeenCalled();
    info.mockRestore();
  });

  it("returns 503 when the rate limit read fails", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "down" } });
    expect((await post()).status).toBe(503);
    expect(mocks.runAgentTurn).not.toHaveBeenCalled();
  });

  it("rejects a second turn while one is running", async () => {
    mocks.runAgentTurn.mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve({ ok: true, messages: [] }), 40))
    );
    const [first, second] = await Promise.all([post(), post()]);
    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual([200, 409]);
    expect(mocks.runAgentTurn).toHaveBeenCalledTimes(1);
    expect(mocks.releaseTurn).toHaveBeenCalled();
  });

  it("rejects an unknown field, a huge body, and non-JSON", async () => {
    expect((await post(CONV, { message: "hi", brand_id: BRAND })).status).toBe(422);
    expect((await post(CONV, { message: "" })).status).toBe(422);
    expect((await post(CONV, null, { "content-type": "text/plain" }, "hi")).status).toBe(415);
    expect((await post(CONV, { message: "a".repeat(20_000) })).status).toBe(413);
    expect(mocks.runAgentTurn).not.toHaveBeenCalled();
  });
});
