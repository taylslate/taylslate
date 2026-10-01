import { beforeEach, describe, expect, it, vi } from "vitest";

interface Row {
  [key: string]: unknown;
}

interface Filter {
  col: string;
  op: "eq" | "neq" | "notnull";
  val?: unknown;
}

const { tables, resetTables, chargeForEpisode, logEvent } = vi.hoisted(() => {
  const tables: Record<string, Row[]> = {
    io_line_items: [],
    insertion_orders: [],
    deals: [],
    shows: [],
    brand_profiles: [],
    airchecks: [],
    payments: [],
  };
  function resetTables() {
    for (const key of Object.keys(tables)) tables[key] = [];
  }
  return {
    tables,
    resetTables,
    chargeForEpisode: vi.fn(),
    logEvent: vi.fn(),
  };
});

vi.mock("@/lib/supabase/admin", () => {
  function makeBuilder(table: string) {
    const filters: Filter[] = [];
    let op: "select" | "update" = "select";
    let payload: Row | null = null;

    function matches(row: Row): boolean {
      return filters.every((filter) => {
        if (filter.op === "eq") return row[filter.col] === filter.val;
        if (filter.op === "neq") return row[filter.col] !== filter.val;
        return row[filter.col] != null;
      });
    }

    function finish(single: boolean): {
      data: Row | Row[] | null;
      error: { message: string; code?: string } | null;
    } {
      const rows = tables[table] ?? [];
      if (op === "update") {
        if (!payload) return { data: null, error: { message: "missing payload" } };
        const index = rows.findIndex(matches);
        if (index < 0) {
          return { data: null, error: { message: "row count", code: "PGRST116" } };
        }
        rows[index] = {
          ...rows[index],
          ...payload,
          updated_at: new Date().toISOString(),
        };
        return { data: rows[index], error: null };
      }
      const found = rows.filter(matches);
      if (single && found.length !== 1) {
        return { data: null, error: { message: "row count", code: "PGRST116" } };
      }
      return { data: found[0] ?? null, error: null };
    }

    const builder = {
      select() {
        return builder;
      },
      eq(col: string, val: unknown) {
        filters.push({ col, op: "eq", val });
        return builder;
      },
      neq(col: string, val: unknown) {
        filters.push({ col, op: "neq", val });
        return builder;
      },
      not(col: string, operator: string, val: unknown) {
        if (operator === "is" && val === null) {
          filters.push({ col, op: "notnull" });
        }
        return builder;
      },
      order() {
        return builder;
      },
      limit() {
        return builder;
      },
      update(row: Row) {
        op = "update";
        payload = { ...row };
        return builder;
      },
      maybeSingle() {
        return Promise.resolve(finish(false));
      },
      single() {
        return Promise.resolve(finish(true));
      },
      then(
        resolve: (value: unknown) => void,
        reject?: (reason: unknown) => void
      ) {
        try {
          resolve(finish(false));
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

vi.mock("@/lib/stripe/payment-intent", () => ({
  chargeForEpisode: (...args: unknown[]) => chargeForEpisode(...args),
}));

vi.mock("@/lib/data/events", () => ({
  logEvent: (...args: unknown[]) => logEvent(...args),
}));

import { loadAircheckReview } from "./store";
import { confirmAircheck, rejectAircheck } from "./review";

const CHARGE = {
  paymentId: "pay_1",
  stripePaymentIntentId: "pi_1",
  amountChargedCents: 27500,
  applicationFeeAmountCents: 2500,
  platformFeePercentageAtCharge: 0.1,
  status: "succeeded",
};

const LINE = "li_1";

function seed() {
  tables.io_line_items.push({
    id: LINE,
    io_id: "io_1",
    verified: false,
    actual_post_date: null,
    actual_downloads: null,
    show_name: "Huberman Lab",
    placement: "mid-roll",
    episode_url: "https://audio.example/ep",
    post_date: "2026-09-01",
    format: "podcast",
  });
  tables.insertion_orders.push({
    id: "io_1",
    deal_id: "deal_1",
    advertiser_name: "Sauna Box",
    publisher_name: "Huberman Lab",
  });
  tables.deals.push({
    id: "deal_1",
    show_id: "show_1",
    promo_code: "HUBERMAN",
    brand_profile_id: "bp_1",
  });
  tables.shows.push({
    id: "show_1",
    name: "Huberman Lab",
    rss_url: "https://feeds.example/huberman",
  });
  tables.brand_profiles.push({
    id: "bp_1",
    brand_name: "Sauna Box",
    brand_website: "https://saunabox.com",
  });
  tables.airchecks.push({
    id: "ac_1",
    io_line_item_id: LINE,
    status: "transcribed",
    transcript_text: "brought to you by Sauna Box",
    provider: "podscan",
    error: null,
    match_result: "matched",
    match_evidence: {
      excerpt: "brought to you by Sauna Box. Use code HUBERMAN.",
      reason: null,
      brand: "found",
      code_or_url: "found",
      position: "found",
      length: "missing",
    },
    matched_at: "2026-09-29T00:00:00.000Z",
    review_decision: null,
    review_reason: null,
    decided_by: null,
    decided_at: null,
    charge_error: null,
    created_at: "2026-09-29T00:00:00.000Z",
    updated_at: "2026-09-29T00:00:00.000Z",
  });
}

beforeEach(() => {
  resetTables();
  seed();
  chargeForEpisode.mockReset();
  logEvent.mockReset();
  logEvent.mockResolvedValue(null);
});

describe("confirmAircheck", () => {
  it("confirms a matched row, charges once, and records success", async () => {
    chargeForEpisode.mockResolvedValueOnce(CHARGE);

    const result = await confirmAircheck({
      ioLineItemId: LINE,
      decidedBy: "ops@taylslate.com",
      actorId: "admin_1",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.alreadyCharged).toBe(false);
    expect(result.charge?.stripePaymentIntentId).toBe("pi_1");
    expect(chargeForEpisode).toHaveBeenCalledTimes(1);
    expect(chargeForEpisode).toHaveBeenCalledWith({
      dealId: "deal_1",
      ioLineItemId: LINE,
    });
    expect(tables.airchecks[0].review_decision).toBe("confirmed");
    expect(tables.airchecks[0].charge_error).toBeNull();
    expect(tables.airchecks[0].decided_by).toBe("ops@taylslate.com");
    expect(tables.io_line_items[0].verified).toBe(true);
  });

  it("does not charge again when the row is already confirmed", async () => {
    tables.airchecks[0].review_decision = "confirmed";
    tables.airchecks[0].decided_by = "ops@taylslate.com";
    tables.payments.push({
      id: "pay_existing",
      io_line_item_id: LINE,
      status: "succeeded",
      stripe_payment_intent_id: "pi_existing",
    });

    const result = await confirmAircheck({
      ioLineItemId: LINE,
      decidedBy: "ops@taylslate.com",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.alreadyCharged).toBe(true);
    expect(chargeForEpisode).not.toHaveBeenCalled();
    expect(tables.payments).toHaveLength(1);
  });

  it("does not charge when a payment already exists for the line", async () => {
    tables.payments.push({
      id: "pay_existing",
      io_line_item_id: LINE,
      status: "succeeded",
      stripe_payment_intent_id: "pi_existing",
    });

    const result = await confirmAircheck({
      ioLineItemId: LINE,
      decidedBy: "ops@taylslate.com",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.alreadyCharged).toBe(true);
    expect(chargeForEpisode).not.toHaveBeenCalled();
    expect(tables.airchecks[0].review_decision).toBe("confirmed");
    expect(tables.airchecks[0].charge_error).toBeNull();
    expect(tables.payments).toHaveLength(1);
  });

  it("stores a failed charge and does not report success", async () => {
    chargeForEpisode.mockRejectedValueOnce(new Error("card declined"));

    const result = await confirmAircheck({
      ioLineItemId: LINE,
      decidedBy: "ops@taylslate.com",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.chargeError).toMatch(/card declined/);
    expect(tables.airchecks[0].review_decision).toBeNull();
    expect(tables.airchecks[0].charge_error).toMatch(/card declined/);
    expect(tables.airchecks[0].decided_by).toBeNull();
    expect(tables.io_line_items[0].verified).toBe(false);
    expect(chargeForEpisode).toHaveBeenCalledTimes(1);
  });
});

describe("rejectAircheck", () => {
  it("stores the rejection and never calls the charge", async () => {
    const row = await rejectAircheck({
      ioLineItemId: LINE,
      decidedBy: "ops@taylslate.com",
      actorId: "admin_1",
      reason: "  Host read a competitor  ",
    });

    expect(chargeForEpisode).not.toHaveBeenCalled();
    expect(row.review_decision).toBe("rejected");
    expect(row.review_reason).toBe("Host read a competitor");
    expect(row.decided_by).toBe("ops@taylslate.com");
    expect(tables.io_line_items[0].verified).toBe(false);
    expect(tables.payments).toHaveLength(0);
  });
});

describe("loadAircheckReview", () => {
  it("shows the show, the buy, the match, and the excerpt", async () => {
    const view = await loadAircheckReview(LINE);
    expect(view).toMatchObject({
      showName: "Huberman Lab",
      advertiserName: "Sauna Box",
      brandName: "Sauna Box",
      promoCode: "HUBERMAN",
      url: "https://saunabox.com",
      placement: "mid-roll",
      matchResult: "matched",
      excerpt: "brought to you by Sauna Box. Use code HUBERMAN.",
      hasAircheck: true,
      reviewDecision: null,
    });
  });
});
