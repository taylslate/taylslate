import { beforeEach, describe, expect, it, vi } from "vitest";

const { adminFrom, userFrom, isShowsAdmin } = vi.hoisted(() => ({
  adminFrom: vi.fn(),
  userFrom: vi.fn(),
  isShowsAdmin: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: { from: (...args: unknown[]) => adminFrom(...args) },
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: (...args: unknown[]) => userFrom(...args),
  }),
}));

vi.mock("@/lib/shows/can-edit-show", () => ({
  isShowsAdmin,
}));

import {
  approveRosterLink,
  getRepShow,
  listRepDeals,
  listRoster,
  listRosterShowDeals,
} from "./store";

const AMOUNT_KEYS = [
  "cpm_rate",
  "gross_cpm",
  "agreed_cpm",
  "net_per_episode",
  "gross_per_episode",
  "total_net",
  "total_gross",
  "price",
  "price_type",
  "payment_method_id",
  "setup_intent_id",
  "amount",
  "amount_cents",
  "rate_card",
  "min_buy",
];

type Query = {
  table: string;
  select: string | null;
  filters: { column: string; value: unknown }[];
};

const queries: Query[] = [];

function chain(resultFor: (query: Query) => { data: unknown; error: { message: string } | null }) {
  const query: Query = { table: "", select: null, filters: [] };
  const builder: Record<string, unknown> = {};
  const self = () => builder;
  let finished = false;
  let result: { data: unknown; error: { message: string } | null } | null = null;
  const finish = () => {
    if (!finished) {
      finished = true;
      queries.push({
        table: query.table,
        select: query.select,
        filters: [...query.filters],
      });
      result = resultFor(query);
    }
    return result!;
  };
  builder.select = vi.fn((cols?: string) => {
    query.select = typeof cols === "string" ? cols : "*";
    return builder;
  });
  builder.eq = vi.fn((column: string, value: unknown) => {
    query.filters.push({ column, value });
    return builder;
  });
  builder.order = vi.fn(self);
  builder.maybeSingle = vi.fn(async () => finish());
  builder.single = vi.fn(async () => finish());
  builder.then = (
    resolve: (value: { data: unknown; error: { message: string } | null }) => unknown,
    reject?: (reason: unknown) => unknown
  ) => Promise.resolve(finish()).then(resolve, reject);
  return { builder, query };
}

function install(
  userResult: (table: string, query: Query) => { data: unknown; error: { message: string } | null },
  adminResult: (table: string, query: Query) => { data: unknown; error: { message: string } | null } = () => ({
    data: null,
    error: null,
  })
) {
  userFrom.mockImplementation((table: string) => {
    const built = chain((query) => userResult(table, query));
    built.query.table = table;
    return built.builder;
  });
  adminFrom.mockImplementation((table: string) => {
    const built = chain((query) => adminResult(table, query));
    built.query.table = table;
    return built.builder;
  });
}

function approvedLink(status: "pending" | "rejected" | "approved" = "approved") {
  return (table: string, query: Query) => {
    if (table !== "agent_show_relationships") return { data: null, error: null };
    const statusFilter = query.filters.find((filter) => filter.column === "status")?.value;
    if (statusFilter === "approved" && status === "approved") {
      return {
        data: {
          id: "rel-1",
          agent_id: "agent-1",
          show_id: "show-1",
          status: "approved",
          is_exclusive: true,
          commission_rate: 0.15,
          created_at: "2026-10-21T00:00:00Z",
        },
        error: null,
      };
    }
    if (statusFilter === "approved") return { data: null, error: null };
    return {
      data: {
        id: "rel-1",
        agent_id: "agent-1",
        show_id: "show-1",
        status,
        is_exclusive: false,
        created_at: "2026-10-21T00:00:00Z",
      },
      error: null,
    };
  };
}

function assertNoAmountKeys(value: unknown) {
  const seen = new Set<unknown>();
  const walk = (node: unknown) => {
    if (!node || typeof node !== "object" || seen.has(node)) return;
    seen.add(node);
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    for (const key of Object.keys(node as object)) {
      expect(AMOUNT_KEYS).not.toContain(key);
      walk((node as Record<string, unknown>)[key]);
    }
  };
  walk(value);
}

const FAT_DEAL = {
  id: "deal-1",
  status: "delivering",
  flight_start: "2026-03-02",
  flight_end: "2026-04-13",
  show_id: "show-1",
  cpm_rate: 40,
  gross_cpm: 48,
  agreed_cpm: 40,
  net_per_episode: 400,
  gross_per_episode: 500,
  total_net: 1200,
  total_gross: 1500,
  price_type: "cpm",
  payment_method_id: "pm_123",
  setup_intent_id: "seti_123",
  brand_profiles: { brand_name: "  Northwind  " },
  profiles: { company_name: "Northwind LLC", full_name: "Ada Brand" },
};

describe("rep store", () => {
  beforeEach(() => {
    queries.length = 0;
    adminFrom.mockReset();
    userFrom.mockReset();
    isShowsAdmin.mockReset();
  });

  it("lists every roster link for the agent, including pending", async () => {
    install((table) => {
      if (table !== "agent_show_relationships") return { data: [], error: null };
      return {
        data: [
          {
            id: "rel-p",
            show_id: "show-p",
            status: "pending",
            source: "import",
            commission_rate: null,
            is_exclusive: true,
            shows: { name: "Night Desk" },
          },
          {
            id: "rel-a",
            show_id: "show-a",
            status: "approved",
            source: "claim",
            commission_rate: "0.2000",
            is_exclusive: false,
            shows: { name: "Day Desk" },
          },
        ],
        error: null,
      };
    });

    const roster = await listRoster("agent-1");
    expect(roster).toEqual([
      {
        id: "rel-p",
        show_id: "show-p",
        show_name: "Night Desk",
        status: "pending",
        source: "import",
        commission_rate: null,
        is_exclusive: true,
      },
      {
        id: "rel-a",
        show_id: "show-a",
        show_name: "Day Desk",
        status: "approved",
        source: "claim",
        commission_rate: 0.2,
        is_exclusive: false,
      },
    ]);
    const rosterQuery = queries.find((query) => query.table === "agent_show_relationships");
    expect(rosterQuery?.filters).toEqual([{ column: "agent_id", value: "agent-1" }]);
    expect(rosterQuery?.select).toContain("commission_rate");
    expect(rosterQuery?.select).toContain("is_exclusive");
    expect(rosterQuery?.select).toContain("status");
    expect(adminFrom).not.toHaveBeenCalled();
  });

  it("returns the full participant deal when the agent is on the deal", async () => {
    install((table) => {
      if (table !== "deals") return { data: [], error: null };
      return {
        data: [{ id: "deal-9", agent_id: "agent-1", status: "live", cpm_rate: 25, total_net: 750 }],
        error: null,
      };
    });

    const deals = await listRepDeals("agent-1");
    expect(deals).toEqual([
      { id: "deal-9", agent_id: "agent-1", status: "live", cpm_rate: 25, total_net: 750 },
    ]);
    const dealQuery = queries.find((query) => query.table === "deals");
    expect(dealQuery?.select).toBe("*");
    expect(dealQuery?.filters).toEqual([{ column: "agent_id", value: "agent-1" }]);
    expect(adminFrom).not.toHaveBeenCalled();
  });

  it.each(["pending", "rejected"] as const)(
    "sees no show and no deals when the roster link is %s",
    async (status) => {
      install(approvedLink(status));
      expect(await getRepShow("agent-1", "show-1")).toBeNull();
      expect(await listRosterShowDeals("agent-1", "show-1")).toEqual([]);
      expect(adminFrom).not.toHaveBeenCalled();
      expect(queries.some((query) => query.filters.some((filter) => filter.value === "approved"))).toBe(
        true
      );
    }
  );

  it("returns status and flight only for an approved roster show", async () => {
    install(approvedLink("approved"), (table, query) => {
      if (table === "deals") {
        expect(query.select).not.toMatch(/cpm|total_|price|payment|amount|net_|gross/);
        expect(query.filters).toEqual([{ column: "show_id", value: "show-1" }]);
        return { data: [FAT_DEAL], error: null };
      }
      return { data: null, error: null };
    });

    const deals = await listRosterShowDeals("agent-1", "show-1");
    expect(deals).toEqual([
      {
        id: "deal-1",
        status: "delivering",
        flight_start: "2026-03-02",
        flight_end: "2026-04-13",
        brand_name: "Northwind",
      },
    ]);
    expect(Object.keys(deals[0]).sort()).toEqual([
      "brand_name",
      "flight_end",
      "flight_start",
      "id",
      "status",
    ]);
    assertNoAmountKeys(deals);
    expect(queries.filter((query) => query.table === "deals").every((query) => query.select !== "*")).toBe(
      true
    );
  });

  it("falls back to the account name when the brand profile has no display name", async () => {
    install(approvedLink("approved"), (table) => {
      if (table !== "deals") return { data: null, error: null };
      return {
        data: [
          {
            ...FAT_DEAL,
            id: "deal-2",
            brand_profiles: { brand_name: " " },
            profiles: { company_name: "", full_name: "Ada Brand" },
          },
        ],
        error: null,
      };
    });

    const deals = await listRosterShowDeals("agent-1", "show-1");
    expect(deals[0].brand_name).toBe("Ada Brand");
    assertNoAmountKeys(deals);
  });

  it("loads an approved show and leaves rate fields off the view", async () => {
    install(approvedLink("approved"), (table, query) => {
      if (table !== "shows") return { data: null, error: null };
      expect(query.select).toBe("id, name, platform, description, audience_size, categories");
      return {
        data: {
          id: "show-1",
          name: "Night Desk",
          platform: "podcast",
          description: "Late news",
          audience_size: 12000,
          categories: ["news"],
          rate_card: { midroll_cpm: 30 },
          min_buy: 500,
        },
        error: null,
      };
    });

    const show = await getRepShow("agent-1", "show-1");
    expect(show).toEqual({
      id: "show-1",
      name: "Night Desk",
      platform: "podcast",
      description: "Late news",
      audience_size: 12000,
      categories: ["news"],
      status: "approved",
      commission_rate: 0.15,
      is_exclusive: true,
    });
    assertNoAmountKeys(show);
  });

  it("returns null when the approved link has no show row", async () => {
    install(approvedLink("approved"), () => ({ data: null, error: null }));
    expect(await getRepShow("agent-1", "show-1")).toBeNull();
  });

  function approveMock(showAgentId: string | null) {
    const writes: {
      table: string;
      row: Record<string, unknown>;
      filters: { column: string; value: unknown }[];
    }[] = [];
    adminFrom.mockImplementation((table: string) => {
      const builder: Record<string, unknown> = {};
      const self = () => builder;
      const filters: { column: string; value: unknown }[] = [];
      let row: Record<string, unknown> | null = null;
      builder.select = vi.fn(self);
      builder.eq = vi.fn((column: string, value: unknown) => {
        filters.push({ column, value });
        return builder;
      });
      builder.update = vi.fn((next: Record<string, unknown>) => {
        row = next;
        return builder;
      });
      builder.maybeSingle = vi.fn(async () => ({
        data: table === "shows" ? { id: "show-1", agent_id: showAgentId } : null,
        error: null,
      }));
      builder.single = vi.fn(async () => {
        writes.push({ table, row: row ?? {}, filters: [...filters] });
        return {
          data: {
            id: "rel-1",
            show_id: "show-1",
            agent_id: "agent-1",
            status: "approved",
          },
          error: null,
        };
      });
      builder.then = (
        resolve: (value: { data: null; error: null }) => unknown,
        reject?: (reason: unknown) => unknown
      ) => {
        if (row) writes.push({ table, row, filters: [...filters] });
        return Promise.resolve({ data: null, error: null }).then(resolve, reject);
      };
      return builder;
    });
    return writes;
  }

  it("sets the show discoverable when an admin approves a pending link the agent created", async () => {
    isShowsAdmin.mockResolvedValue(true);
    const writes = approveMock("agent-1");

    const approved = await approveRosterLink("admin-1", "rel-1");
    expect(approved).toEqual({ id: "rel-1", show_id: "show-1", status: "approved" });
    expect(isShowsAdmin).toHaveBeenCalledWith("admin-1");
    expect(writes).toEqual([
      {
        table: "agent_show_relationships",
        filters: [
          { column: "id", value: "rel-1" },
          { column: "status", value: "pending" },
        ],
        row: expect.objectContaining({
          status: "approved",
          approved_by: "admin-1",
        }),
      },
      {
        table: "shows",
        filters: [{ column: "id", value: "show-1" }],
        row: expect.objectContaining({ is_discoverable: true }),
      },
    ]);
  });

  it("approves a link and leaves the show hidden when that agent did not create it", async () => {
    isShowsAdmin.mockResolvedValue(true);
    const writes = approveMock("agent-9");

    const approved = await approveRosterLink("admin-1", "rel-1");
    expect(approved).toEqual({ id: "rel-1", show_id: "show-1", status: "approved" });
    expect(writes).toEqual([
      {
        table: "agent_show_relationships",
        filters: [
          { column: "id", value: "rel-1" },
          { column: "status", value: "pending" },
        ],
        row: expect.objectContaining({ status: "approved" }),
      },
    ]);
    expect(writes.some((write) => write.row.is_discoverable === true)).toBe(false);
  });

  it("does not write when a non-admin tries to approve a roster link", async () => {
    isShowsAdmin.mockResolvedValue(false);
    await expect(approveRosterLink("brand-1", "rel-1")).rejects.toThrow(/admin/i);
    expect(adminFrom).not.toHaveBeenCalled();
  });
});
