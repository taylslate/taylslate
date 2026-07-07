import { describe, it, expect, vi, beforeEach } from "vitest";
import { TEST_ACCOUNTS } from "@/lib/admin/test-accounts";

const BRAND = TEST_ACCOUNTS.find((a) => a.key === "brand1")!;
const SHOW = TEST_ACCOUNTS.find((a) => a.key === "show1")!;

// The mock routes by table. POST awaits the `maybeSingle`/`single` terminals
// (order-queued via primeServiceRole, unchanged from Layer 1). DELETE awaits the
// builder itself — it is a thenable that resolves through `resolver(state)`,
// where state carries { table, op, filters } so a test can return different data
// per table / per operation (select vs delete). The chain method spies are
// shared across builders so POST-path assertions (adminBuilder.insert, the
// maybeSingle/single queues) keep working verbatim.
type QueryState = { table: string; op: "select" | "delete"; filters: Record<string, unknown> };
type QueryResult = { data: unknown; error: unknown };

const { adminBuilder, supabaseAdmin, setResolver } = vi.hoisted(() => {
  let resolver: (state: QueryState) => QueryResult = () => ({ data: [], error: null });

  const select = vi.fn();
  const eq = vi.fn();
  const insert = vi.fn();
  const like = vi.fn();
  const inFn = vi.fn();
  const del = vi.fn();
  const maybeSingle = vi.fn();
  const single = vi.fn();

  function makeBuilder(table: string) {
    const state: QueryState = { table, op: "select", filters: {} };
    const b: Record<string, unknown> = {
      select: (...a: unknown[]) => (select(...a), b),
      eq: (...a: unknown[]) => (eq(...a), b),
      insert: (...a: unknown[]) => (insert(...a), b),
      like: (...a: unknown[]) => ((state.filters.like = a), like(...a), b),
      in: (...a: unknown[]) => ((state.filters.in = a), inFn(...a), b),
      delete: (...a: unknown[]) => ((state.op = "delete"), del(...a), b),
      maybeSingle: (...a: unknown[]) => maybeSingle(...a),
      single: (...a: unknown[]) => single(...a),
      then: (res: (v: QueryResult) => unknown, rej: (e: unknown) => unknown) =>
        Promise.resolve(resolver(state)).then(res, rej),
    };
    return b;
  }

  const adminBuilder = { select, eq, insert, like, in: inFn, delete: del, maybeSingle, single };
  const supabaseAdmin = { from: vi.fn((t: string) => makeBuilder(t)) };
  return { adminBuilder, supabaseAdmin, setResolver: (fn: (s: QueryState) => QueryResult) => { resolver = fn; } };
});

// Build a table-routed resolver for a DELETE scenario. `deletions` records the
// order deletes fire (verifies the cascade order). Deals empty out after the
// outreach delete cascades them, unless `dealsSurviveCascade` (the anomaly case).
function makeResolver(cfg: {
  events?: Array<{ payload: Record<string, unknown> }>;
  shows?: Array<{ id: string }>;
  campaigns?: Array<{ id: string }>;
  outreaches?: Array<{ id: string }>;
  deals?: Array<{ id: string }>;
  ios?: Array<{ id: string }>;
  ioLineItems?: Array<{ id: string; io_id?: string }>;
  payments?: Array<{ id: string; deal_id?: string; io_line_item_id?: string }>;
  invoices?: Array<{ id: string; io_id?: string }>;
  invoiceLineItems?: Array<{ id: string; io_line_item_id?: string }>;
  dealsSurviveCascade?: boolean;
  errors?: Record<string, unknown>;
}) {
  const {
    events = [], shows = [], campaigns = [], outreaches = [],
    deals = [], ios = [], ioLineItems = [], payments = [], invoices = [],
    invoiceLineItems = [], dealsSurviveCascade = false, errors = {},
  } = cfg;
  const deletions: string[] = [];
  let cascaded = false;
  const resolver = ({ table, op }: QueryState): QueryResult => {
    const err = errors[`${table}:${op}`];
    if (err) return { data: null, error: err };
    if (op === "delete") {
      deletions.push(table);
      if (table === "outreaches") { cascaded = true; return { data: outreaches, error: null }; }
      if (table === "shows") return { data: shows, error: null };
      if (table === "campaigns") return { data: campaigns, error: null };
      return { data: [], error: null };
    }
    switch (table) {
      case "domain_events": return { data: events, error: null };
      case "shows": return { data: shows, error: null };
      case "campaigns": return { data: campaigns, error: null };
      case "outreaches": return { data: outreaches, error: null };
      case "deals": return { data: cascaded && !dealsSurviveCascade ? [] : deals, error: null };
      case "insertion_orders": return { data: ios, error: null };
      case "io_line_items": return { data: ioLineItems, error: null };
      case "payments": return { data: payments, error: null };
      case "invoices": return { data: invoices, error: null };
      case "invoice_line_items": return { data: invoiceLineItems, error: null };
      default: return { data: [], error: null };
    }
  };
  return { resolver, deletions };
}

const getAuthenticatedUser = vi.fn();
const createShow = vi.fn();
const createOutreach = vi.fn();
const createWave12Deal = vi.fn();
const getWave12DealById = vi.fn();
const isInternalAdmin = vi.fn();
const logEvent = vi.fn().mockResolvedValue(null);

vi.mock("@/lib/supabase/admin", () => ({ supabaseAdmin }));
vi.mock("@/lib/data/queries", () => ({
  getAuthenticatedUser: (...a: unknown[]) => getAuthenticatedUser(...a),
  createShow: (...a: unknown[]) => createShow(...a),
  createOutreach: (...a: unknown[]) => createOutreach(...a),
  createWave12Deal: (...a: unknown[]) => createWave12Deal(...a),
  getWave12DealById: (...a: unknown[]) => getWave12DealById(...a),
}));
vi.mock("@/lib/auth/admin", () => ({
  isInternalAdmin: (...a: unknown[]) => isInternalAdmin(...a),
}));
vi.mock("@/lib/data/events", () => ({ logEvent: (...a: unknown[]) => logEvent(...a) }));

import { POST, DELETE } from "./route";

function req(): Request {
  return new Request("http://x/api/admin/seed-deal", { method: "POST" });
}

// Queue one seed call's worth of service-role responses:
//   brand_profiles.maybeSingle -> show_profiles.maybeSingle -> campaigns.single
function primeServiceRole(brandWebsite: string | null = "https://morelessprotein.com/") {
  adminBuilder.maybeSingle
    .mockResolvedValueOnce({ data: { id: "bp1", brand_website: brandWebsite }, error: null })
    .mockResolvedValueOnce({ data: { id: "sp1" }, error: null });
  adminBuilder.single.mockResolvedValueOnce({ data: { id: "camp-1" }, error: null });
}

beforeEach(() => {
  vi.clearAllMocks();
  setResolver(() => ({ data: [], error: null }));
  getAuthenticatedUser.mockResolvedValue({ id: "u-admin", email: "chris@taylslate.com" });
  isInternalAdmin.mockReturnValue(true);
  createShow.mockResolvedValue({ id: "show-1", name: "[SEED] The Test Feed" });
  createOutreach.mockResolvedValue({ id: "outreach-1", name: "[SEED] out" });
  createWave12Deal.mockResolvedValue({
    id: "deal-1",
    status: "planning",
    agreed_cpm: 25,
    brand_profile_id: "bp1",
    show_profile_id: "sp1",
    outreach_id: "outreach-1",
  });
  getWave12DealById.mockResolvedValue({ id: "deal-1", agreed_cpm: 25, status: "planning" });
  primeServiceRole();
});

describe("POST /api/admin/seed-deal", () => {
  it("rejects unauthenticated (401)", async () => {
    getAuthenticatedUser.mockResolvedValueOnce(null);
    const res = await POST(req() as never);
    expect(res.status).toBe(401);
    expect(createShow).not.toHaveBeenCalled();
  });

  it("rejects a non-admin caller (403)", async () => {
    isInternalAdmin.mockReturnValueOnce(false);
    const res = await POST(req() as never);
    expect(res.status).toBe(403);
    expect(createShow).not.toHaveBeenCalled();
  });

  it("fabricates the full chain with correct FKs", async () => {
    const res = await POST(req() as never);
    expect(res.status).toBe(200);

    // Campaign inserted via service role, owned by the test brand.
    expect(adminBuilder.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: BRAND.userId,
        name: expect.stringContaining("[SEED]"),
      })
    );
    // Outreach wired to the seeded brand_profile / campaign / show.
    expect(createOutreach).toHaveBeenCalledWith(
      expect.objectContaining({
        brand_profile_id: "bp1",
        campaign_id: "camp-1",
        show_id: "show-1",
        sent_to_email: SHOW.email,
        response_status: "accepted",
      })
    );
  });

  it("sets all five ownership columns on the deal insert", async () => {
    await POST(req() as never);
    expect(createWave12Deal).toHaveBeenCalledWith(
      expect.objectContaining({
        outreach_id: "outreach-1",
        brand_profile_id: "bp1",
        show_profile_id: "sp1",
        brand_id: BRAND.userId,
        show_id: "show-1",
      })
    );
  });

  it("creates the deal through the planning-only createWave12Deal path with non-null agreed_cpm", async () => {
    const res = await POST(req() as never);
    expect(res.status).toBe(200);
    expect(createWave12Deal).toHaveBeenCalledWith(
      expect.objectContaining({ agreed_cpm: 25 })
    );
    // status "planning" is an invariant enforced inside createWave12Deal.
    expect(createWave12Deal).toHaveBeenCalledTimes(1);
  });

  it("fails loudly (500) if the created deal has a null agreed_cpm", async () => {
    getWave12DealById.mockResolvedValueOnce({ id: "deal-1", agreed_cpm: null });
    const res = await POST(req() as never);
    expect(res.status).toBe(500);
    // The guard runs after the deal insert but before the marker event.
    expect(logEvent).not.toHaveBeenCalled();
  });

  it("fires the deal.seeded marker event with all seeded entity ids", async () => {
    const res = await POST(req() as never);
    expect(res.status).toBe(200);
    expect(logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "deal.seeded",
        entityType: "deal",
        entityId: "deal-1",
        actorId: "u-admin",
        payload: expect.objectContaining({
          seeded: true,
          showId: "show-1",
          campaignId: "camp-1",
          outreachId: "outreach-1",
          dealId: "deal-1",
        }),
      })
    );
  });

  it("returns dealUrl + seededEntityIds and no warning when brand_website is set", async () => {
    const res = await POST(req() as never);
    const body = await res.json();
    expect(body.dealId).toBe("deal-1");
    expect(body.dealUrl).toBe("http://x/deals/deal-1");
    expect(body.seededEntityIds).toEqual({
      show: "show-1",
      campaign: "camp-1",
      outreach: "outreach-1",
      deal: "deal-1",
    });
    expect(body.warnings).toEqual([]);
  });

  it("surfaces a warning when the test brand's brand_website is blank", async () => {
    adminBuilder.maybeSingle.mockReset();
    primeServiceRole(null);
    const res = await POST(req() as never);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.warnings).toHaveLength(1);
    expect(body.warnings[0]).toContain("brand_website");
  });

  it("second call creates a fully independent seed (distinct outreach token + show name)", async () => {
    await POST(req() as never);
    // Queue a second call's worth of service-role responses.
    primeServiceRole();
    await POST(req() as never);

    expect(createShow).toHaveBeenCalledTimes(2);
    expect(createOutreach).toHaveBeenCalledTimes(2);
    expect(createWave12Deal).toHaveBeenCalledTimes(2);

    const token1 = createOutreach.mock.calls[0][0].token;
    const token2 = createOutreach.mock.calls[1][0].token;
    expect(token1).not.toEqual(token2);

    const name1 = createShow.mock.calls[0][0].name;
    const name2 = createShow.mock.calls[1][0].name;
    expect(name1).not.toEqual(name2);
  });
});

// All `.in("id", [...])` filter values across the run — the delete-scoping ids.
// The union of these is the ONLY set of rows teardown can remove.
function scopedDeleteIds(): unknown[] {
  return adminBuilder.in.mock.calls
    .filter(([col]) => col === "id")
    .flatMap(([, ids]) => ids as unknown[]);
}

describe("DELETE /api/admin/seed-deal", () => {
  it("rejects unauthenticated (401)", async () => {
    getAuthenticatedUser.mockResolvedValueOnce(null);
    const res = await DELETE();
    expect(res.status).toBe(401);
    expect(adminBuilder.delete).not.toHaveBeenCalled();
    expect(logEvent).not.toHaveBeenCalled();
  });

  it("rejects a non-admin caller (403)", async () => {
    isInternalAdmin.mockReturnValueOnce(false);
    const res = await DELETE();
    expect(res.status).toBe(403);
    expect(adminBuilder.delete).not.toHaveBeenCalled();
    expect(logEvent).not.toHaveBeenCalled();
  });

  it("empty state: nothing discovered → 200 { deleted: {} }, no delete, no event", async () => {
    // Default resolver returns empty for every table.
    const res = await DELETE();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ deleted: {} });
    expect(adminBuilder.delete).not.toHaveBeenCalled();
    expect(logEvent).not.toHaveBeenCalled();
  });

  it("tears down a full seeded chain in cascade order and fires the teardown event", async () => {
    const { resolver, deletions } = makeResolver({
      events: [
        { payload: { showId: "show-1", campaignId: "camp-1", outreachId: "outreach-1", dealId: "deal-1" } },
      ],
      shows: [{ id: "show-1" }],
      campaigns: [{ id: "camp-1" }],
      outreaches: [{ id: "outreach-1" }],
      deals: [{ id: "deal-1" }],
      ios: [{ id: "io-1" }],
      ioLineItems: [{ id: "ili-1", io_id: "io-1" }],
    });
    setResolver(resolver);

    const res = await DELETE();
    expect(res.status).toBe(200);
    const body = await res.json();

    // Outreaches first (cascades deals + IOs + line items), then shows, then campaigns.
    expect(deletions).toEqual(["outreaches", "shows", "campaigns"]);

    expect(body.deleted.outreaches).toEqual({ count: 1, ids: ["outreach-1"] });
    expect(body.deleted.deals).toEqual({ count: 1, ids: ["deal-1"] });
    expect(body.deleted.insertion_orders).toEqual({ count: 1, ids: ["io-1"] });
    expect(body.deleted.io_line_items).toEqual({ count: 1, ids: ["ili-1"] });
    expect(body.deleted.shows).toEqual({ count: 1, ids: ["show-1"] });
    expect(body.deleted.campaigns).toEqual({ count: 1, ids: ["camp-1"] });

    expect(logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "admin.seed_teardown",
        entityType: "profile",
        entityId: "u-admin",
        actorId: "u-admin",
        payload: expect.objectContaining({
          seed_teardown: true,
          outreachIds: ["outreach-1"],
          dealIds: ["deal-1"],
          insertionOrderIds: ["io-1"],
          ioLineItemIds: ["ili-1"],
          showIds: ["show-1"],
          campaignIds: ["camp-1"],
        }),
      })
    );
  });

  it("only ever deletes ids matched by seed markers — non-seed rows are never scoped", async () => {
    const { resolver } = makeResolver({
      events: [
        { payload: { showId: "show-1", campaignId: "camp-1", outreachId: "outreach-1", dealId: "deal-1" } },
      ],
      shows: [{ id: "show-1" }],
      campaigns: [{ id: "camp-1" }],
      outreaches: [{ id: "outreach-1" }],
      deals: [{ id: "deal-1" }],
      ios: [{ id: "io-1" }],
    });
    setResolver(resolver);

    await DELETE();

    // Every id fed to a delete-scoping `.in("id", …)` is a discovered seed id.
    // A non-seed row (never returned by any discovery query) can never appear.
    expect(new Set(scopedDeleteIds())).toEqual(new Set(["outreach-1", "show-1", "camp-1"]));
    expect(scopedDeleteIds()).not.toContain("non-seed-row");
  });

  it("partial seed without a deal ([SEED] prefix, no event) is discovered and cleaned", async () => {
    // No deal.seeded event; only prefix-scanned show + campaign, no outreach/deal.
    const { resolver, deletions } = makeResolver({
      events: [],
      shows: [{ id: "show-p" }],
      campaigns: [{ id: "camp-p" }],
      outreaches: [],
      deals: [],
      ios: [],
    });
    setResolver(resolver);

    const res = await DELETE();
    expect(res.status).toBe(200);
    const body = await res.json();

    // No outreach to delete → cascade order skips it.
    expect(deletions).toEqual(["shows", "campaigns"]);
    expect(body.deleted.outreaches).toEqual({ count: 0, ids: [] });
    expect(body.deleted.deals).toEqual({ count: 0, ids: [] });
    expect(body.deleted.shows).toEqual({ count: 1, ids: ["show-p"] });
    expect(body.deleted.campaigns).toEqual({ count: 1, ids: ["camp-p"] });
    expect(logEvent).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: "admin.seed_teardown" })
    );
  });

  it("partial seed WITH a deal (no event) is discovered via linkage and torn down cleanly — no 500", async () => {
    // No deal.seeded event fired. The outreach is found only because it links to
    // the [SEED] campaign/show; deleting it cascades the deal (verify sees none).
    const { resolver, deletions } = makeResolver({
      events: [],
      shows: [{ id: "show-w" }],
      campaigns: [{ id: "camp-w" }],
      outreaches: [{ id: "out-w" }],
      deals: [{ id: "deal-w" }],
      ios: [{ id: "io-w" }],
      dealsSurviveCascade: false,
    });
    setResolver(resolver);

    const res = await DELETE();
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(deletions).toEqual(["outreaches", "shows", "campaigns"]);
    expect(body.deleted.outreaches).toEqual({ count: 1, ids: ["out-w"] });
    expect(body.deleted.deals).toEqual({ count: 1, ids: ["deal-w"] });
    expect(body.deleted.insertion_orders).toEqual({ count: 1, ids: ["io-w"] });
    expect(body.deleted.shows).toEqual({ count: 1, ids: ["show-w"] });
    expect(body.deleted.campaigns).toEqual({ count: 1, ids: ["camp-w"] });
  });

  it("surviving-deal backstop: a deal outliving outreach deletion → 500, shows/campaigns untouched, not swallowed", async () => {
    const { resolver, deletions } = makeResolver({
      events: [
        { payload: { showId: "show-s", campaignId: "camp-s", outreachId: "out-s", dealId: "deal-s" } },
      ],
      shows: [{ id: "show-s" }],
      campaigns: [{ id: "camp-s" }],
      outreaches: [{ id: "out-s" }],
      deals: [{ id: "deal-s" }],
      ios: [{ id: "io-s" }],
      dealsSurviveCascade: true, // anomaly: deal still references the seeded show
    });
    setResolver(resolver);

    const res = await DELETE();
    expect(res.status).toBe(500);
    const body = await res.json();

    expect(body.survivingDeals).toEqual(["deal-s"]);
    expect(body.error).toMatch(/RESTRICT/);
    // Outreach delete happened; show/campaign deletes were NOT attempted.
    expect(deletions).toEqual(["outreaches"]);
    expect(body.deleted.outreaches).toEqual({ count: 1, ids: ["out-s"] });
    expect(logEvent).not.toHaveBeenCalled();
  });

  it("RESTRICT guard: a seeded deal with a payment row → 500 with the blocking deal, nothing deleted", async () => {
    const { resolver, deletions } = makeResolver({
      events: [
        { payload: { showId: "show-f", campaignId: "camp-f", outreachId: "out-f", dealId: "deal-f" } },
      ],
      shows: [{ id: "show-f" }],
      campaigns: [{ id: "camp-f" }],
      outreaches: [{ id: "out-f" }],
      deals: [{ id: "deal-f" }],
      ios: [{ id: "io-f" }],
      payments: [{ id: "pay-f", deal_id: "deal-f" }], // deal advanced through Stripe
    });
    setResolver(resolver);

    const res = await DELETE();
    expect(res.status).toBe(500);
    const body = await res.json();

    // Reports the actual blocking payment + its parent deal (not all seeded deals).
    expect(body.blockers).toEqual([
      { table: "payments", parentColumn: "deal_id", ids: ["pay-f"], blockedParentIds: ["deal-f"] },
    ]);
    expect(body.error).toMatch(/RESTRICT/);
    // Aborted before any destructive delete.
    expect(deletions).toEqual([]);
    expect(adminBuilder.delete).not.toHaveBeenCalled();
    expect(logEvent).not.toHaveBeenCalled();
  });

  it("RESTRICT guard: a seeded IO with an invoice row → 500 with the blocking IO, nothing deleted", async () => {
    const { resolver, deletions } = makeResolver({
      events: [
        { payload: { showId: "show-i", campaignId: "camp-i", outreachId: "out-i", dealId: "deal-i" } },
      ],
      shows: [{ id: "show-i" }],
      campaigns: [{ id: "camp-i" }],
      outreaches: [{ id: "out-i" }],
      deals: [{ id: "deal-i" }],
      ios: [{ id: "io-i" }],
      invoices: [{ id: "inv-i", io_id: "io-i" }], // IO was invoiced (invoices.io_id RESTRICT)
    });
    setResolver(resolver);

    const res = await DELETE();
    expect(res.status).toBe(500);
    const body = await res.json();

    expect(body.blockers).toEqual([
      { table: "invoices", parentColumn: "io_id", ids: ["inv-i"], blockedParentIds: ["io-i"] },
    ]);
    expect(deletions).toEqual([]);
    expect(adminBuilder.delete).not.toHaveBeenCalled();
    expect(logEvent).not.toHaveBeenCalled();
  });

  it("RESTRICT guard: a seeded IO line item with an invoice_line_item → 500 (subtree descendant), nothing deleted", async () => {
    // The cascade reaches io_line_items; invoice_line_items.io_line_item_id is
    // non-cascading and would FK-fail the delete. Guard must catch it even with
    // no payment- or invoice-level blocker present.
    const { resolver, deletions } = makeResolver({
      events: [
        { payload: { showId: "show-l", campaignId: "camp-l", outreachId: "out-l", dealId: "deal-l" } },
      ],
      shows: [{ id: "show-l" }],
      campaigns: [{ id: "camp-l" }],
      outreaches: [{ id: "out-l" }],
      deals: [{ id: "deal-l" }],
      ios: [{ id: "io-l" }],
      ioLineItems: [{ id: "ili-l", io_id: "io-l" }],
      invoiceLineItems: [{ id: "invli-l", io_line_item_id: "ili-l" }],
    });
    setResolver(resolver);

    const res = await DELETE();
    expect(res.status).toBe(500);
    const body = await res.json();

    expect(body.blockers).toEqual([
      {
        table: "invoice_line_items",
        parentColumn: "io_line_item_id",
        ids: ["invli-l"],
        blockedParentIds: ["ili-l"],
      },
    ]);
    expect(deletions).toEqual([]);
    expect(adminBuilder.delete).not.toHaveBeenCalled();
    expect(logEvent).not.toHaveBeenCalled();
  });

  it("discovery query error → 500 before any deletion (not mistaken for empty state)", async () => {
    const { resolver } = makeResolver({
      shows: [{ id: "show-e" }],
      errors: { "shows:select": { message: "connection reset" } },
    });
    setResolver(resolver);

    const res = await DELETE();
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toMatch(/before any deletion/);
    expect(adminBuilder.delete).not.toHaveBeenCalled();
    expect(logEvent).not.toHaveBeenCalled();
  });
});
