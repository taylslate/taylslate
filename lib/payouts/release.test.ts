import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;

interface Filter {
  op: "eq" | "in" | "is" | "not";
  column: string;
  value: unknown;
  operator?: string;
}

interface Query {
  action: "select" | "insert" | "update";
  filters: Filter[];
  patch?: Row;
  row?: Row;
  limit?: number;
  orders: { column: string; ascending: boolean }[];
}

const db: Record<string, Row[]> = {};
const stripeState = vi.hoisted(() => ({
  mode: "ok" as "ok" | "idempotent" | "reject-second",
  creates: 0,
  listed: [] as Record<string, unknown>[],
  inflight: new Map<string, Promise<Record<string, unknown>>>(),
  paramsByKey: new Map<string, string>(),
}));

function matches(row: Row, filters: Filter[]): boolean {
  return filters.every((filter) => {
    if (filter.op === "eq") return row[filter.column] === filter.value;
    if (filter.op === "in") return (filter.value as unknown[]).includes(row[filter.column]);
    if (filter.op === "is") return filter.value == null ? row[filter.column] == null : row[filter.column] === filter.value;
    if (filter.op === "not" && filter.operator === "is") return row[filter.column] != null;
    if (filter.op === "not" && filter.column === "payments.status" && filter.operator === "in") {
      const payment = (db.payments ?? []).find((item) => item.id === row.payment_id);
      const status = typeof payment?.status === "string" ? payment.status : "";
      const blocked = String(filter.value)
        .replace(/[()"]/g, "")
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean);
      return !blocked.includes(status);
    }
    return false;
  });
}

function copy(row: Row): Row {
  return { ...row };
}

function finish(table: string, query: Query, mode: "single" | "maybe" | "many") {
  const rows = db[table] ?? (db[table] = []);
  if (query.action === "insert" && query.row) {
    if (table === "payouts" && rows.some((row) => row.payment_id === query.row?.payment_id)) {
      return { data: null, error: { code: "23505", message: "duplicate" } };
    }
    const stored = {
      ...query.row,
      id: query.row.id ?? `${table}-${rows.length + 1}`,
      created_at: query.row.created_at ?? new Date(Date.UTC(2026, 0, rows.length + 1)).toISOString(),
    };
    rows.push(stored);
    return { data: mode === "many" ? [copy(stored)] : copy(stored), error: null };
  }
  let matched = rows.filter((row) => matches(row, query.filters));
  if (query.action === "update" && query.patch) {
    for (const row of matched) Object.assign(row, query.patch);
    const data = mode === "many" ? matched.map(copy) : (matched[0] ? copy(matched[0]) : null);
    return { data, error: null };
  }
  for (const order of query.orders) {
    matched = [...matched].sort((a, b) => {
      const av = String(a[order.column] ?? "");
      const bv = String(b[order.column] ?? "");
      if (av === bv) return 0;
      const cmp = av < bv ? -1 : 1;
      return order.ascending ? cmp : -cmp;
    });
  }
  if (query.limit !== undefined) matched = matched.slice(0, query.limit);
  const copied = matched.map(copy);
  if (mode === "many") return { data: copied, error: null };
  if (mode === "maybe") return { data: copied[0] ?? null, error: null };
  if (!copied[0]) return { data: null, error: { code: "PGRST116", message: "secret-db-text" } };
  return { data: copied[0], error: null };
}

function builder(table: string) {
  const query: Query = { action: "select", filters: [], orders: [] };
  const api = {
    select() {
      return api;
    },
    insert(row: Row) {
      query.action = "insert";
      query.row = { ...row };
      return api;
    },
    update(patch: Row) {
      query.action = "update";
      query.patch = { ...patch };
      return api;
    },
    eq(column: string, value: unknown) {
      query.filters.push({ op: "eq", column, value });
      return api;
    },
    in(column: string, value: unknown[]) {
      query.filters.push({ op: "in", column, value });
      return api;
    },
    is(column: string, value: unknown) {
      query.filters.push({ op: "is", column, value });
      return api;
    },
    not(column: string, operator: string, value: unknown) {
      query.filters.push({ op: "not", column, operator, value });
      return api;
    },
    order(column: string, opts?: { ascending?: boolean }) {
      query.orders.push({ column, ascending: opts?.ascending !== false });
      return api;
    },
    limit(n: number) {
      query.limit = n;
      return api;
    },
    maybeSingle() {
      return Promise.resolve(finish(table, query, "maybe"));
    },
    single() {
      return Promise.resolve(finish(table, query, "single"));
    },
    then(resolve: (value: { data: unknown; error: unknown }) => unknown, reject?: (err: unknown) => unknown) {
      return Promise.resolve(finish(table, query, "many")).then(resolve, reject);
    },
  };
  return api;
}

const stripe = vi.hoisted(() => ({
  transfers: {
    create: vi.fn(async (params: Record<string, unknown>, opts?: { idempotencyKey?: string }) => {
      const key = opts?.idempotencyKey ?? "none";
      const metadata = (params.metadata ?? {}) as Record<string, unknown>;
      const amount = params.amount;
      const encoded = JSON.stringify(params);
      const previous = stripeState.paramsByKey.get(key);
      if (previous !== undefined && previous !== encoded) {
        const err = new Error("idempotency_error");
        err.name = "StripeIdempotencyError";
        throw err;
      }
      if (previous === undefined) stripeState.paramsByKey.set(key, encoded);
      if (stripeState.mode === "reject-second") {
        stripeState.creates += 1;
        const n = stripeState.creates;
        await new Promise((resolve) => setTimeout(resolve, 15));
        if (n > 1) {
          const err = new Error("idempotency_error");
          err.name = "StripeIdempotencyError";
          throw err;
        }
        return { id: "tr_first", metadata, reversed: false, amount };
      }
      const pending = stripeState.inflight.get(key);
      if (pending) return pending;
      const next = (async () => {
        stripeState.creates += 1;
        await new Promise((resolve) => setTimeout(resolve, 15));
        return {
          id: `tr_${stripeState.creates}`,
          metadata,
          reversed: false,
          amount,
        };
      })();
      stripeState.inflight.set(key, next);
      return next;
    }),
    list: vi.fn(async () => ({ data: stripeState.listed })),
  },
  paymentIntents: {
    retrieve: vi.fn(async () => ({ id: "pi_1", latest_charge: "ch_1" })),
  },
}));

vi.mock("@/lib/stripe/server", () => ({ stripe }));
vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: { from: (table: string) => builder(table) },
}));
vi.mock("@/lib/email/send", () => ({ sendEmail: vi.fn(async () => ({ ok: true, id: "em_1" })) }));
vi.mock("@/lib/auth/auth-email", () => ({ getAuthEmail: vi.fn(async () => "owner@example.com") }));

import { releaseHeldPayoutsForShow, sweepHeldPayouts } from "./release";
import { transferPayoutForPayment } from "./transfer";

const SHOW = "show-1";
const OTHER_SHOW = "show-2";
const PROFILE = "sp-1";
const OTHER_PROFILE = "sp-2";
const USER = "user-1";
const DEAL = "deal-1";
const PAY = "pay-1";

function reset() {
  for (const key of Object.keys(db)) delete db[key];
  stripeState.mode = "idempotent";
  stripeState.creates = 0;
  stripeState.listed = [];
  stripeState.inflight = new Map();
  stripeState.paramsByKey = new Map();
  stripe.transfers.create.mockClear();
  stripe.transfers.list.mockClear();
  stripe.paymentIntents.retrieve.mockClear();
}

function seedHeld(overrides: { status?: string; proofProfile?: string; showId?: string } = {}) {
  const showId = overrides.showId ?? SHOW;
  db.payments = [
    {
      id: PAY,
      deal_id: DEAL,
      io_line_item_id: "line-1",
      stripe_payment_intent_id: "pi_1",
      amount_charged_cents: 27500,
      application_fee_amount_cents: 2500,
      gross_amount_cents: 25000,
      settled_at: "2026-04-01T00:00:00.000Z",
      status: overrides.status ?? "succeeded",
    },
  ];
  db.deals = [{ id: DEAL, show_id: showId, show_profile_id: PROFILE }];
  db.show_ownership_proofs = [
    {
      id: "proof-1",
      show_id: showId,
      show_profile_id: overrides.proofProfile ?? PROFILE,
      status: "verified",
    },
  ];
  db.show_profiles = [{ id: PROFILE, user_id: USER }];
  db.profiles = [{ id: USER, stripe_connect_account_id: "acct_show" }];
  db.shows = [{ id: showId, name: "Odd Lots" }];
  db.payouts = [
    {
      id: "po-1",
      payment_id: PAY,
      stripe_transfer_id: null,
      amount_cents: 25000,
      early_payout_fee_cents: 0,
      transferred_at: null,
      created_at: "2026-04-02T00:00:00.000Z",
    },
  ];
}

beforeEach(() => {
  reset();
});

describe("releaseHeldPayoutsForShow", () => {
  it("releases a verified owner's held payout once, with source_transaction and the v2 key", async () => {
    seedHeld();
    const first = await releaseHeldPayoutsForShow(SHOW);
    expect(first).toEqual({ released: 1, held: 0, failed: 0 });
    expect(stripe.transfers.create).toHaveBeenCalledTimes(1);
    const [params, opts] = stripe.transfers.create.mock.calls[0];
    expect(params).toMatchObject({
      amount: 25000,
      currency: "usd",
      destination: "acct_show",
      source_transaction: "ch_1",
      transfer_group: DEAL,
    });
    expect(opts).toMatchObject({ idempotencyKey: `transfer:v2:${PAY}` });
    expect(db.payouts[0].stripe_transfer_id).toBe("tr_1");
    const released = (db.domain_events ?? []).filter((row) => row.event_type === "payout.released");
    expect(released).toHaveLength(1);

    const again = await releaseHeldPayoutsForShow(SHOW);
    expect(again).toEqual({ released: 0, held: 0, failed: 0 });
    expect(stripe.transfers.create).toHaveBeenCalledTimes(1);
    const direct = await transferPayoutForPayment(PAY);
    expect(direct?.stripeTransferId).toBe("tr_1");
    expect(stripe.transfers.create).toHaveBeenCalledTimes(1);
  });

  it("uses the same create params for a held release as a fresh payout", async () => {
    seedHeld();
    db.payouts = [];
    await transferPayoutForPayment(PAY);
    const fresh = stripe.transfers.create.mock.calls[0][0] as Record<string, unknown>;
    db.payouts = [
      {
        id: "po-held",
        payment_id: PAY,
        stripe_transfer_id: null,
        amount_cents: 25000,
        early_payout_fee_cents: 0,
        transferred_at: null,
        created_at: "2026-04-02T00:00:00.000Z",
        updated_at: "2026-04-02T00:00:00.000Z",
      },
    ];
    stripe.transfers.create.mockClear();
    stripeState.inflight = new Map();
    stripeState.creates = 0;
    await releaseHeldPayoutsForShow(SHOW);
    const released = stripe.transfers.create.mock.calls[0][0] as Record<string, unknown>;
    const shape = (params: Record<string, unknown>) => {
      const meta = params.metadata as Record<string, unknown>;
      return {
        amount: params.amount,
        currency: params.currency,
        destination: params.destination,
        source_transaction: params.source_transaction,
        transfer_group: params.transfer_group,
        metadata: {
          payment_id: meta.payment_id,
          io_line_item_id: meta.io_line_item_id,
          deal_id: meta.deal_id,
        },
      };
    };
    expect(shape(released)).toEqual(shape(fresh));
    expect(db.payouts[0].stripe_transfer_id).toBeTruthy();
  });

  it("rejects a repeated idempotency key when the params differ", async () => {
    await stripe.transfers.create(
      { amount: 25000, currency: "usd", metadata: { payment_id: PAY } },
      { idempotencyKey: `transfer:v2:${PAY}` }
    );
    await expect(
      stripe.transfers.create(
        { amount: 1, currency: "usd", metadata: { payment_id: PAY } },
        { idempotencyKey: `transfer:v2:${PAY}` }
      )
    ).rejects.toThrow("idempotency_error");
  });

  it("collapses two parallel releases to one transfer", async () => {
    seedHeld();
    const [a, b] = await Promise.all([releaseHeldPayoutsForShow(SHOW), releaseHeldPayoutsForShow(SHOW)]);
    expect(a.failed + b.failed).toBe(0);
    expect(a.released + b.released).toBeGreaterThan(0);
    expect(stripeState.creates).toBe(1);
    expect(new Set(stripeState.inflight.keys())).toEqual(new Set([`transfer:v2:${PAY}`]));
    expect(db.payouts[0].stripe_transfer_id).toBe("tr_1");
    expect((db.domain_events ?? []).filter((row) => row.event_type === "payout.released")).toHaveLength(1);
  });

  it("keeps the first transfer when the second create rejects", async () => {
    seedHeld();
    stripeState.mode = "reject-second";
    const [a, b] = await Promise.all([releaseHeldPayoutsForShow(SHOW), releaseHeldPayoutsForShow(SHOW)]);
    expect(a.released + b.released).toBe(1);
    expect(a.failed + b.failed).toBe(1);
    expect(db.payouts[0].stripe_transfer_id).toBe("tr_first");
    const after = await releaseHeldPayoutsForShow(SHOW);
    expect(after).toEqual({ released: 0, held: 0, failed: 0 });
    expect(db.payouts[0].stripe_transfer_id).toBe("tr_first");
  });

  it("adopts a listed transfer and does not create", async () => {
    seedHeld();
    stripeState.listed = [
      { id: "tr_early", metadata: { payment_id: PAY, early_payout: "true" }, reversed: false },
      { id: "tr_adopt", metadata: { payment_id: PAY }, reversed: false },
    ];
    const counts = await releaseHeldPayoutsForShow(SHOW);
    expect(counts).toEqual({ released: 1, held: 0, failed: 0 });
    expect(stripe.transfers.create).not.toHaveBeenCalled();
    expect(db.payouts[0].stripe_transfer_id).toBe("tr_adopt");
  });

  it("leaves a disputed held row in place", async () => {
    seedHeld({ status: "disputed" });
    const before = JSON.stringify(db.payouts[0]);
    const counts = await releaseHeldPayoutsForShow(SHOW);
    expect(counts).toEqual({ released: 0, held: 1, failed: 0 });
    expect(stripe.transfers.create).not.toHaveBeenCalled();
    expect(JSON.stringify(db.payouts[0])).toBe(before);
  });

  it("does not release a proof for a different profile", async () => {
    seedHeld({ proofProfile: OTHER_PROFILE });
    const before = JSON.stringify(db.payouts);
    const counts = await releaseHeldPayoutsForShow(SHOW);
    expect(counts).toEqual({ released: 0, held: 0, failed: 0 });
    expect(JSON.stringify(db.payouts)).toBe(before);
    expect(stripe.transfers.create).not.toHaveBeenCalled();
  });
});

describe("sweepHeldPayouts", () => {
  it("leaves an unverified owner held and bumps updated_at", async () => {
    seedHeld();
    db.show_ownership_proofs = [];
    db.payouts[0].updated_at = "2020-01-01T00:00:00.000Z";
    const counts = await sweepHeldPayouts();
    expect(counts).toEqual({ released: 0, held: 1, failed: 0 });
    expect(db.payouts[0].stripe_transfer_id).toBeNull();
    expect(db.payouts[0].amount_cents).toBe(25000);
    expect(String(db.payouts[0].updated_at) > "2020-01-01T00:00:00.000Z").toBe(true);
    expect(stripe.transfers.create).not.toHaveBeenCalled();
    expect(stripe.paymentIntents.retrieve).not.toHaveBeenCalled();
  });

  it("skips failed and disputed payments", async () => {
    seedHeld({ status: "failed" });
    db.payouts[0].updated_at = "2019-01-01T00:00:00.000Z";
    const before = JSON.stringify(db.payouts[0]);
    db.payments.push({
      id: "pay-disputed",
      deal_id: DEAL,
      io_line_item_id: "line-d",
      stripe_payment_intent_id: "pi_d",
      amount_charged_cents: 11000,
      application_fee_amount_cents: 1000,
      gross_amount_cents: 10000,
      settled_at: "2026-04-01T00:00:00.000Z",
      status: "disputed",
    });
    db.payouts.push({
      id: "po-disputed",
      payment_id: "pay-disputed",
      stripe_transfer_id: null,
      amount_cents: 10000,
      early_payout_fee_cents: 0,
      transferred_at: null,
      updated_at: "2019-06-01T00:00:00.000Z",
    });
    const counts = await sweepHeldPayouts();
    expect(counts).toEqual({ released: 0, held: 0, failed: 0 });
    expect(JSON.stringify(db.payouts[0])).toBe(before);
    expect(db.payouts[1].stripe_transfer_id).toBeNull();
    expect(stripe.transfers.create).not.toHaveBeenCalled();
  });

  it("releases the oldest 100 held rows and leaves the rest", async () => {
    db.show_ownership_proofs = [{ id: "proof-1", show_id: SHOW, show_profile_id: PROFILE, status: "verified" }];
    db.show_profiles = [{ id: PROFILE, user_id: USER }];
    db.profiles = [{ id: USER, stripe_connect_account_id: "acct_show" }];
    db.shows = [{ id: SHOW, name: "Odd Lots" }];
    db.deals = [];
    db.payments = [];
    db.payouts = [];
    for (let index = 0; index < 101; index += 1) {
      const dealId = `deal-${index}`;
      const paymentId = `pay-${index}`;
      db.deals.push({ id: dealId, show_id: SHOW, show_profile_id: PROFILE });
      db.payments.push({
        id: paymentId,
        deal_id: dealId,
        io_line_item_id: `line-${index}`,
        stripe_payment_intent_id: `pi_${index}`,
        amount_charged_cents: 11000,
        application_fee_amount_cents: 1000,
        gross_amount_cents: 10000,
        settled_at: "2026-04-01T00:00:00.000Z",
        status: "succeeded",
      });
      db.payouts.push({
        id: `po-${index}`,
        payment_id: paymentId,
        stripe_transfer_id: null,
        amount_cents: 10000,
        early_payout_fee_cents: 0,
        transferred_at: null,
        created_at: new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString(),
        updated_at: new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString(),
      });
    }
    db.payments.push({
      id: "pay-failed",
      deal_id: "deal-failed",
      io_line_item_id: "line-failed",
      stripe_payment_intent_id: "pi_failed",
      amount_charged_cents: 11000,
      application_fee_amount_cents: 1000,
      gross_amount_cents: 10000,
      settled_at: "2026-04-01T00:00:00.000Z",
      status: "failed",
    });
    db.deals.push({ id: "deal-failed", show_id: SHOW, show_profile_id: PROFILE });
    db.payouts.push({
      id: "po-failed",
      payment_id: "pay-failed",
      stripe_transfer_id: null,
      amount_cents: 10000,
      early_payout_fee_cents: 0,
      transferred_at: null,
      updated_at: "2019-01-01T00:00:00.000Z",
    });
    const counts = await sweepHeldPayouts();
    expect(counts.released).toBe(100);
    expect(counts.failed).toBe(0);
    const stillHeld = db.payouts.filter((row) => row.stripe_transfer_id == null);
    expect(stillHeld.map((row) => row.payment_id).sort()).toEqual(["pay-100", "pay-failed"]);
    expect(db.payouts.find((row) => row.payment_id === "pay-failed")?.updated_at).toBe("2019-01-01T00:00:00.000Z");
    expect(stripe.transfers.create).toHaveBeenCalledTimes(100);
  });

  it("does not release another show", async () => {
    seedHeld({ showId: OTHER_SHOW });
    const counts = await releaseHeldPayoutsForShow(SHOW);
    expect(counts).toEqual({ released: 0, held: 0, failed: 0 });
    expect(db.payouts[0].stripe_transfer_id).toBeNull();
  });
});
