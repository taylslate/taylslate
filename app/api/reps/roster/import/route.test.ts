import { beforeEach, describe, expect, it, vi } from "vitest";

const bridge = vi.hoisted(() => ({
  getUser: vi.fn(),
  getUserProfile: vi.fn(),
  userFrom: vi.fn(),
  isShowsAdmin: vi.fn(async (_userId: string) => false),
  ops: [] as { op: string; table: string; row: Record<string, unknown> | null }[],
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: bridge.getUser },
    from: (...args: unknown[]) => bridge.userFrom(...args),
  }),
}));

vi.mock("@/lib/data/queries", () => ({
  getUserProfile: (...args: unknown[]) => bridge.getUserProfile(...args),
}));

vi.mock("@/lib/shows/can-edit-show", () => ({
  isShowsAdmin: (userId: string) => bridge.isShowsAdmin(userId),
}));

vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: {
    from: (table: string) => adminFrom(table),
  },
}));

import { POST } from "./route";

const AGENT = "agent-session";

function adminFrom(table: string) {
  const query: {
    op: "select" | "insert" | "update" | "delete";
    row: Record<string, unknown> | null;
  } = { op: "select", row: null };

  const run = () => {
    bridge.ops.push({ op: query.op, table, row: query.row ? { ...query.row } : null });
    if (query.op === "select") return { data: [], error: null };
    if (query.op === "insert") {
      const id = table === "shows" ? "show-new" : "link-new";
      return { data: { id, ...(query.row ?? {}) }, error: null };
    }
    return { data: null, error: null };
  };

  const builder: Record<string, unknown> = {};
  builder.select = () => builder;
  builder.insert = (row: Record<string, unknown>) => {
    query.op = "insert";
    query.row = row;
    return builder;
  };
  builder.update = (row: Record<string, unknown>) => {
    query.op = "update";
    query.row = row;
    return builder;
  };
  builder.delete = () => {
    query.op = "delete";
    return builder;
  };
  builder.eq = () => builder;
  builder.in = () => builder;
  builder.ilike = () => builder;
  builder.limit = () => builder;
  builder.single = async () => {
    const result = run();
    return { data: result.data, error: result.error };
  };
  builder.then = (
    resolve: (value: unknown) => unknown,
    reject?: (reason: unknown) => unknown
  ) => Promise.resolve(run()).then(resolve, reject);
  return builder;
}

function call(url: string, body: string, contentType = "application/json") {
  return POST(
    new Request(url, {
      method: "POST",
      headers: { "content-type": contentType },
      body,
    })
  );
}

beforeEach(() => {
  bridge.getUser.mockReset();
  bridge.getUserProfile.mockReset();
  bridge.userFrom.mockReset();
  bridge.isShowsAdmin.mockReset();
  bridge.isShowsAdmin.mockResolvedValue(false);
  bridge.ops.length = 0;
  bridge.userFrom.mockImplementation(() => {
    throw new Error("authenticated client should not be used");
  });
});

describe("POST /api/reps/roster/import", () => {
  it("returns 401 when nobody is signed in", async () => {
    bridge.getUser.mockResolvedValue({ data: { user: null } });
    const res = await call(
      "http://x/api/reps/roster/import",
      JSON.stringify({ rows: [{ name: "Desk", platform: "podcast" }] })
    );
    expect(res.status).toBe(401);
    expect(bridge.ops).toEqual([]);
    expect(bridge.userFrom).not.toHaveBeenCalled();
  });

  it("returns 403 when the signed-in user is not an agent", async () => {
    bridge.getUser.mockResolvedValue({ data: { user: { id: "brand-1" } } });
    bridge.getUserProfile.mockResolvedValue({ id: "brand-1", role: "brand" });
    const res = await call(
      "http://x/api/reps/roster/import?mode=commit",
      JSON.stringify({ rows: [{ name: "Desk", platform: "podcast" }] })
    );
    expect(res.status).toBe(403);
    expect(bridge.ops).toEqual([]);
    expect(bridge.userFrom).not.toHaveBeenCalled();
  });

  it("previews with no writes and ignores a caller-supplied agent id", async () => {
    bridge.getUser.mockResolvedValue({ data: { user: { id: AGENT } } });
    bridge.getUserProfile.mockResolvedValue({ id: AGENT, role: "agent" });
    const res = await call(
      "http://x/api/reps/roster/import?agentId=agent-b",
      JSON.stringify({
        rows: [{ name: "Desk", platform: "podcast", agent_id: "agent-b" }],
      })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.mode).toBe("preview");
    expect(body.rows[0].class).toBe("new_show");
    expect(body.rows[0].committed).toBe(false);
    expect(bridge.ops.every((op) => op.op === "select")).toBe(true);
    expect(bridge.userFrom).not.toHaveBeenCalled();
    expect(bridge.isShowsAdmin).not.toHaveBeenCalled();
  });

  it("commits through supabaseAdmin for the session agent", async () => {
    bridge.getUser.mockResolvedValue({ data: { user: { id: AGENT } } });
    bridge.getUserProfile.mockResolvedValue({ id: AGENT, role: "agent" });
    const res = await call(
      "http://x/api/reps/roster/import?mode=commit",
      JSON.stringify({
        rows: [{ name: "Desk", platform: "podcast", agent_id: "agent-b", podscan_id: "pd_x" }],
      })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.mode).toBe("commit");
    expect(body.rows[0]).toMatchObject({
      class: "new_show",
      committed: true,
      show_id: "show-new",
      link_id: "link-new",
    });
    const show = bridge.ops.find((op) => op.op === "insert" && op.table === "shows");
    const link = bridge.ops.find(
      (op) => op.op === "insert" && op.table === "agent_show_relationships"
    );
    expect(show?.row).toMatchObject({
      agent_id: AGENT,
      is_discoverable: false,
      name: "Desk",
      platform: "podcast",
    });
    expect(show?.row).not.toHaveProperty("is_claimed");
    expect(show?.row).not.toHaveProperty("podscan_id");
    expect(show?.row).not.toHaveProperty("agent_id", "agent-b");
    expect(link?.row).toMatchObject({
      agent_id: AGENT,
      show_id: "show-new",
      status: "pending",
      source: "import",
      is_exclusive: true,
    });
    expect(bridge.ops.some((op) => op.op === "update")).toBe(false);
    expect(bridge.userFrom).not.toHaveBeenCalled();
    expect(bridge.isShowsAdmin).toHaveBeenCalledWith(AGENT);
  });

  it("rejects an unknown mode, an empty file, and a body over 1 MB", async () => {
    bridge.getUser.mockResolvedValue({ data: { user: { id: AGENT } } });
    bridge.getUserProfile.mockResolvedValue({ id: AGENT, role: "agent" });

    const mode = await call(
      "http://x/api/reps/roster/import?mode=approve",
      JSON.stringify({ rows: [{ name: "Desk", platform: "podcast" }] })
    );
    expect(mode.status).toBe(400);

    const empty = await call(
      "http://x/api/reps/roster/import",
      JSON.stringify({ rows: [] })
    );
    expect(empty.status).toBe(400);

    const big = await call(
      "http://x/api/reps/roster/import",
      JSON.stringify({ rows: [{ name: "x".repeat(1024 * 1024), platform: "podcast" }] })
    );
    expect(big.status).toBe(413);
    expect(bridge.ops).toEqual([]);
    expect(bridge.userFrom).not.toHaveBeenCalled();
  });
});
