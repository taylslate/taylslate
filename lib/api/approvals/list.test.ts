import { beforeEach, describe, expect, it, vi } from "vitest";

const BRAND = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const KEY = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1";
const SHOW = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1";
const NOW = "2026-06-15T15:00:00.000Z";

const { getShow, tables } = vi.hoisted(() => ({
  getShow: vi.fn(),
  tables: { rows: [] as Record<string, unknown>[] },
}));

vi.mock("@/lib/api/v1/reads", () => ({
  getShow: (...args: unknown[]) => getShow(...args),
}));
vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: { from: (table: string) => query(table) },
}));
vi.mock("@/lib/data/queries", () => ({
  getAuthenticatedUser: vi.fn(),
}));

import { getBrandAction, listBrandActions, expiredStatusFilter } from "@/lib/api/approvals/list";

function query(table: string) {
  const filters: Array<(row: Record<string, unknown>) => boolean> = [];
  let limit = 100;
  const api = {
    select() {
      return api;
    },
    eq(column: string, value: unknown) {
      filters.push((row) => row[column] === value);
      return api;
    },
    gte(column: string, value: unknown) {
      filters.push((row) => String(row[column] ?? "") >= String(value));
      return api;
    },
    in(column: string, values: unknown[]) {
      filters.push((row) => values.includes(row[column]));
      return api;
    },
    or() {
      return api;
    },
    order() {
      return api;
    },
    limit(count: number) {
      limit = count;
      return api;
    },
    maybeSingle() {
      const found = matched().slice(0, 1);
      return Promise.resolve({ data: found[0] ?? null, error: null });
    },
    then(onFulfilled: (value: unknown) => unknown) {
      return Promise.resolve(onFulfilled({ data: matched().slice(0, limit), error: null }));
    },
  };
  function matched() {
    if (table === "api_keys") {
      return [
        {
          id: KEY,
          brand_id: BRAND,
          name: "Planner",
          prefix: "0123456789abcdef",
          key_hash: "key-hash-secret",
        },
      ].filter((row) => filters.every((filter) => filter(row)));
    }
    return tables.rows.filter((row) => filters.every((filter) => filter(row)));
  }
  return api;
}

function action(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
    brand_id: BRAND,
    api_key_id: KEY,
    kind: "campaign.create",
    status: "pending",
    created_at: NOW,
    decided_at: null,
    decision_note: null,
    executed_at: null,
    result_campaign_id: null,
    execution_error: null,
    payload_hash: "payload-hash-secret",
    idempotency_key: "idem-secret",
    payload: {
      product: { brand_name: "Sauna Box" },
      goals: ["test_channel"],
      budget_total: 25000,
      flight: { mode: "preset", preset: "next_30_days" },
    },
    ...overrides,
  };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(NOW));
  getShow.mockReset();
  getShow.mockResolvedValue({ name: "Visible Show" });
  tables.rows = [action()];
});

describe("listBrandActions", () => {
  it("returns the allowlist and leaves secrets out", async () => {
    const result = await listBrandActions(BRAND, new Request("http://localhost/api/settings/agent-actions"));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toHaveLength(1);
    expect(result.data[0]).toMatchObject({
      kind: "campaign.create",
      status: "pending",
      key: { name: "Planner", prefix: "0123456789abcdef" },
      summary: {
        type: "campaign",
        brand_name: "Sauna Box",
        budget_total: 25000,
        goals: "Test the channel",
        flight: "Next 30 days",
      },
    });
    const names = jsonKeys(result);
    expect(names.has("payload_hash")).toBe(false);
    expect(names.has("key_hash")).toBe(false);
    expect(names.has("idempotency_key")).toBe(false);
    expect(names.has("payload")).toBe(false);
    expect(JSON.stringify(result)).not.toMatch(/payload-hash-secret|key-hash-secret|idem-secret/);
  });

  it("hides another brand and shows an old pending row as expired", async () => {
    tables.rows = [
      action(),
      action({
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2",
        brand_id: OTHER,
        payload_hash: "other-hash",
      }),
      action({
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3",
        created_at: "2026-05-01T15:00:00.000Z",
        status: "pending",
      }),
    ];
    const pending = await listBrandActions(
      BRAND,
      new Request("http://localhost/api/settings/agent-actions?status=pending")
    );
    expect(pending.ok).toBe(true);
    if (pending.ok) {
      expect(pending.data.map((row) => row.id)).toEqual(["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1"]);
    }
    const expired = await getBrandAction(BRAND, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3");
    expect(expired?.status).toBe("expired");
    const foreign = await getBrandAction(OTHER, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1");
    expect(foreign).toBeNull();
  });

  it("builds an outreach summary without linking the show when it is hidden", async () => {
    tables.rows = [
      action({
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4",
        kind: "outreach.draft",
        payload: {
          show_id: SHOW,
          subject: "<script>alert(1)</script>",
          body: "We think this is a strong fit for the audience and would like to start with three reads.",
        },
      }),
    ];
    getShow.mockRejectedValueOnce(new Error("missing"));
    const result = await listBrandActions(BRAND, new Request("http://localhost/api/settings/agent-actions"));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data[0].summary).toMatchObject({
      type: "outreach",
      show_name: null,
      subject: "<script>alert(1)</script>",
    });
  });

  it("rejects an unknown status", async () => {
    const result = await listBrandActions(
      BRAND,
      new Request("http://localhost/api/settings/agent-actions?status=sent")
    );
    expect(result.ok).toBe(false);
  });
});

describe("expiredStatusFilter", () => {
  it("includes pending rows older than the cutoff", () => {
    const filter = expiredStatusFilter("2026-06-01T00:00:00.000Z", null);
    expect(filter).toContain("status.eq.expired");
    expect(filter).toContain("status.eq.pending");
    expect(filter).toContain("2026-06-01T00:00:00.000Z");
  });
});

function jsonKeys(value: unknown, into = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) jsonKeys(item, into);
    return into;
  }
  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      into.add(key);
      jsonKeys(child, into);
    }
  }
  return into;
}
