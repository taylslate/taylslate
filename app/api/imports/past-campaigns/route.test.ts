import { beforeEach, describe, expect, it, vi } from "vitest";

const { getAuthenticatedUser, getUserProfile, createClient, calls, state } = vi.hoisted(() => ({
  getAuthenticatedUser: vi.fn(),
  getUserProfile: vi.fn(),
  createClient: vi.fn(),
  calls: [] as { table: string; op: string; payload: unknown; ilike: string | null; eq: [string, string][] }[],
  state: {
    shows: [] as { id: string; name: string }[],
    failRecords: false,
    importId: "import-1",
  },
}));

vi.mock("@/lib/data/queries", () => ({
  getAuthenticatedUser: (...args: unknown[]) => getAuthenticatedUser(...args),
  getUserProfile: (...args: unknown[]) => getUserProfile(...args),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: (...args: unknown[]) => createClient(...args),
}));

import { POST } from "./route";

const USER_ID = "11111111-1111-4111-8111-111111111111";

function builderFor(table: string) {
  const local = {
    op: "select",
    payload: null as unknown,
    ilike: null as string | null,
    eq: [] as [string, string][],
  };
  const resolve = () => {
    calls.push({
      table,
      op: local.op,
      payload: local.payload,
      ilike: local.ilike,
      eq: local.eq,
    });
    if (table === "shows") {
      const hits = state.shows.filter(
        (show) => show.name.toLowerCase() === (local.ilike ?? "").toLowerCase()
      );
      return { data: hits, error: null };
    }
    if (table === "past_campaign_imports" && local.op === "insert") {
      return { data: { id: state.importId, ...(local.payload as object) }, error: null };
    }
    if (table === "past_campaign_imports" && local.op === "delete") {
      return { data: null, error: null };
    }
    if (table === "past_campaign_records" && local.op === "insert") {
      if (state.failRecords) return { data: null, error: { message: "insert failed" } };
      const rows = local.payload as Record<string, unknown>[];
      return {
        data: rows.map((row, index) => ({ id: `rec-${index + 1}`, ...row })),
        error: null,
      };
    }
    return { data: null, error: { message: `unexpected ${table} ${local.op}` } };
  };

  const builder = {
    insert(payload: unknown) {
      local.op = "insert";
      local.payload = payload;
      return builder;
    },
    select() {
      return builder;
    },
    single() {
      return builder;
    },
    delete() {
      local.op = "delete";
      return builder;
    },
    eq(column: string, value: string) {
      local.eq.push([column, value]);
      return builder;
    },
    ilike(_column: string, value: string) {
      local.ilike = value;
      return builder;
    },
    limit() {
      return builder;
    },
    then(onFulfilled: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) {
      return Promise.resolve(resolve()).then(onFulfilled, onRejected);
    },
  };
  return builder;
}

function post(body: unknown) {
  return new Request("http://localhost/api/imports/past-campaigns", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function saveBody(overrides: Record<string, unknown> = {}) {
  return {
    brand_id: "attacker-brand",
    import_id: "attacker-import",
    source_kind: "csv",
    file_name: "uploads/past-campaign.csv",
    pooling_consent: true,
    terms_version: "2026-10-21",
    records: [
      {
        show_name: "Acquired",
        matched_show_id: "evil-show",
        brand_id: "attacker-brand",
        flight_start: "2026-01-06",
        flight_end: "2026-01-20",
        placement: "mid-roll",
        price_type: "flat_rate",
        rate: 25,
        episodes: 3,
        spend: 2250,
        conversions: 14,
        downloads: 30000,
        raw: { "Podcast Title": "Acquired", "Total Spend": "$2,250" },
      },
      {
        show_name: "Mystery Hour",
        matched_show_id: "evil-show",
        price_type: "nope",
        rate: "800",
        raw: { Show: "Mystery Hour" },
      },
    ],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  calls.length = 0;
  state.failRecords = false;
  state.importId = "import-1";
  state.shows = [
    { id: "show-acquired", name: "Acquired" },
    { id: "show-odd", name: "Odd Lots" },
  ];
  getAuthenticatedUser.mockResolvedValue({ id: USER_ID, email: "brand@taylslate.com" });
  getUserProfile.mockResolvedValue({ id: USER_ID, role: "brand", email: "brand@taylslate.com" });
  createClient.mockResolvedValue({ from: (table: string) => builderFor(table) });
});

describe("POST /api/imports/past-campaigns", () => {
  it("writes both tables under the session brand and ignores body brand_id", async () => {
    const res = await POST(post(saveBody()) as never);
    expect(res.status).toBe(201);
    const body = await res.json();

    expect(body.import).toMatchObject({
      id: "import-1",
      brand_id: USER_ID,
      source_kind: "csv",
      file_name: "past-campaign.csv",
      status: "confirmed",
      pooling_consent: true,
      terms_version: "2026-10-21",
    });
    expect(body.import.brand_id).not.toBe("attacker-brand");

    expect(body.records).toHaveLength(2);
    for (const row of body.records) {
      expect(row.import_id).toBe(body.import.id);
      expect(row.brand_id).toBe(USER_ID);
      expect(row.brand_id).toBe(body.import.brand_id);
    }
    expect(body.records[0]).toMatchObject({
      show_name: "Acquired",
      matched_show_id: "show-acquired",
      price_type: "flat",
      rate: 25,
      raw: { "Podcast Title": "Acquired", "Total Spend": "$2,250" },
    });
    expect(body.records[1]).toMatchObject({
      show_name: "Mystery Hour",
      matched_show_id: null,
      price_type: null,
      rate: 800,
    });

    const tables = calls.map((call) => call.table);
    expect(tables).not.toContain("deals");
    expect(tables).not.toContain("show_profiles");
    expect(new Set(tables)).toEqual(
      new Set(["shows", "past_campaign_imports", "past_campaign_records"])
    );
    const showWrites = calls.filter((call) => call.table === "shows" && call.op !== "select");
    expect(showWrites).toEqual([]);
  });

  it("allows an agency account", async () => {
    getUserProfile.mockResolvedValue({ id: USER_ID, role: "agency", email: "agency@taylslate.com" });
    const res = await POST(post(saveBody({ pooling_consent: false, terms_version: "ignored" })) as never);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.import.brand_id).toBe(USER_ID);
    expect(body.import.pooling_consent).toBe(false);
    expect(body.import.terms_version).toBeNull();
  });

  it("leaves matched_show_id empty when two shows share the name", async () => {
    state.shows = [
      { id: "show-a", name: "Acquired" },
      { id: "show-b", name: "acquired" },
    ];
    const res = await POST(post(saveBody()) as never);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.records[0].matched_show_id).toBeNull();
  });

  it("rejects signed-out, show, and agent callers before writing", async () => {
    getAuthenticatedUser.mockResolvedValue(null);
    const signedOut = await POST(post(saveBody()) as never);
    expect(signedOut.status).toBe(401);
    expect(createClient).not.toHaveBeenCalled();

    getAuthenticatedUser.mockResolvedValue({ id: USER_ID, email: "show@taylslate.com" });
    getUserProfile.mockResolvedValue({ id: USER_ID, role: "show" });
    const show = await POST(post(saveBody()) as never);
    expect(show.status).toBe(403);

    getUserProfile.mockResolvedValue({ id: USER_ID, role: "agent" });
    const agent = await POST(post(saveBody()) as never);
    expect(agent.status).toBe(403);
    expect(calls.filter((call) => call.op === "insert")).toEqual([]);
  });

  it("deletes the import when record insert fails", async () => {
    state.failRecords = true;
    const res = await POST(post(saveBody()) as never);
    expect(res.status).toBe(500);
    const deleted = calls.find((call) => call.table === "past_campaign_imports" && call.op === "delete");
    expect(deleted?.eq).toEqual([
      ["id", "import-1"],
      ["brand_id", USER_ID],
    ]);
    const body = await res.json();
    expect(body.records).toBeUndefined();
  });
});
