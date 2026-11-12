// claimShow and importShows write roster links as service_role.
// A pending row is not an approved relationship.

import { beforeEach, describe, expect, it, vi } from "vitest";

const { adminFrom, userFrom, getUser } = vi.hoisted(() => ({
  adminFrom: vi.fn(),
  userFrom: vi.fn(),
  getUser: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: { from: (...args: unknown[]) => adminFrom(...args) },
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser },
    from: (...args: unknown[]) => userFrom(...args),
  }),
}));

import { claimShow, getAgentShowRelationship, importShows } from "./queries";

type RowResult = { data: unknown; error: { message: string; code?: string } | null };

function chain(result: RowResult, onInsert?: (row: unknown) => void) {
  const builder: Record<string, unknown> = {};
  const self = () => builder;
  builder.select = vi.fn(self);
  builder.eq = vi.fn(self);
  builder.ilike = vi.fn(self);
  builder.limit = vi.fn(self);
  builder.insert = vi.fn((row: unknown) => {
    onInsert?.(row);
    return builder;
  });
  builder.delete = vi.fn(self);
  builder.single = vi.fn(async () => result);
  builder.maybeSingle = vi.fn(async () => result);
  builder.then = (
    resolve: (value: RowResult) => unknown,
    reject?: (reason: unknown) => unknown
  ) => Promise.resolve(result).then(resolve, reject);
  return builder;
}

describe("claimShow", () => {
  beforeEach(() => {
    adminFrom.mockReset();
    userFrom.mockReset();
    getUser.mockReset();
  });

  it("inserts a pending claim for the signed-in user via the admin client", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "agent-1" } } });
    let inserted: Record<string, unknown> | null = null;
    adminFrom.mockImplementation((table: string) => {
      expect(table).toBe("agent_show_relationships");
      return chain(
        {
          data: {
            id: "rel-1",
            agent_id: "agent-1",
            show_id: "show-1",
            is_exclusive: false,
            status: "pending",
            source: "claim",
            created_at: "2026-10-21T00:00:00Z",
          },
          error: null,
        },
        (row) => {
          inserted = row as Record<string, unknown>;
        }
      );
    });

    const relationship = await claimShow("show-1", 0.15);
    expect(inserted).toEqual({
      agent_id: "agent-1",
      show_id: "show-1",
      commission_rate: 0.15,
      is_exclusive: false,
      status: "pending",
      source: "claim",
    });
    expect(relationship.status).toBe("pending");
    expect(userFrom).not.toHaveBeenCalled();
  });

  it("throws when the insert fails", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "agent-1" } } });
    adminFrom.mockImplementation(() =>
      chain({ data: null, error: { message: "duplicate key" } })
    );
    await expect(claimShow("show-1")).rejects.toThrow(/duplicate key/);
  });

  it("throws when nobody is signed in and does not write", async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    await expect(claimShow("show-1")).rejects.toThrow(/Sign in/);
    expect(adminFrom).not.toHaveBeenCalled();
  });
});

describe("importShows", () => {
  beforeEach(() => {
    adminFrom.mockReset();
    userFrom.mockReset();
    getUser.mockReset();
    getUser.mockResolvedValue({ data: { user: { id: "agent-1" } } });
  });

  function asAgent(role = "agent") {
    userFrom.mockImplementation((table: string) => {
      if (table === "profiles") {
        return chain({ data: { id: "agent-1", role }, error: null });
      }
      if (table === "agent_show_relationships") {
        return chain({ data: [], error: null });
      }
      return chain({
        data: { id: "show-new", name: "Night Desk", platform: "podcast" },
        error: null,
      });
    });
  }

  it("inserts a pending exclusive import link for the signed-in agent", async () => {
    let inserted: Record<string, unknown> | null = null;
    let showRow: Record<string, unknown> | null = null;
    userFrom.mockImplementation((table: string) => {
      if (table === "profiles") {
        return chain({
          data: { id: "agent-1", role: "agent", email: "agent@example.com" },
          error: null,
        });
      }
      if (table === "agent_show_relationships") {
        return chain({ data: [], error: null });
      }
      return chain({ data: null, error: null });
    });
    adminFrom.mockImplementation((table: string) => {
      if (table === "shows") {
        return chain(
          {
            data: { id: "show-new", name: "Night Desk", platform: "podcast" },
            error: null,
          },
          (row) => {
            showRow = row as Record<string, unknown>;
          }
        );
      }
      expect(table).toBe("agent_show_relationships");
      return chain({ data: null, error: null }, (row) => {
        inserted = row as Record<string, unknown>;
      });
    });

    const result = await importShows([
      {
        name: "Night Desk",
        platform: "podcast",
        agent_id: "someone-else",
        is_discoverable: true,
      },
    ]);
    expect(inserted).toMatchObject({
      agent_id: "agent-1",
      show_id: "show-new",
      status: "pending",
      source: "import",
      is_exclusive: true,
    });
    expect(showRow).toMatchObject({ agent_id: "agent-1", is_discoverable: false });
    expect(showRow).not.toHaveProperty("is_exclusive");
    expect(result.imported).toHaveLength(1);
    expect(result.skipped).toEqual([]);
    expect(result.errors).toEqual([]);
  });

  it("skips a catalog match and inserts no show and no link", async () => {
    asAgent();
    const insertedShows: unknown[] = [];
    const insertedLinks: unknown[] = [];
    adminFrom.mockImplementation((table: string) => {
      if (table !== "shows") {
        return chain({ data: null, error: null }, (row) => {
          insertedLinks.push(row);
        });
      }
      let inserted = false;
      const builder: Record<string, unknown> = {};
      const self = () => builder;
      builder.select = vi.fn(self);
      builder.ilike = vi.fn(self);
      builder.limit = vi.fn(self);
      builder.eq = vi.fn(self);
      builder.insert = vi.fn((row: unknown) => {
        inserted = true;
        insertedShows.push(row);
        return builder;
      });
      builder.single = vi.fn(async () => ({
        data: { id: "show-new", name: "The Daily Podcast", platform: "podcast" },
        error: null,
      }));
      builder.then = (resolve: (value: unknown) => unknown) =>
        Promise.resolve(
          inserted
            ? { data: { id: "show-new" }, error: null }
            : {
                data: [
                  {
                    id: "catalog-1",
                    name: "daily",
                    agent_id: "someone-else",
                    is_discoverable: true,
                    rss_url: null,
                  },
                ],
                error: null,
              }
        ).then(resolve);
      return builder;
    });

    const result = await importShows([
      { name: "The Daily Podcast", platform: "podcast" },
    ]);
    expect(result.skipped).toEqual(["The Daily Podcast"]);
    expect(result.imported).toEqual([]);
    expect(result.errors).toEqual([]);
    expect(insertedShows).toEqual([]);
    expect(insertedLinks).toEqual([]);
  });

  it("inserts once when two rows in one file share a normalized name", async () => {
    const showInserts: unknown[] = [];
    const linkInserts: unknown[] = [];
    userFrom.mockImplementation((table: string) => {
      if (table === "profiles") {
        return chain({ data: { id: "agent-1", role: "agent" }, error: null });
      }
      if (table === "agent_show_relationships") {
        return chain({ data: [], error: null });
      }
      return chain({ data: null, error: null });
    });
    adminFrom.mockImplementation((table: string) => {
      if (table !== "shows") {
        return chain({ data: null, error: null }, (row) => {
          linkInserts.push(row);
        });
      }
      let lookup = true;
      const builder: Record<string, unknown> = {};
      const self = () => builder;
      builder.select = vi.fn(self);
      builder.ilike = vi.fn(self);
      builder.limit = vi.fn(self);
      builder.insert = vi.fn((row: unknown) => {
        lookup = false;
        showInserts.push(row);
        return builder;
      });
      builder.single = vi.fn(async () => ({
        data: { id: "show-new", name: "The Daily Podcast", platform: "podcast" },
        error: null,
      }));
      builder.then = (resolve: (value: unknown) => unknown) =>
        Promise.resolve(
          lookup ? { data: [], error: null } : { data: { id: "show-new" }, error: null }
        ).then(resolve);
      return builder;
    });

    const result = await importShows([
      { name: "The Daily Podcast", platform: "podcast" },
      { name: "Daily", platform: "podcast" },
    ]);
    expect(showInserts).toHaveLength(1);
    expect(linkInserts).toHaveLength(1);
    expect(linkInserts[0]).toMatchObject({
      agent_id: "agent-1",
      show_id: "show-new",
      status: "pending",
      source: "import",
    });
    expect(showInserts[0]).toMatchObject({
      agent_id: "agent-1",
      is_discoverable: false,
    });
    expect(result.imported).toHaveLength(1);
    expect(result.skipped).toEqual(["Daily"]);
    expect(result.errors).toEqual([]);
  });

  it("does not publish a roster when profiles.email is an admin and the login is not", async () => {
    process.env.INTERNAL_ADMIN_EMAILS = "ops@taylslate.com";
    getUser.mockResolvedValue({
      data: { user: { id: "agent-1", email: "agent@example.com" } },
    });
    let showRow: Record<string, unknown> | null = null;
    userFrom.mockImplementation((table: string) => {
      if (table === "profiles") {
        return chain({
          data: { id: "agent-1", role: "agent", email: "ops@taylslate.com" },
          error: null,
        });
      }
      if (table === "agent_show_relationships") {
        return chain({ data: [], error: null });
      }
      return chain({ data: null, error: null });
    });
    adminFrom.mockImplementation((table: string) => {
      if (table === "shows") {
        return chain(
          { data: { id: "show-new", name: "Night Desk", platform: "podcast" }, error: null },
          (row) => {
            showRow = row as Record<string, unknown>;
          }
        );
      }
      return chain({ data: null, error: null });
    });

    await importShows([
      { name: "Night Desk", platform: "podcast", is_discoverable: true },
    ]);
    expect(showRow).toMatchObject({ is_discoverable: false });
    delete process.env.INTERNAL_ADMIN_EMAILS;
  });

  it("stores is_exclusive false when the row says so", async () => {
    const inserted: Record<string, unknown>[] = [];
    asAgent();
    adminFrom.mockImplementation((table: string) => {
      if (table !== "agent_show_relationships") {
        return chain({
          data: { id: "show-new", name: "Night Desk", platform: "podcast" },
          error: null,
        });
      }
      return chain({ data: null, error: null }, (row) => {
        inserted.push(row as Record<string, unknown>);
      });
    });

    await importShows([
      { name: "Night Desk", platform: "podcast", is_exclusive: false },
      { name: "Day Desk", platform: "podcast", is_exclusive: true },
    ]);
    expect(inserted.map((row) => row.is_exclusive)).toEqual([false, true]);
    expect(inserted.every((row) => row.agent_id === "agent-1")).toBe(true);
  });

  it("throws when nobody is signed in and does not write", async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    await expect(
      importShows([{ name: "Night Desk", platform: "podcast" }])
    ).rejects.toThrow(/Sign in/);
    expect(userFrom).not.toHaveBeenCalled();
    expect(adminFrom).not.toHaveBeenCalled();
  });

  it("throws when the signed-in user is not an agent and does not write", async () => {
    asAgent("brand");
    await expect(
      importShows([{ name: "Night Desk", platform: "podcast" }])
    ).rejects.toThrow(/Only agents/);
    expect(adminFrom).not.toHaveBeenCalled();
    expect(userFrom.mock.calls.map((call) => call[0])).toEqual(["profiles"]);
  });

  it("removes the new show when the roster link fails", async () => {
    const deleted: string[] = [];
    asAgent();
    adminFrom.mockImplementation((table: string) => {
      if (table === "shows") {
        const builder = chain({
          data: { id: "show-new", name: "Night Desk", platform: "podcast" },
          error: null,
        });
        builder.eq = vi.fn((column: string, value: string) => {
          if (column === "id") deleted.push(value);
          return builder;
        });
        return builder;
      }
      return chain({ data: null, error: { message: "roster write refused" } });
    });

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await importShows([{ name: "Night Desk", platform: "podcast" }]);
    expect(result.imported).toEqual([]);
    expect(result.errors).toEqual(["Night Desk: could not be imported."]);
    expect(result.errors.join(" ")).not.toContain("roster write refused");
    expect(result.errors.join(" ")).not.toContain("show-new");
    expect(deleted).toEqual(["show-new"]);
    const logged = errorSpy.mock.calls.flat().map(String).join(" ");
    expect(logged).not.toContain("roster write refused");
    expect(logged).not.toContain("show-new");
    errorSpy.mockRestore();
  });

  it("uses fixed text when the new show cannot be removed", async () => {
    asAgent();
    adminFrom.mockImplementation((table: string) => {
      if (table === "shows") {
        let deleted = false;
        const builder = chain({
          data: { id: "show-left", name: "Night Desk", platform: "podcast" },
          error: null,
        });
        builder.delete = vi.fn(() => {
          deleted = true;
          return builder;
        });
        builder.then = (
          resolve: (value: unknown) => unknown,
          reject?: (reason: unknown) => unknown
        ) =>
          Promise.resolve(
            deleted
              ? { data: null, error: { message: "delete refused for show-left", code: "42501" } }
              : { data: [], error: null }
          ).then(resolve, reject);
        builder.single = vi.fn(async () => ({
          data: { id: "show-left", name: "Night Desk", platform: "podcast" },
          error: null,
        }));
        return builder;
      }
      return chain({ data: null, error: { message: "roster write refused", code: "23503" } });
    });

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await importShows([{ name: "Night Desk", platform: "podcast" }]);
    expect(result.errors).toEqual(["Night Desk: could not be imported. Contact support."]);
    expect(result.errors.join(" ")).not.toContain("show-left");
    expect(result.errors.join(" ")).not.toContain("delete refused");
    expect(result.errors.join(" ")).not.toContain("23503");
    const logged = errorSpy.mock.calls.flat().map(String).join(" ");
    expect(logged).toContain("23503");
    expect(logged).toContain("42501");
    expect(logged).not.toContain("delete refused");
    expect(logged).not.toContain("show-left");
    errorSpy.mockRestore();
  });
});

describe("getAgentShowRelationship", () => {
  beforeEach(() => {
    adminFrom.mockReset();
    userFrom.mockReset();
    getUser.mockReset();
  });

  it("does not return a pending link", async () => {
    const filters: Record<string, unknown> = {};
    userFrom.mockImplementation(() => {
      const builder = chain({ data: null, error: null });
      builder.eq = vi.fn((column: string, value: unknown) => {
        filters[column] = value;
        return builder;
      });
      builder.maybeSingle = vi.fn(async () => {
        if (filters.status === "approved") return { data: null, error: null };
        return {
          data: {
            id: "rel-pending",
            agent_id: "agent-1",
            show_id: "show-1",
            status: "pending",
            is_exclusive: false,
            created_at: "2026-10-21T00:00:00Z",
          },
          error: null,
        };
      });
      return builder;
    });

    const relationship = await getAgentShowRelationship("agent-1", "show-1");
    expect(filters.status).toBe("approved");
    expect(relationship).toBeNull();
  });
});
