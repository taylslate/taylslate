import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;

const { adminFrom, isShowsAdmin, tables } = vi.hoisted(() => ({
  adminFrom: vi.fn(),
  isShowsAdmin: vi.fn(),
  tables: {
    links: [] as Row[],
    calls: [] as string[],
  },
}));

vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: { from: (...args: unknown[]) => adminFrom(...args) },
}));
vi.mock("@/lib/shows/can-edit-show", () => ({
  isShowsAdmin: (...args: unknown[]) => isShowsAdmin(...args),
}));

import { listPendingRosterLinks, rejectRosterLink, rosterReviewNote } from "./roster-review";

function matches(row: Row, filters: { column: string; value: unknown }[], ins: { column: string; values: unknown[] }[]) {
  for (const filter of filters) {
    if (row[filter.column] !== filter.value) return false;
  }
  for (const item of ins) {
    if (!item.values.includes(row[item.column])) return false;
  }
  return true;
}

function installAdmin() {
  adminFrom.mockImplementation((table: string) => {
    tables.calls.push(table);
    const filters: { column: string; value: unknown }[] = [];
    const ins: { column: string; values: unknown[] }[] = [];
    let patch: Row | null = null;
    const builder: Record<string, unknown> = {};
    const self = () => builder;
    builder.select = vi.fn(self);
    builder.eq = vi.fn((column: string, value: unknown) => {
      filters.push({ column, value });
      return builder;
    });
    builder.in = vi.fn((column: string, values: unknown[]) => {
      ins.push({ column, values });
      return builder;
    });
    builder.order = vi.fn(self);
    builder.update = vi.fn((row: Row) => {
      patch = row;
      return builder;
    });
    builder.maybeSingle = vi.fn(async () => {
      if (table !== "agent_show_relationships" || !patch) {
        return { data: null, error: null };
      }
      const current = tables.links.find((row) => matches(row, filters, ins));
      if (!current) return { data: null, error: null };
      Object.assign(current, patch);
      return { data: { id: current.id, status: current.status }, error: null };
    });
    builder.then = (
      resolve: (value: { data: Row[] | null; error: null }) => unknown,
      reject?: (reason: unknown) => unknown
    ) => {
      const data =
        table === "agent_show_relationships"
          ? tables.links.filter((row) => matches(row, filters, ins))
          : [];
      return Promise.resolve({ data, error: null }).then(resolve, reject);
    };
    return builder;
  });
}

beforeEach(() => {
  adminFrom.mockReset();
  isShowsAdmin.mockReset();
  tables.links = [];
  tables.calls = [];
  installAdmin();
});

describe("rosterReviewNote", () => {
  it("rejects an empty note and a note past 500 characters", () => {
    expect(rosterReviewNote("")).toBeNull();
    expect(rosterReviewNote("   ")).toBeNull();
    expect(rosterReviewNote(12)).toBeNull();
    expect(rosterReviewNote("a".repeat(501))).toBeNull();
    expect(rosterReviewNote(`  ${"a".repeat(500)}  `)).toBe("a".repeat(500));
  });
});

describe("listPendingRosterLinks", () => {
  it("lists pending links oldest first with live exclusive conflict context", async () => {
    tables.links = [
      {
        id: "newer",
        agent_id: "agent-2",
        show_id: "show-1",
        status: "pending",
        source: "import",
        is_exclusive: true,
        created_at: "2026-04-02T00:00:00Z",
        shows: { name: "Odd Lots", is_discoverable: false, agent_id: "agent-9" },
        profiles: { email: "lena@example.com" },
      },
      {
        id: "older",
        agent_id: "agent-1",
        show_id: "show-2",
        status: "pending",
        source: "claim",
        is_exclusive: false,
        created_at: "2026-03-01T00:00:00Z",
        shows: { name: "Acquired", is_discoverable: true, agent_id: "agent-1" },
        profiles: { email: "ada@example.com" },
      },
      {
        id: "held",
        agent_id: "agent-9",
        show_id: "show-1",
        status: "approved",
        source: "admin",
        is_exclusive: true,
        created_at: "2026-01-01T00:00:00Z",
        profiles: { email: "held@example.com" },
      },
      {
        id: "sibling",
        agent_id: "agent-3",
        show_id: "show-1",
        status: "pending",
        source: "claim",
        is_exclusive: false,
        created_at: "2026-04-03T00:00:00Z",
        profiles: { email: "sibling@example.com" },
      },
      {
        id: "rejected-other",
        agent_id: "agent-4",
        show_id: "show-1",
        status: "rejected",
        source: "import",
        is_exclusive: true,
        created_at: "2026-02-01T00:00:00Z",
        profiles: { email: "old@example.com" },
      },
    ];

    const rows = await listPendingRosterLinks();
    expect(rows.map((row) => row.id)).toEqual(["older", "newer", "sibling"]);
    expect(rows[0]).toMatchObject({
      showName: "Acquired",
      agentEmail: "ada@example.com",
      discoverable: true,
      source: "claim",
      showAgentDiffers: false,
      exclusiveConflict: false,
      otherLinks: [],
    });
    expect(rows[1]).toMatchObject({
      showName: "Odd Lots",
      agentEmail: "lena@example.com",
      discoverable: false,
      source: "import",
      isExclusive: true,
      showAgentId: "agent-9",
      showAgentDiffers: true,
      exclusiveConflict: true,
    });
    expect(rows[2]).toMatchObject({
      agentEmail: "sibling@example.com",
      showName: "",
      exclusiveConflict: true,
      showAgentDiffers: true,
    });
    expect(rows[2].otherLinks.map((link) => link.id)).toEqual(["held", "newer"]);
    expect(rows[1].otherLinks).toEqual([
      {
        id: "held",
        agentId: "agent-9",
        agentEmail: "held@example.com",
        status: "approved",
        source: "admin",
        isExclusive: true,
      },
      {
        id: "sibling",
        agentId: "agent-3",
        agentEmail: "sibling@example.com",
        status: "pending",
        source: "claim",
        isExclusive: false,
      },
    ]);
    expect(tables.calls).not.toContain("shows");
  });

  it("does not import lib/ownership", () => {
    const source = readFileSync(join(__dirname, "roster-review.ts"), "utf8");
    expect(source).not.toMatch(/from\s+["']@\/lib\/ownership/);
    expect(source).not.toMatch(/import\s*\(\s*["']@\/lib\/ownership/);
  });
});

describe("rejectRosterLink", () => {
  it("does not write when the caller is not an admin", async () => {
    isShowsAdmin.mockResolvedValue(false);
    tables.links = [{ id: "rel-1", status: "pending", show_id: "show-1" }];
    await expect(rejectRosterLink("brand-1", "rel-1", "Not a fit.")).rejects.toThrow(/admin/i);
    expect(adminFrom).not.toHaveBeenCalled();
    expect(tables.links[0].status).toBe("pending");
  });

  it("fails without a note and writes nothing", async () => {
    isShowsAdmin.mockResolvedValue(true);
    tables.links = [{ id: "rel-1", status: "pending" }];
    await expect(rejectRosterLink("admin-1", "rel-1", "   ")).rejects.toThrow(
      /1 to 500 characters/i
    );
    expect(adminFrom).not.toHaveBeenCalled();
    expect(tables.links[0].status).toBe("pending");
  });

  it("rejects a pending link and does not write shows", async () => {
    isShowsAdmin.mockResolvedValue(true);
    tables.links = [{ id: "rel-1", status: "pending", show_id: "show-1" }];
    const result = await rejectRosterLink("admin-1", "rel-1", "  Host already exclusive.  ");
    expect(result).toEqual({ id: "rel-1", status: "rejected" });
    expect(tables.links[0]).toMatchObject({
      status: "rejected",
      review_note: "Host already exclusive.",
      rejected_by: "admin-1",
    });
    expect(typeof tables.links[0].rejected_at).toBe("string");
    expect(tables.calls).toEqual(["agent_show_relationships"]);
  });

  it("leaves an approved link approved", async () => {
    isShowsAdmin.mockResolvedValue(true);
    tables.links = [{ id: "rel-1", status: "approved", review_note: null }];
    await expect(rejectRosterLink("admin-1", "rel-1", "Too late.")).rejects.toThrow(/not pending/i);
    expect(tables.links[0]).toMatchObject({ status: "approved", review_note: null });
    expect(tables.calls).not.toContain("shows");
  });
});
