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

import { GET } from "./route";

const SESSION = "agent-session";
const SHOW_ID = "show-1";

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

function chain(resultFor: (query: Query) => { data: unknown; error: null }) {
  const query: Query = { table: "", select: null, filters: [] };
  const builder: Record<string, unknown> = {};
  const self = () => builder;
  let finished = false;
  let result: { data: unknown; error: null } | null = null;
  const finish = () => {
    if (!finished) {
      finished = true;
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
    resolve: (value: { data: unknown; error: null }) => unknown,
    reject?: (reason: unknown) => unknown
  ) => Promise.resolve(finish()).then(resolve, reject);
  return { builder, query };
}

function install(linkStatus: "pending" | "rejected" | "approved" | "missing-show") {
  userFrom.mockImplementation((table: string) => {
    const built = chain((query) => {
      if (table === "profiles") {
        const id = query.filters.find((filter) => filter.column === "id")?.value;
        const role = id === SESSION ? "agent" : "brand";
        return {
          data: {
            id,
            email: "agent@taylslate.com",
            full_name: "Agent",
            role,
            tier: "free",
            created_at: "2026-10-21T00:00:00Z",
          },
          error: null,
        };
      }
      const statusFilter = query.filters.find((filter) => filter.column === "status")?.value;
      const agentFilter = query.filters.find((filter) => filter.column === "agent_id")?.value;
      if (statusFilter === "approved" && linkStatus !== "pending" && linkStatus !== "rejected") {
        expect(agentFilter).toBe(SESSION);
        return {
          data: {
            id: "rel-1",
            agent_id: SESSION,
            show_id: SHOW_ID,
            status: "approved",
            is_exclusive: true,
            commission_rate: 0.15,
            created_at: "2026-10-21T00:00:00Z",
          },
          error: null,
        };
      }
      return { data: null, error: null };
    });
    built.query.table = table;
    return built.builder;
  });

  adminFrom.mockImplementation((table: string) => {
    const built = chain((query) => {
      if (table === "shows") {
        if (linkStatus === "missing-show") return { data: null, error: null };
        expect(query.select).not.toMatch(/rate_card|cpm|price/);
        return {
          data: {
            id: SHOW_ID,
            name: "Night Desk",
            platform: "podcast",
            description: "Late news",
            audience_size: 12000,
            categories: ["news"],
            rate_card: { midroll_cpm: 30 },
          },
          error: null,
        };
      }
      expect(query.select ?? "").not.toMatch(/cpm|total_|price|payment|amount|net_|gross/);
      expect(query.filters).toContainEqual({ column: "show_id", value: SHOW_ID });
      return {
        data: [
          {
            id: "deal-1",
            status: "delivering",
            flight_start: "2026-03-02",
            flight_end: "2026-04-13",
            cpm_rate: 40,
            total_net: 1200,
            total_gross: 1500,
            gross_cpm: 48,
            payment_method_id: "pm_123",
            brand_profiles: { brand_name: "Northwind" },
            profiles: { company_name: "Northwind LLC", full_name: "Ada Brand" },
          },
        ],
        error: null,
      };
    });
    built.query.table = table;
    return built.builder;
  });
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

function showRequest(agentId = "other-agent") {
  return new Request(`http://x/api/reps/shows/${SHOW_ID}?agentId=${agentId}`, {
    headers: { "x-agent-id": agentId },
  });
}

function showParams(showId = SHOW_ID) {
  return { params: Promise.resolve({ showId }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  getUser.mockResolvedValue({ data: { user: { id: SESSION } } });
  install("approved");
});

describe("GET /api/reps/shows/[showId]", () => {
  it("returns 401 when nobody is signed in", async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    const res = await GET(showRequest(), showParams());
    expect(res.status).toBe(401);
    expect(adminFrom).not.toHaveBeenCalled();
  });

  it("returns 403 when the signed-in user is not an agent", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "brand-1" } } });
    const res = await GET(showRequest("brand-1"), showParams());
    expect(res.status).toBe(403);
    expect(adminFrom).not.toHaveBeenCalled();
  });

  it.each(["pending", "rejected"] as const)(
    "returns 404 when the roster link is %s",
    async (status) => {
      install(status);
      const res = await GET(showRequest(), showParams());
      expect(res.status).toBe(404);
      expect(adminFrom).not.toHaveBeenCalled();
      const body = await res.json();
      expect(body.error).toBe("Show not found");
      assertNoAmountKeys(body);
    }
  );

  it("returns 404 when the approved show row is missing", async () => {
    install("missing-show");
    const res = await GET(showRequest(), showParams());
    expect(res.status).toBe(404);
    expect(adminFrom.mock.calls.map((call) => call[0])).toEqual(["shows"]);
  });

  it("returns status and flight only, and ignores a caller-supplied agent id", async () => {
    const res = await GET(showRequest("other-agent"), showParams());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.show).toMatchObject({
      id: SHOW_ID,
      name: "Night Desk",
      status: "approved",
      is_exclusive: true,
    });
    expect(body.deals).toEqual([
      {
        id: "deal-1",
        status: "delivering",
        flight_start: "2026-03-02",
        flight_end: "2026-04-13",
        brand_name: "Northwind",
      },
    ]);
    expect(Object.keys(body.deals[0]).sort()).toEqual([
      "brand_name",
      "flight_end",
      "flight_start",
      "id",
      "status",
    ]);
    assertNoAmountKeys(body);
  });
});
