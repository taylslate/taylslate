import { beforeEach, describe, expect, it, vi } from "vitest";

interface Row {
  [key: string]: unknown;
}

interface Write {
  table: string;
  op: "insert" | "update" | "delete";
}

const { tables, writes, reads, reset, logEvent, getAuthenticatedUser, getBrandProfileByUserId, getShowProfileByUserId } =
  vi.hoisted(() => {
    const tables: Record<string, Row[]> = {};
    const writes: Write[] = [];
    const reads: { table: string; selected: string }[] = [];
    return {
      tables,
      writes,
      reads,
      reset() {
        for (const key of Object.keys(tables)) delete tables[key];
        writes.length = 0;
        reads.length = 0;
      },
      logEvent: vi.fn(),
      getAuthenticatedUser: vi.fn(),
      getBrandProfileByUserId: vi.fn(),
      getShowProfileByUserId: vi.fn(),
    };
  });

vi.mock("@/lib/data/events", () => ({
  logEvent: (input: unknown) => logEvent(input),
}));

vi.mock("@/lib/data/queries", () => ({
  getAuthenticatedUser: (...args: unknown[]) => getAuthenticatedUser(...args),
  getBrandProfileByUserId: (...args: unknown[]) => getBrandProfileByUserId(...args),
  getShowProfileByUserId: (...args: unknown[]) => getShowProfileByUserId(...args),
}));

vi.mock("@/lib/supabase/admin", () => {
  function makeBuilder(table: string) {
    const filters: { col: string; val: unknown }[] = [];
    let op: "select" | "insert" | "update" | "delete" = "select";
    let payload: Row | null = null;
    let selected = "*";

    function matched(rows: Row[]): Row[] {
      return rows.filter((row) => filters.every((filter) => row[filter.col] === filter.val));
    }

    function run(single: boolean, list: boolean) {
      if (!tables[table]) tables[table] = [];
      const rows = tables[table];
      reads.push({ table, selected });

      if (op === "insert") {
        const created: Row = {
          id: crypto.randomUUID(),
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          ...payload,
        };
        rows.push(created);
        writes.push({ table, op });
        return { data: list ? [created] : created, error: null };
      }

      if (op === "update") {
        const found = matched(rows);
        writes.push({ table, op });
        for (const row of found) {
          Object.assign(row, payload, { updated_at: new Date().toISOString() });
        }
        if (list) return { data: found, error: null };
        if (single && found.length !== 1) {
          return { data: null, error: { message: "row count", code: "PGRST116" } };
        }
        return { data: found[0] ?? null, error: null };
      }

      if (op === "delete") {
        const found = matched(rows);
        writes.push({ table, op });
        tables[table] = rows.filter((row) => !found.includes(row));
        return { data: found, error: null };
      }

      const found = matched(rows);
      if (list) return { data: found, error: null };
      if (single && found.length !== 1) {
        return { data: null, error: { message: "row count", code: "PGRST116" } };
      }
      return { data: found[0] ?? null, error: null };
    }

    const builder = {
      select(cols?: string) {
        selected = cols ?? "*";
        return builder;
      },
      eq(col: string, val: unknown) {
        filters.push({ col, val });
        return builder;
      },
      order() {
        return builder;
      },
      insert(row: Row) {
        op = "insert";
        payload = { ...row };
        return builder;
      },
      update(row: Row) {
        op = "update";
        payload = { ...row };
        return builder;
      },
      delete() {
        op = "delete";
        return builder;
      },
      maybeSingle() {
        return Promise.resolve(run(false, false));
      },
      single() {
        return Promise.resolve(run(true, false));
      },
      then(resolve: (value: unknown) => void, reject?: (reason: unknown) => void) {
        try {
          resolve(run(false, true));
        } catch (err) {
          reject?.(err);
        }
      },
    };
    return builder;
  }

  return {
    supabaseAdmin: {
      from(table: string) {
        return makeBuilder(table);
      },
    },
  };
});

import { POST as detect } from "./route";
import { GET as list } from "./route";
import { POST as approve } from "./[makeGoodId]/approve/route";
import { POST as decline } from "./[makeGoodId]/decline/route";

function loggedEvents(): { eventType: string; payload?: { show_id?: string } }[] {
  return logEvent.mock.calls.map(
    (call) => call[0] as { eventType: string; payload?: { show_id?: string } }
  );
}

const dealParams = Promise.resolve({ id: "deal_1" });
const decisionParams = Promise.resolve({ id: "deal_1", makeGoodId: "mg_1" });

function jsonReq(url: string, body?: unknown): Request {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function seedDeal() {
  tables.deals = [
    {
      id: "deal_1",
      status: "completed",
      brand_id: "u_owner",
      agent_id: null,
      agency_id: null,
      brand_profile_id: "bp_owner",
      show_id: "show_1",
      show_profile_id: "sp_1",
      docusign_envelope_id: "env_existing",
    },
  ];
  tables.insertion_orders = [
    {
      id: "io_1",
      deal_id: "deal_1",
      io_number: "IO-2026-0048",
      advertiser_name: "Sauna Box",
      make_good_enabled: true,
      make_good_threshold: 0.1,
      total_downloads: 10000,
    },
  ];
  tables.io_line_items = [
    {
      id: "li_1",
      io_id: "io_1",
      format: "podcast",
      post_date: "2026-08-01",
      guaranteed_downloads: 10000,
      actual_downloads: null,
      show_name: "Huberman Lab",
      placement: "mid-roll",
      is_scripted: false,
      is_personal_experience: false,
      reader_type: "host_read",
      content_type: "evergreen",
      pixel_required: false,
      price_type: "cpm",
      spot_format: null,
      gross_cpm: 25,
      gross_rate: 250,
      net_due: 250,
      verified: false,
      make_good_triggered: false,
      make_good_reason: null,
    },
  ];
  tables.airchecks = [
    {
      id: "ac_1",
      io_line_item_id: "li_1",
      status: "transcribed",
      match_result: "not_matched",
      match_evidence: { reason: "Brand was not in the transcript." },
      review_decision: "rejected",
      review_reason: "Host read a competitor",
    },
  ];
  tables.shows = [{ id: "show_1", name: "Huberman Lab", podscan_id: "do-not-trust" }];
  tables.show_profiles = [
    { id: "sp_1", user_id: "u_show", podscan_id: "do-not-trust-either" },
  ];
  tables.payments = [];
}

function seedProposal(overrides: Row = {}) {
  tables.make_goods = [
    {
      id: "mg_1",
      deal_id: "deal_1",
      io_id: "io_1",
      io_line_item_id: "li_1",
      aircheck_id: "ac_1",
      show_id: "show_1",
      kind: "missed",
      status: "proposed",
      delivery_state: "pending_approval",
      reason: "Aircheck rejected: the spot did not run.",
      show_name: "Huberman Lab",
      placement: "mid-roll",
      post_date: "2026-08-01",
      guaranteed_downloads: 10000,
      actual_downloads: null,
      shortfall_pct: null,
      threshold: 0.1,
      options: [
        {
          id: "replacement_spot",
          label: "Additional episode",
          summary: "One additional episode at no cost.",
        },
        { id: "reair", label: "Re-air the spot", summary: "Re-air at no cost." },
      ],
      selected_option: null,
      amended_terms: "Draft",
      credit_amount: null,
      replacement_line_item_id: null,
      replacement_post_date: null,
      decided_by: null,
      decided_at: null,
      created_at: "2026-08-20T00:00:00.000Z",
      updated_at: "2026-08-20T00:00:00.000Z",
      ...overrides,
    },
  ];
}

function asBrand() {
  getAuthenticatedUser.mockResolvedValue({ id: "u_owner", email: "brand@x.com" });
  getBrandProfileByUserId.mockResolvedValue({ id: "bp_owner" });
  getShowProfileByUserId.mockResolvedValue(null);
}

function asShow() {
  getAuthenticatedUser.mockResolvedValue({ id: "u_show", email: "show@x.com" });
  getBrandProfileByUserId.mockResolvedValue(null);
  getShowProfileByUserId.mockResolvedValue({ id: "sp_1" });
}

function asParty() {
  tables.deals[0].agent_id = "u_agent";
  getAuthenticatedUser.mockResolvedValue({ id: "u_agent", email: "agent@x.com" });
  getBrandProfileByUserId.mockResolvedValue(null);
  getShowProfileByUserId.mockResolvedValue(null);
}

beforeEach(() => {
  reset();
  seedDeal();
  logEvent.mockClear();
  getAuthenticatedUser.mockReset();
  getBrandProfileByUserId.mockReset();
  getShowProfileByUserId.mockReset();
});

describe("make-good approval", () => {
  it("401 when signed out", async () => {
    getAuthenticatedUser.mockResolvedValue(null);
    seedProposal();
    const res = await approve(jsonReq("https://www.taylslate.com/approve", { option: "replacement_spot" }) as never, {
      params: decisionParams,
    });
    expect(res.status).toBe(401);
    expect(writes).toEqual([]);
    expect(logEvent).not.toHaveBeenCalled();
  });

  it("403 when a brand who does not own the deal tries to approve", async () => {
    getAuthenticatedUser.mockResolvedValue({ id: "u_other", email: "other@x.com" });
    getBrandProfileByUserId.mockResolvedValue({ id: "bp_other" });
    getShowProfileByUserId.mockResolvedValue(null);
    seedProposal();

    const res = await approve(jsonReq("https://www.taylslate.com/approve", { option: "replacement_spot" }) as never, {
      params: decisionParams,
    });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toMatch(/brand on this deal/i);
    expect(writes).toEqual([]);
    expect(reads.map((read) => read.table)).toEqual(["deals"]);
    expect(tables.make_goods[0].status).toBe("proposed");
    expect(logEvent).not.toHaveBeenCalled();
    expect(tables.payments).toEqual([]);
    expect(tables.deals[0].docusign_envelope_id).toBe("env_existing");
  });

  it("403 when the show on the deal tries to approve", async () => {
    asShow();
    seedProposal();

    const res = await approve(jsonReq("https://www.taylslate.com/approve", { option: "replacement_spot" }) as never, {
      params: decisionParams,
    });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toMatch(/brand on this deal/i);
    expect(writes).toEqual([]);
    expect(tables.make_goods[0].status).toBe("proposed");
    expect(tables.io_line_items).toHaveLength(1);
  });

  it("403 when a party on the deal tries to approve", async () => {
    asParty();
    seedProposal();

    const res = await approve(jsonReq("https://www.taylslate.com/approve", { option: "replacement_spot" }) as never, {
      params: decisionParams,
    });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toMatch(/brand on this deal/i);
    expect(writes).toEqual([]);
    expect(tables.make_goods[0].status).toBe("proposed");
    expect(logEvent).not.toHaveBeenCalled();
  });

  it("404 and does not write when the make-good belongs to another deal", async () => {
    asBrand();
    seedProposal({ deal_id: "deal_2", show_id: "show_other" });

    const res = await approve(jsonReq("https://www.taylslate.com/approve", { option: "replacement_spot" }) as never, {
      params: decisionParams,
    });
    expect(res.status).toBe(404);
    expect(writes).toEqual([]);
    expect(tables.make_goods[0].status).toBe("proposed");
    expect(tables.make_goods[0].show_id).toBe("show_other");
    expect(tables.io_line_items).toHaveLength(1);
  });

  it("approves a replacement for the owning brand and moves delivery back open", async () => {
    asBrand();
    seedProposal();

    const res = await approve(jsonReq("https://www.taylslate.com/approve", { option: "replacement_spot" }) as never, {
      params: decisionParams,
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.make_good.status).toBe("approved");
    expect(body.make_good.selected_option).toBe("replacement_spot");
    expect(body.make_good.delivery_state).toBe("scheduled");
    expect(body.make_good.show_id).toBe("show_1");
    expect(body.make_good.amended_terms).toMatch(/does not charge/);
    expect(body.deal_status).toBe("delivering");

    expect(tables.deals[0].status).toBe("delivering");
    expect(tables.deals[0].docusign_envelope_id).toBe("env_existing");
    expect(tables.io_line_items).toHaveLength(2);
    const added = tables.io_line_items[1];
    expect(added.io_id).toBe("io_1");
    expect(added.gross_rate).toBe(0);
    expect(added.net_due).toBe(0);
    expect(added.verified).toBe(false);
    expect(added.post_date).toBe("2026-08-15");
    expect(added.make_good_triggered).toBe(false);
    expect(tables.insertion_orders[0].total_downloads).toBe(20000);
    expect(tables.payments).toEqual([]);

    const events = loggedEvents();
    expect(events.map((event) => event.eventType)).toContain("make_good.approved");
    expect(events.map((event) => event.eventType)).toContain("deal.status_changed");
    const approved = events.find((event) => event.eventType === "make_good.approved");
    expect(approved?.payload?.show_id).toBe("show_1");
    expect(reads.some((read) => read.selected.includes("podscan_id"))).toBe(false);
    expect(reads.some((read) => read.table === "show_profiles")).toBe(false);
  });

  it("records a credit without a new line or a deal-status change", async () => {
    asBrand();
    seedProposal({
      kind: "short",
      actual_downloads: 8000,
      shortfall_pct: 0.2,
      reason: "Delivered 8000 downloads against 10000 guaranteed.",
      options: [
        {
          id: "replacement_spot",
          label: "Additional episode",
          summary: "One additional episode at no cost.",
        },
        {
          id: "credit_shortfall",
          label: "Credit the shortfall",
          summary: "Credit the undelivered downloads.",
        },
      ],
    });
    tables.io_line_items[0].actual_downloads = 8000;

    const res = await approve(jsonReq("https://www.taylslate.com/approve", { option: "credit_shortfall" }) as never, {
      params: decisionParams,
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.make_good.delivery_state).toBe("credited");
    expect(body.make_good.credit_amount).toBe(50);
    expect(body.make_good.replacement_line_item_id).toBeNull();
    expect(tables.io_line_items).toHaveLength(1);
    expect(tables.deals[0].status).toBe("completed");
    expect(tables.payments).toEqual([]);
    expect(loggedEvents().map((event) => event.eventType)).toEqual(["make_good.approved"]);
  });

  it("403 when a non-owner brand declines", async () => {
    getAuthenticatedUser.mockResolvedValue({ id: "u_other" });
    getBrandProfileByUserId.mockResolvedValue({ id: "bp_other" });
    getShowProfileByUserId.mockResolvedValue(null);
    seedProposal();

    const res = await decline(jsonReq("https://www.taylslate.com/decline") as never, {
      params: decisionParams,
    });
    expect(res.status).toBe(403);
    expect(writes).toEqual([]);
    expect(tables.make_goods[0].status).toBe("proposed");
  });

  it("403 when the show on the deal tries to decline", async () => {
    asShow();
    seedProposal();

    const res = await decline(jsonReq("https://www.taylslate.com/decline") as never, {
      params: decisionParams,
    });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toMatch(/brand on this deal/i);
    expect(writes).toEqual([]);
    expect(tables.make_goods[0].status).toBe("proposed");
    expect(tables.deals[0].status).toBe("completed");
  });

  it("403 when a party on the deal tries to decline", async () => {
    asParty();
    seedProposal();

    const res = await decline(jsonReq("https://www.taylslate.com/decline") as never, {
      params: decisionParams,
    });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toMatch(/brand on this deal/i);
    expect(writes).toEqual([]);
    expect(tables.make_goods[0].status).toBe("proposed");
    expect(tables.deals[0].status).toBe("completed");
    expect(logEvent).not.toHaveBeenCalled();
  });
});

describe("make-good detection", () => {
  it("does not write for a brand who does not own the deal", async () => {
    getAuthenticatedUser.mockResolvedValue({ id: "u_other" });
    getBrandProfileByUserId.mockResolvedValue({ id: "bp_other" });
    getShowProfileByUserId.mockResolvedValue(null);

    const res = await detect(jsonReq("https://www.taylslate.com/make-goods") as never, {
      params: dealParams,
    });
    expect(res.status).toBe(404);
    expect(writes).toEqual([]);
    expect(tables.io_line_items[0].make_good_triggered).toBe(false);
  });

  it("proposes a missed spot from the aircheck and keeps the deal show id", async () => {
    asBrand();

    const res = await detect(jsonReq("https://www.taylslate.com/make-goods") as never, {
      params: dealParams,
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.can_approve).toBe(true);
    expect(body.make_goods).toHaveLength(1);
    expect(body.make_goods[0].kind).toBe("missed");
    expect(body.make_goods[0].show_id).toBe("show_1");
    expect(body.make_goods[0].status).toBe("proposed");
    expect(body.make_goods[0].options.map((option: { id: string }) => option.id)).toEqual([
      "replacement_spot",
      "reair",
    ]);
    expect(tables.io_line_items[0].make_good_triggered).toBe(true);
    expect(tables.payments).toEqual([]);
    expect(logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "make_good.detected",
        entityType: "make_good",
        payload: expect.objectContaining({ show_id: "show_1", kind: "missed" }),
      })
    );
    expect(reads.some((read) => read.table === "show_profiles")).toBe(false);
    expect(reads.some((read) => read.selected.includes("podscan_id"))).toBe(false);
  });

  it("proposes nothing when the IO leaves make-good off", async () => {
    asBrand();
    tables.insertion_orders[0].make_good_enabled = false;

    const res = await detect(jsonReq("https://www.taylslate.com/make-goods") as never, {
      params: dealParams,
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.make_goods).toEqual([]);
    expect(tables.io_line_items[0].make_good_triggered).toBe(false);
    expect(logEvent).not.toHaveBeenCalled();
  });

  it("proposes a short spot when the aircheck says the read ran", async () => {
    asBrand();
    tables.airchecks[0].match_result = "matched";
    tables.airchecks[0].review_decision = "confirmed";
    tables.airchecks[0].review_reason = null;
    tables.io_line_items[0].actual_downloads = 8000;

    const res = await list(new Request("https://www.taylslate.com/make-goods") as never, {
      params: dealParams,
    });
    expect(res.status).toBe(200);

    const detected = await detect(jsonReq("https://www.taylslate.com/make-goods") as never, {
      params: dealParams,
    });
    const body = await detected.json();
    expect(body.make_goods[0].kind).toBe("short");
    expect(body.make_goods[0].options.map((option: { id: string }) => option.id)).toEqual([
      "replacement_spot",
      "credit_shortfall",
    ]);
  });

  it("lets the owning brand approve through deals.brand_id when the profile id differs", async () => {
    getAuthenticatedUser.mockResolvedValue({ id: "u_owner" });
    getBrandProfileByUserId.mockResolvedValue({ id: "bp_unrelated" });
    getShowProfileByUserId.mockResolvedValue(null);
    seedProposal();

    const res = await approve(jsonReq("https://www.taylslate.com/approve", { option: "reair" }) as never, {
      params: decisionParams,
    });
    expect(res.status).toBe(200);
    expect(tables.make_goods[0].selected_option).toBe("reair");
    expect(tables.make_goods[0].decided_by).toBe("u_owner");
  });
});
