import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

type Row = Record<string, unknown>;

const { admin, state } = vi.hoisted(() => {
  const state: {
    tables: Record<string, Row[]>;
    fail: { table: string; mode: "code" | "throw"; code: string } | null;
  } = {
    tables: {
      deals: [],
      insertion_orders: [],
      io_line_items: [],
      shows: [],
      deal_price_records: [],
      make_goods: [],
    },
    fail: null,
  };

  class Query {
    private filters: Array<(row: Row) => boolean> = [];
    private op: "select" | "insert" | "update" = "select";
    private patch: Row | null = null;
    private insertRow: Row | null = null;

    constructor(private table: string) {}

    select() {
      return this;
    }
    eq(col: string, val: unknown) {
      this.filters.push((row) => row[col] === val);
      return this;
    }
    neq(col: string, val: unknown) {
      this.filters.push((row) => row[col] !== val);
      return this;
    }
    in(col: string, vals: unknown[]) {
      const allowed = new Set(vals);
      this.filters.push((row) => allowed.has(row[col]));
      return this;
    }
    is(col: string, val: unknown) {
      this.filters.push((row) => (val === null ? row[col] == null : row[col] === val));
      return this;
    }
    order() {
      return this;
    }
    insert(row: Row) {
      this.op = "insert";
      this.insertRow = { ...row };
      return this;
    }
    update(patch: Row) {
      this.op = "update";
      this.patch = { ...patch };
      return this;
    }
    maybeSingle() {
      return Promise.resolve(this.one());
    }
    then(
      resolve: (value: { data: unknown; error: { code: string } | null }) => unknown,
      reject?: (reason: unknown) => unknown
    ) {
      return Promise.resolve()
        .then(() => this.many())
        .then(resolve, reject);
    }

    private rows() {
      return state.tables[this.table] ?? [];
    }

    private matched() {
      return this.rows().filter((row) => this.filters.every((filter) => filter(row)));
    }

    private bomb(): { data: null; error: { code: string } } | null {
      if (!state.fail || state.fail.table !== this.table) return null;
      const fail = state.fail;
      state.fail = null;
      if (fail.mode === "throw") throw new Error("secret@example.com duplicate key value");
      return { data: null, error: { code: fail.code } };
    }

    private insertOne() {
      const table = this.rows();
      const row = this.insertRow ?? {};
      if (
        this.table === "deal_price_records" &&
        table.some((existing) => existing.deal_id === row.deal_id)
      ) {
        return { data: null, error: { code: "23505" } };
      }
      const saved: Row = {
        ...row,
        id: typeof row.id === "string" ? row.id : `rec-${table.length + 1}`,
        created_at:
          typeof row.created_at === "string"
            ? row.created_at
            : new Date(Date.UTC(2026, 4, 1, 0, 0, table.length)).toISOString(),
      };
      table.push(saved);
      return { data: saved, error: null };
    }

    private one() {
      const failed = this.bomb();
      if (failed) return failed;
      if (this.op === "insert") return this.insertOne();
      return { data: this.matched()[0] ?? null, error: null };
    }

    private many() {
      const failed = this.bomb();
      if (failed) return failed;
      if (this.op === "insert") return this.insertOne();
      if (this.op === "update") {
        const rows = this.matched();
        for (const row of rows) Object.assign(row, this.patch);
        return { data: rows, error: null };
      }
      return { data: this.matched(), error: null };
    }
  }

  return {
    state,
    admin: {
      from(table: string) {
        return new Query(table);
      },
    },
  };
});

vi.mock("@/lib/supabase/admin", () => ({ supabaseAdmin: admin }));

import {
  createDealPriceRecord,
  linkRebook,
  recordBookedDeal,
  recordDeliveryOutcome,
  recordMakeGoodOutcome,
  recordReportedConversions,
  updateOutcome,
} from "@/lib/deal-records";

function reset() {
  for (const table of Object.values(state.tables)) table.splice(0, table.length);
  state.fail = null;
}

function deal(id: string, overrides: Row = {}): Row {
  return {
    id,
    show_id: "show-1",
    brand_id: "brand-user",
    brand_profile_id: "bp-1",
    agreed_cpm: 28,
    agreed_episode_count: 3,
    agreed_placement: "mid-roll",
    agreed_flight_start: "2026-06-01",
    agreed_flight_end: "2026-06-30",
    price_type: "cpm",
    exclusivity_days: 90,
    rofr_days: 30,
    competitor_exclusion: ["Rival"],
    show_signed_at: "2026-05-02T12:00:00.000Z",
    signed_io_pdf_url: `deals/${id}/signed-io.pdf`,
    ...overrides,
  };
}

function seedDeal(id: string, overrides: Row = {}) {
  state.tables.deals.push(deal(id, overrides));
  if (!state.tables.shows.some((row) => row.id === "show-1")) {
    state.tables.shows.push({ id: "show-1", platform: "podcast" });
  }
  state.tables.insertion_orders.push(
    {
      id: `${id}-legacy`,
      io_number: "IO-2026-0099",
      deal_id: id,
      total_gross: 1,
      total_net: 1,
      payment_terms: "Net 30 EOM",
      payment_off_platform: false,
      created_at: "2026-05-03T00:00:00.000Z",
    },
    {
      id: `${id}-io`,
      io_number: `IO-${id.slice(0, 8).toUpperCase()}`,
      deal_id: id,
      total_gross: 1500,
      total_net: 1350,
      payment_terms: "Pay-as-delivers via Taylslate",
      exclusivity_days: 60,
      rofr_days: 14,
      cancellation_notice_days: 14,
      make_good_threshold: 0.1,
      competitor_exclusion: ["Rival Co"],
      payment_off_platform: true,
      created_at: "2026-05-01T00:00:00.000Z",
    }
  );
  state.tables.io_line_items.push(
    {
      io_id: `${id}-io`,
      format: "podcast",
      placement: "mid-roll",
      guaranteed_downloads: 10000,
      gross_rate: 280,
      gross_cpm: 28,
      price_type: "cpm",
      spot_format: "host-read",
      post_date: "2026-06-08",
      verified: true,
      actual_downloads: 12000,
    },
    {
      io_id: `${id}-io`,
      format: "podcast",
      placement: "mid-roll",
      guaranteed_downloads: 10000,
      gross_rate: 280,
      gross_cpm: 28,
      price_type: "cpm",
      spot_format: "host-read",
      post_date: "2026-06-15",
      verified: false,
      actual_downloads: null,
    }
  );
}

beforeEach(() => {
  reset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("deal price records", () => {
  it("snapshots the signed IO, not a later legacy IO", async () => {
    seedDeal("deal-1");
    const result = await createDealPriceRecord("deal-1");
    expect(result.created).toBe(true);
    const row = state.tables.deal_price_records[0];
    expect(row.io_id).toBe("deal-1-io");
    expect(row.io_number).toBe("IO-DEAL-1");
    expect(row.agreed_total_gross).toBe(1500);
    expect(row.agreed_total_net).toBe(1350);
    expect(row.pricing_basis).toBe("cpm");
    expect(row.unit_rate).toBe(28);
    expect(row.medium).toBe("podcast");
    expect(row.unit_format).toBe("host-read");
    expect(row.placement).toBe("mid-roll");
    expect(row.unit_count).toBe(2);
    expect(row.guaranteed_impressions).toBe(20000);
    expect(row.terms).toMatchObject({
      payment_terms: "Pay-as-delivers via Taylslate",
      exclusivity_days: 60,
      rofr_days: 14,
      cancellation_notice_days: 14,
      make_good_threshold: 0.1,
      competitor_exclusion: ["Rival Co"],
      payment_off_platform: true,
    });
    expect(row.flight_start).toBe("2026-06-01");
    expect(row.flight_end).toBe("2026-06-30");
    expect(row.booked_at).toBe("2026-05-02T12:00:00.000Z");
    expect(row.signed_io_pdf_url).toBe("deals/deal-1/signed-io.pdf");
    expect(row.outcome_status).toBe("booked");
    expect(row.rebook_sequence).toBe(1);
    expect(JSON.stringify(row)).not.toMatch(/email/i);
  });

  it("does not rewrite the snapshot when the deal is booked again", async () => {
    seedDeal("deal-1");
    await createDealPriceRecord("deal-1");
    state.tables.deal_price_records[0].agreed_total_gross = 1;
    const again = await createDealPriceRecord("deal-1");
    expect(again.created).toBe(false);
    expect(state.tables.deal_price_records).toHaveLength(1);
    expect(state.tables.deal_price_records[0].agreed_total_gross).toBe(1);
  });

  it("links a later booking for the same brand and show", async () => {
    seedDeal("deal-1", { show_signed_at: "2026-05-01T00:00:00.000Z" });
    seedDeal("deal-2", {
      show_signed_at: "2026-07-01T00:00:00.000Z",
      brand_profile_id: "bp-other",
    });
    seedDeal("deal-3", {
      show_id: "show-9",
      show_signed_at: "2026-08-01T00:00:00.000Z",
    });
    state.tables.shows.push({ id: "show-9", platform: "youtube" });
    await recordBookedDeal("deal-1");
    await recordBookedDeal("deal-2");
    await recordBookedDeal("deal-3");
    const first = state.tables.deal_price_records.find((row) => row.deal_id === "deal-1");
    const second = state.tables.deal_price_records.find((row) => row.deal_id === "deal-2");
    const third = state.tables.deal_price_records.find((row) => row.deal_id === "deal-3");
    expect(first?.rebooked).toBe(true);
    expect(second?.prior_record_id).toBe(first?.id);
    expect(second?.rebook_sequence).toBe(2);
    expect(third?.prior_record_id).toBeUndefined();
    await linkRebook("deal-2");
    expect(second?.prior_record_id).toBe(first?.id);
    expect(second?.rebook_sequence).toBe(2);
  });

  it("updates outcome fields and leaves the agreed total alone", async () => {
    seedDeal("deal-1");
    await createDealPriceRecord("deal-1");
    const saved = await updateOutcome("deal-1", { reported_conversions: 4 });
    expect(saved).toBe(true);
    const row = state.tables.deal_price_records[0];
    expect(row.reported_conversions).toBe(4);
    expect(row.agreed_total_gross).toBe(1500);
    expect(row.outcome_updated_at).toEqual(expect.any(String));
    await recordReportedConversions("deal-1", null);
    expect(row.reported_conversions).toBeNull();
  });

  it("sums delivered lines onto the record", async () => {
    seedDeal("deal-1");
    await createDealPriceRecord("deal-1");
    state.tables.io_line_items[1].verified = true;
    state.tables.io_line_items[1].actual_downloads = 8000;
    await recordDeliveryOutcome("deal-1");
    const row = state.tables.deal_price_records[0];
    expect(row.delivered_units).toBe(2);
    expect(row.actual_downloads).toBe(20000);
    expect(row.outcome_status).toBe("delivered");
    expect(row.delivered_at).toEqual(expect.any(String));
    const firstAt = row.delivered_at;
    await recordDeliveryOutcome("deal-1");
    expect(row.delivered_units).toBe(2);
    expect(row.delivered_at).toBe(firstAt);
  });

  it("records approved make-goods", async () => {
    seedDeal("deal-1");
    await createDealPriceRecord("deal-1");
    state.tables.make_goods.push(
      { deal_id: "deal-1", status: "approved", credit_amount: 10 },
      { deal_id: "deal-1", status: "approved", credit_amount: 5.5 },
      { deal_id: "deal-1", status: "declined", credit_amount: 99 }
    );
    await recordMakeGoodOutcome("deal-1");
    const row = state.tables.deal_price_records[0];
    expect(row.make_good_count).toBe(2);
    expect(row.make_good_credit_total).toBe(15.5);
    expect(row.outcome_status).toBe("make_good");
    expect(row.agreed_total_gross).toBe(1500);
  });

  it("swallows a record failure", async () => {
    seedDeal("deal-1");
    state.fail = { table: "deals", mode: "throw", code: "XX000" };
    await expect(recordBookedDeal("deal-1")).resolves.toBeUndefined();
    const logged = vi.mocked(console.error).mock.calls.map((call) => call.join(" ")).join("\n");
    expect(logged).not.toMatch(/secret@example.com|duplicate key/);
    expect(state.tables.deal_price_records).toHaveLength(0);
  });

  it("does not select contact fields", () => {
    const source = readFileSync(join(__dirname, "records.ts"), "utf8");
    expect(source).not.toMatch(/email/i);
    expect(source).toContain("payment_off_platform");
    expect(source).not.toMatch(/select\("\*"\)/);
  });
});
