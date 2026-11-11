import { beforeEach, describe, expect, it, vi } from "vitest";

interface Row {
  [key: string]: unknown;
}

interface Filter {
  kind: "eq" | "neq" | "notnull" | "is" | "lt" | "or";
  col?: string;
  val?: unknown;
  or?: Filter[];
}

const {
  tables,
  resetTables,
  chargeForEpisode,
  logEvent,
  hook,
  delivery,
  flags,
} = vi.hoisted(() => {
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
    hook: vi.fn(),
    delivery: { deliverAndChargeLine: vi.fn() },
    flags: { claimColumnMissing: false, failConfirmedSave: false },
  };
});

function splitOr(expr: string): string[] {
  const parts: string[] = [];
  let current = "";
  let quoted = false;
  for (const ch of expr) {
    if (ch === '"') {
      quoted = !quoted;
      current += ch;
      continue;
    }
    if (ch === "," && !quoted) {
      parts.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  if (current) parts.push(current);
  return parts;
}

function parseClause(clause: string): Filter {
  const match = clause.match(/^([A-Za-z0-9_]+)\.(is|eq|neq|lt|gt|gte|lte)\.(.*)$/);
  if (!match) return { kind: "eq", col: "__none__", val: "__unparsed__" };
  const [, col, op, raw] = match;
  const quoted = raw.startsWith('"') && raw.endsWith('"');
  const val = quoted ? raw.slice(1, -1) : raw;
  if (op === "is") return { kind: "is", col, val: val === "null" ? null : val };
  if (op === "lt") return { kind: "lt", col, val };
  if (op === "neq") return { kind: "neq", col, val };
  return { kind: "eq", col, val };
}

function matches(row: Row, filters: Filter[]): boolean {
  return filters.every((filter) => {
    if (filter.kind === "eq") return row[filter.col ?? ""] === filter.val;
    if (filter.kind === "neq") return row[filter.col ?? ""] !== filter.val;
    if (filter.kind === "notnull") return row[filter.col ?? ""] != null;
    if (filter.kind === "is") {
      return filter.val === null
        ? row[filter.col ?? ""] == null
        : row[filter.col ?? ""] === filter.val;
    }
    if (filter.kind === "lt") {
      const left = row[filter.col ?? ""];
      if (left == null || filter.val == null) return false;
      return String(left) < String(filter.val);
    }
    if (filter.kind === "or") return (filter.or ?? []).some((part) => matches(row, [part]));
    return true;
  });
}

vi.mock("@/lib/supabase/admin", () => {
  function makeBuilder(table: string) {
    const filters: Filter[] = [];
    let op: "select" | "update" = "select";
    let payload: Row | null = null;
    let max: number | null = null;

    function finish(single: boolean, emptyUpdateOk: boolean): {
      data: Row | Row[] | null;
      error: { message: string; code?: string } | null;
    } {
      const rows = tables[table] ?? [];
      if (op === "update") {
        if (
          flags.claimColumnMissing &&
          payload &&
          Object.prototype.hasOwnProperty.call(payload, "confirm_claimed_at")
        ) {
          return {
            data: null,
            error: {
              code: "42703",
              message: "column confirm_claimed_at of relation airchecks does not exist",
            },
          };
        }
        if (flags.failConfirmedSave && payload?.review_decision === "confirmed") {
          flags.failConfirmedSave = false;
          return { data: null, error: { message: "save failed" } };
        }
        if (!payload) return { data: null, error: { message: "missing payload" } };
        const index = rows.findIndex((row) => matches(row, filters));
        if (index < 0) {
          if (emptyUpdateOk) return { data: null, error: null };
          return { data: null, error: { message: "row count", code: "PGRST116" } };
        }
        rows[index] = {
          ...rows[index],
          ...payload,
          updated_at: new Date().toISOString(),
        };
        return { data: rows[index], error: null };
      }
      const found = rows.filter((row) => matches(row, filters));
      const sliced = max == null ? found : found.slice(0, max);
      if (single && sliced.length !== 1) {
        return { data: null, error: { message: "row count", code: "PGRST116" } };
      }
      return { data: sliced[0] ?? null, error: null };
    }

    const builder = {
      select() {
        return builder;
      },
      eq(col: string, val: unknown) {
        filters.push({ kind: "eq", col, val });
        return builder;
      },
      neq(col: string, val: unknown) {
        filters.push({ kind: "neq", col, val });
        return builder;
      },
      is(col: string, val: unknown) {
        filters.push({ kind: "is", col, val });
        return builder;
      },
      lt(col: string, val: unknown) {
        filters.push({ kind: "lt", col, val });
        return builder;
      },
      or(expr: string) {
        filters.push({ kind: "or", or: splitOr(expr).map(parseClause) });
        return builder;
      },
      not(col: string, operator: string, val: unknown) {
        if (operator === "is" && val === null) {
          filters.push({ kind: "notnull", col });
        }
        return builder;
      },
      order() {
        return builder;
      },
      limit(n: number) {
        max = n;
        return builder;
      },
      update(row: Row) {
        op = "update";
        payload = { ...row };
        return builder;
      },
      maybeSingle() {
        return Promise.resolve(finish(false, true));
      },
      single() {
        return Promise.resolve(finish(true, false));
      },
      then(resolve: (value: unknown) => void, reject?: (reason: unknown) => void) {
        try {
          resolve(finish(false, false));
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

vi.mock("@/lib/delivery/mark-delivered", () => ({
  deliverAndChargeLine: (...args: unknown[]) => delivery.deliverAndChargeLine(...args),
}));

vi.mock("@/lib/data/events", () => ({
  logEvent: (...args: unknown[]) => logEvent(...args),
}));

vi.mock("./detect", () => ({
  runMakeGoodDetectionHook: (...args: unknown[]) => hook(...args),
}));

import { loadAircheckReview } from "./store";
import {
  AircheckConfirmInProgress,
  AircheckConfirmUnavailable,
  AircheckReviewConflict,
  confirmAircheck,
  rejectAircheck,
} from "./review";

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
    status: "show_signed",
    cancelled_at: null,
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
    confirm_claimed_at: null,
    confirm_claimed_by: null,
    ready_for_review: true,
    confidence: 0.91,
    created_at: "2026-09-29T00:00:00.000Z",
    updated_at: "2026-09-29T00:00:00.000Z",
  });
}

function events(type: string) {
  return logEvent.mock.calls
    .map((call) => call[0] as {
      eventType: string;
      actorId?: string | null;
      payload?: Record<string, unknown>;
    })
    .filter((event) => event.eventType === type);
}

beforeEach(async () => {
  resetTables();
  seed();
  flags.claimColumnMissing = false;
  flags.failConfirmedSave = false;
  chargeForEpisode.mockReset();
  logEvent.mockReset();
  logEvent.mockResolvedValue(null);
  hook.mockReset();
  hook.mockResolvedValue(undefined);
  delivery.deliverAndChargeLine.mockReset();
  const actual = await vi.importActual<typeof import("@/lib/delivery/mark-delivered")>(
    "@/lib/delivery/mark-delivered"
  );
  delivery.deliverAndChargeLine.mockImplementation((input) =>
    actual.deliverAndChargeLine(input as { ioLineItemId: string })
  );
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
    expect(delivery.deliverAndChargeLine).toHaveBeenCalledTimes(1);
    expect(tables.airchecks[0].review_decision).toBe("confirmed");
    expect(tables.airchecks[0].charge_error).toBeNull();
    expect(tables.airchecks[0].decided_by).toBe("ops@taylslate.com");
    expect(tables.airchecks[0].confirm_claimed_at).toBeNull();
    expect(tables.io_line_items[0].verified).toBe(true);
    expect(hook).toHaveBeenCalledTimes(1);
    const confirmed = events("aircheck.confirmed");
    expect(confirmed).toHaveLength(1);
    expect(confirmed[0].actorId).toBe("admin_1");
    expect(confirmed[0].payload).toMatchObject({
      io_line_item_id: LINE,
      decided_by: "ops@taylslate.com",
      already_charged: false,
      payment_id: "pay_1",
      match_result: "matched",
      confidence: 0.91,
      override: false,
    });
    expect(JSON.stringify(confirmed[0].payload)).not.toMatch(/transcript|audio_url/);
  });

  it("confirms a not_matched row and flags the override", async () => {
    tables.airchecks[0].match_result = "not_matched";
    tables.airchecks[0].ready_for_review = false;
    chargeForEpisode.mockResolvedValueOnce(CHARGE);

    const result = await confirmAircheck({
      ioLineItemId: LINE,
      decidedBy: "ops@taylslate.com",
      actorId: "admin_1",
    });

    expect(result.ok).toBe(true);
    expect(chargeForEpisode).toHaveBeenCalledTimes(1);
    expect(events("aircheck.confirmed")[0].payload).toMatchObject({
      match_result: "not_matched",
      override: true,
    });
  });

  it("does not charge again when the row is already confirmed", async () => {
    tables.airchecks[0].review_decision = "confirmed";
    tables.airchecks[0].decided_by = "ops@taylslate.com";
    tables.payments.push({
      id: "pay_existing",
      deal_id: "deal_1",
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
    expect(delivery.deliverAndChargeLine).not.toHaveBeenCalled();
    expect(tables.payments).toHaveLength(1);
    expect(hook).toHaveBeenCalledTimes(1);
  });

  it("does not charge when a payment already exists for the deal and line", async () => {
    tables.payments.push({
      id: "pay_existing",
      deal_id: "deal_1",
      io_line_item_id: LINE,
      status: "succeeded",
      stripe_payment_intent_id: "pi_existing",
    });

    const result = await confirmAircheck({
      ioLineItemId: LINE,
      decidedBy: "ops@taylslate.com",
      actorId: "admin_1",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.alreadyCharged).toBe(true);
    expect(chargeForEpisode).not.toHaveBeenCalled();
    expect(tables.airchecks[0].review_decision).toBe("confirmed");
    expect(tables.airchecks[0].charge_error).toBeNull();
    expect(tables.payments).toHaveLength(1);
    expect(events("aircheck.confirmed")[0].payload).toMatchObject({
      already_charged: true,
      payment_id: "pay_existing",
      override: false,
    });
  });

  it("does not treat a payment on the same line under a different deal as already charged", async () => {
    tables.payments.push({
      id: "pay_other",
      deal_id: "deal_other",
      io_line_item_id: LINE,
      status: "succeeded",
      stripe_payment_intent_id: "pi_other",
    });
    chargeForEpisode.mockResolvedValueOnce(CHARGE);

    const result = await confirmAircheck({
      ioLineItemId: LINE,
      decidedBy: "ops@taylslate.com",
    });

    expect(result.ok).toBe(true);
    expect(chargeForEpisode).toHaveBeenCalledTimes(1);
  });

  it("stores a failed charge, emits charge_failed, and releases the claim", async () => {
    chargeForEpisode.mockRejectedValueOnce(new Error("card declined"));

    const result = await confirmAircheck({
      ioLineItemId: LINE,
      decidedBy: "ops@taylslate.com",
      actorId: "admin_1",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.chargeError).toMatch(/card declined/);
    expect(tables.airchecks[0].review_decision).toBeNull();
    expect(tables.airchecks[0].charge_error).toMatch(/card declined/);
    expect(tables.airchecks[0].decided_by).toBeNull();
    expect(tables.airchecks[0].confirm_claimed_at).toBeNull();
    expect(tables.io_line_items[0].verified).toBe(false);
    expect(chargeForEpisode).toHaveBeenCalledTimes(1);
    expect(hook).not.toHaveBeenCalled();
    const failed = events("aircheck.charge_failed");
    expect(failed).toHaveLength(1);
    expect(failed[0].actorId).toBe("admin_1");
    expect(failed[0].payload).toMatchObject({
      io_line_item_id: LINE,
      decided_by: "ops@taylslate.com",
      rolled_back: true,
    });
    expect(String(failed[0].payload?.charge_error)).toMatch(/card declined/);
    expect(String(failed[0].payload?.charge_error).length).toBeLessThanOrEqual(500);
  });

  it("does not charge again when the confirmed save fails and a retry finds the payment", async () => {
    delivery.deliverAndChargeLine.mockImplementation(async () => {
      tables.payments.push({
        id: "pay_1",
        deal_id: "deal_1",
        io_line_item_id: LINE,
        status: "succeeded",
        stripe_payment_intent_id: "pi_1",
      });
      return { ok: true, charge: CHARGE };
    });
    flags.failConfirmedSave = true;

    await expect(
      confirmAircheck({
        ioLineItemId: LINE,
        decidedBy: "ops@taylslate.com",
        actorId: "admin_1",
      })
    ).rejects.toThrow(/save failed/);
    expect(delivery.deliverAndChargeLine).toHaveBeenCalledTimes(1);
    expect(tables.airchecks[0].review_decision).toBeNull();
    expect(tables.airchecks[0].confirm_claimed_at).toBeNull();

    const retry = await confirmAircheck({
      ioLineItemId: LINE,
      decidedBy: "ops@taylslate.com",
      actorId: "admin_1",
    });
    expect(retry.ok).toBe(true);
    if (!retry.ok) return;
    expect(retry.alreadyCharged).toBe(true);
    expect(delivery.deliverAndChargeLine).toHaveBeenCalledTimes(1);
    expect(tables.airchecks[0].review_decision).toBe("confirmed");
  });

  it("lets one of two concurrent confirms charge", async () => {
    let started = 0;
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    delivery.deliverAndChargeLine.mockImplementation(async () => {
      started += 1;
      await gate;
      return { ok: true, charge: CHARGE };
    });

    const pending = Promise.allSettled([
      confirmAircheck({ ioLineItemId: LINE, decidedBy: "ops@taylslate.com", actorId: "a" }),
      confirmAircheck({ ioLineItemId: LINE, decidedBy: "ops@taylslate.com", actorId: "b" }),
    ]);
    await vi.waitFor(() => expect(started).toBe(1));
    release();
    const results = await pending;
    const ok = results.filter((result) => result.status === "fulfilled");
    const blocked = results.filter((result) => result.status === "rejected");
    expect(ok).toHaveLength(1);
    expect(blocked).toHaveLength(1);
    expect(blocked[0].status === "rejected" && blocked[0].reason).toBeInstanceOf(
      AircheckConfirmInProgress
    );
    expect(delivery.deliverAndChargeLine).toHaveBeenCalledTimes(1);
    expect(events("aircheck.confirm_blocked")).toHaveLength(1);
  });

  it.each([
    ["skipped", "skipped", /skipped/i],
    ["failed", "failed", /failed/i],
    ["pending", "pending", /pending/i],
  ] as const)("blocks a %s row with no charge", async (label, value, pattern) => {
    if (label === "skipped") tables.airchecks[0].match_result = value;
    else tables.airchecks[0].status = value;

    await expect(
      confirmAircheck({ ioLineItemId: LINE, decidedBy: "ops@taylslate.com", actorId: "admin_1" })
    ).rejects.toThrow(pattern);
    expect(delivery.deliverAndChargeLine).not.toHaveBeenCalled();
    expect(events("aircheck.confirm_blocked")[0].actorId).toBe("admin_1");
    expect(events("aircheck.confirm_blocked")[0].payload).toMatchObject({
      io_line_item_id: LINE,
      decided_by: "ops@taylslate.com",
    });
  });

  it("blocks an unjudged row", async () => {
    tables.airchecks[0].match_result = null;
    await expect(
      confirmAircheck({ ioLineItemId: LINE, decidedBy: "ops@taylslate.com" })
    ).rejects.toThrow(/not been judged/);
    expect(chargeForEpisode).not.toHaveBeenCalled();
  });

  it("blocks a rejected row", async () => {
    tables.airchecks[0].review_decision = "rejected";
    await expect(
      confirmAircheck({ ioLineItemId: LINE, decidedBy: "ops@taylslate.com", actorId: "admin_1" })
    ).rejects.toBeInstanceOf(AircheckReviewConflict);
    await expect(
      confirmAircheck({ ioLineItemId: LINE, decidedBy: "ops@taylslate.com" })
    ).rejects.toThrow(/Reopening a rejected line is not supported/);
    expect(delivery.deliverAndChargeLine).not.toHaveBeenCalled();
    expect(events("aircheck.confirm_blocked").length).toBeGreaterThan(0);
  });

  it("blocks a cancelled deal", async () => {
    tables.deals[0].cancelled_at = "2026-11-01T00:00:00.000Z";
    await expect(
      confirmAircheck({ ioLineItemId: LINE, decidedBy: "ops@taylslate.com" })
    ).rejects.toThrow(/cancelled/);
    expect(delivery.deliverAndChargeLine).not.toHaveBeenCalled();
  });

  it("blocks a deal that is not booked", async () => {
    tables.deals[0].status = "planning";
    await expect(
      confirmAircheck({ ioLineItemId: LINE, decidedBy: "ops@taylslate.com" })
    ).rejects.toThrow(/not booked/);
    expect(chargeForEpisode).not.toHaveBeenCalled();
  });

  it("returns 503 and does not charge when the claim column is missing", async () => {
    flags.claimColumnMissing = true;
    await expect(
      confirmAircheck({ ioLineItemId: LINE, decidedBy: "ops@taylslate.com" })
    ).rejects.toBeInstanceOf(AircheckConfirmUnavailable);
    await expect(
      confirmAircheck({ ioLineItemId: LINE, decidedBy: "ops@taylslate.com" })
    ).rejects.toThrow(/migration 080/);
    expect(delivery.deliverAndChargeLine).not.toHaveBeenCalled();
    expect(tables.airchecks[0].review_decision).toBeNull();
  });

  it("reclaims a stale claim", async () => {
    tables.airchecks[0].confirm_claimed_at = new Date(Date.now() - 6 * 60 * 1000).toISOString();
    tables.airchecks[0].confirm_claimed_by = "old@taylslate.com";
    chargeForEpisode.mockResolvedValueOnce(CHARGE);

    const result = await confirmAircheck({
      ioLineItemId: LINE,
      decidedBy: "ops@taylslate.com",
    });
    expect(result.ok).toBe(true);
    expect(chargeForEpisode).toHaveBeenCalledTimes(1);
    expect(tables.airchecks[0].review_decision).toBe("confirmed");
  });
});

describe("rejectAircheck", () => {
  it("stores the rejection, runs the make-good hook once, and never charges", async () => {
    const row = await rejectAircheck({
      ioLineItemId: LINE,
      decidedBy: "ops@taylslate.com",
      actorId: "admin_1",
      reason: "  Host read a competitor  ",
    });

    expect(chargeForEpisode).not.toHaveBeenCalled();
    expect(delivery.deliverAndChargeLine).not.toHaveBeenCalled();
    expect(hook).toHaveBeenCalledTimes(1);
    expect(row.review_decision).toBe("rejected");
    expect(row.review_reason).toBe("Host read a competitor");
    expect(row.decided_by).toBe("ops@taylslate.com");
    expect(tables.io_line_items[0].verified).toBe(false);
    expect(tables.payments).toHaveLength(0);
    expect(tables.airchecks[0].confirm_claimed_at).toBeNull();
    expect(events("aircheck.rejected")[0].actorId).toBe("admin_1");
  });

  it("is blocked after a confirm", async () => {
    chargeForEpisode.mockResolvedValueOnce(CHARGE);
    await confirmAircheck({ ioLineItemId: LINE, decidedBy: "ops@taylslate.com" });
    hook.mockClear();
    delivery.deliverAndChargeLine.mockClear();

    await expect(
      rejectAircheck({ ioLineItemId: LINE, decidedBy: "ops@taylslate.com" })
    ).rejects.toBeInstanceOf(AircheckReviewConflict);
    expect(delivery.deliverAndChargeLine).not.toHaveBeenCalled();
    expect(hook).not.toHaveBeenCalled();
    expect(tables.airchecks[0].review_decision).toBe("confirmed");
  });

  it("is blocked while a claim is active", async () => {
    tables.airchecks[0].confirm_claimed_at = new Date().toISOString();
    tables.airchecks[0].confirm_claimed_by = "other@taylslate.com";

    await expect(
      rejectAircheck({ ioLineItemId: LINE, decidedBy: "ops@taylslate.com" })
    ).rejects.toBeInstanceOf(AircheckConfirmInProgress);
    expect(delivery.deliverAndChargeLine).not.toHaveBeenCalled();
    expect(hook).not.toHaveBeenCalled();
    expect(tables.airchecks[0].review_decision).toBeNull();
    expect(tables.airchecks[0].confirm_claimed_by).toBe("other@taylslate.com");
  });

  it("returns 503 and does not charge when the claim column is missing", async () => {
    flags.claimColumnMissing = true;
    await expect(
      rejectAircheck({ ioLineItemId: LINE, decidedBy: "ops@taylslate.com" })
    ).rejects.toBeInstanceOf(AircheckConfirmUnavailable);
    expect(delivery.deliverAndChargeLine).not.toHaveBeenCalled();
    expect(tables.airchecks[0].review_decision).toBeNull();
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
