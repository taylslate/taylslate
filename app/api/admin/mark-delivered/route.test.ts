import { describe, it, expect, vi, beforeEach } from "vitest";

const { getAuthenticatedUser, chargeForEpisode, logEvent, supabaseAdmin, builders } = vi.hoisted(() => {
  const builders: Record<string, ReturnType<typeof makeBuilder>> = {};
  function makeBuilder() {
    const b: Record<string, unknown> = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
      single: vi.fn(),
    };
    return b;
  }
  return {
    getAuthenticatedUser: vi.fn(),
    chargeForEpisode: vi.fn(),
    logEvent: vi.fn().mockResolvedValue(null),
    supabaseAdmin: {
      from: vi.fn((table: string) => {
        if (!builders[table]) builders[table] = makeBuilder();
        return builders[table];
      }),
    },
    builders,
  };
});

vi.mock("@/lib/data/queries", () => ({
  getAuthenticatedUser: (...a: unknown[]) => getAuthenticatedUser(...a),
}));
vi.mock("@/lib/supabase/admin", () => ({ supabaseAdmin }));
vi.mock("@/lib/stripe/payment-intent", () => ({
  chargeForEpisode: (...a: unknown[]) => chargeForEpisode(...a),
}));
vi.mock("@/lib/data/events", () => ({
  logEvent: (...a: unknown[]) => logEvent(...a),
}));

import { POST } from "./route";

function makeReq(body: object): Request {
  return new Request("http://x/api/admin/mark-delivered", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  for (const k of Object.keys(builders)) delete builders[k];
  process.env.INTERNAL_ADMIN_EMAILS = "ops@taylslate.com,ops2@taylslate.com";
});

describe("POST /api/admin/mark-delivered", () => {
  it("rejects unauthenticated callers", async () => {
    getAuthenticatedUser.mockResolvedValueOnce(null);
    const res = await POST(makeReq({ ioLineItemId: "li_1" }) as never);
    expect(res.status).toBe(401);
  });

  it("forbids users not on the INTERNAL_ADMIN_EMAILS allowlist", async () => {
    getAuthenticatedUser.mockResolvedValueOnce({
      id: "u1",
      email: "random@notallowed.com",
    });
    const res = await POST(makeReq({ ioLineItemId: "li_1" }) as never);
    expect(res.status).toBe(403);
    expect(chargeForEpisode).not.toHaveBeenCalled();
  });

  it("rejects missing ioLineItemId", async () => {
    getAuthenticatedUser.mockResolvedValueOnce({
      id: "u1",
      email: "ops@taylslate.com",
    });
    const res = await POST(makeReq({}) as never);
    expect(res.status).toBe(400);
  });

  it("happy path: marks delivered + triggers charge", async () => {
    getAuthenticatedUser.mockResolvedValueOnce({
      id: "u1",
      email: "ops@taylslate.com",
    });

    // First from("io_line_items").select().eq().single() — returns the line item.
    const liBuilder = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
      single: vi
        .fn()
        .mockResolvedValueOnce({
          data: {
            id: "li_1",
            io_id: "io_1",
            verified: false,
            actual_post_date: null,
            actual_downloads: null,
          },
          error: null,
        }),
    };
    // The update path needs eq() to terminate without .single() — Supabase
    // returns { error: null } promise-like. We just ensure no throw.
    // We track the second `from("io_line_items")` invocation for the
    // update-by-id; each from() call returns a fresh builder in the
    // hoisted mock, so we'll let that path return null/undefined.

    // io_line_items first call returns the row, second call (update) just resolves OK.
    const ioBuilder = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValueOnce({
        data: { id: "io_1", deal_id: "deal_1" },
        error: null,
      }),
    };

    // The route calls supabaseAdmin.from twice for io_line_items (select then
    // update) and once for insertion_orders. Override the global mock for
    // this test only.
    let ioLineItemsCalls = 0;
    supabaseAdmin.from.mockImplementation((table: string) => {
      if (table === "io_line_items") {
        ioLineItemsCalls += 1;
        if (ioLineItemsCalls === 1) return liBuilder;
        // 2nd call: the update — must return a promise-like that
        // resolves with { error: null } when awaited via .eq().
        return {
          update: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ error: null }),
          }),
        };
      }
      if (table === "insertion_orders") return ioBuilder;
      throw new Error(`unexpected from(${table})`);
    });

    chargeForEpisode.mockResolvedValueOnce({
      paymentId: "pay_x",
      stripePaymentIntentId: "pi_x",
      amountChargedCents: 25000,
      applicationFeeAmountCents: 2500,
      platformFeePercentageAtCharge: 0.10,
      status: "succeeded",
    });

    const res = await POST(
      makeReq({ ioLineItemId: "li_1", actualDownloads: 12000 }) as never
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.charge.paymentId).toBe("pay_x");
    expect(chargeForEpisode).toHaveBeenCalledWith({
      dealId: "deal_1",
      ioLineItemId: "li_1",
    });
  });

  // Shared staging for the charge-failure tests: prior snapshot has
  // real values so the rollback assertion proves exact restoration,
  // not just blanket false/null.
  function stageChargeFailure(opts: { rollbackFails?: boolean } = {}) {
    getAuthenticatedUser.mockResolvedValueOnce({
      id: "u1",
      email: "ops@taylslate.com",
    });

    const liBuilder = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValueOnce({
        data: {
          id: "li_1",
          io_id: "io_1",
          verified: false,
          actual_post_date: "2026-09-01",
          actual_downloads: 5000,
        },
        error: null,
      }),
    };
    const ioBuilder = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValueOnce({
        data: { id: "io_1", deal_id: "deal_1" },
        error: null,
      }),
    };

    // from("io_line_items") call order: 1 = snapshot select,
    // 2 = forward update, 3 = rollback update.
    const updateCalls: unknown[] = [];
    let ioLineItemsCalls = 0;
    supabaseAdmin.from.mockImplementation((table: string) => {
      if (table === "io_line_items") {
        ioLineItemsCalls += 1;
        if (ioLineItemsCalls === 1) return liBuilder;
        const isRollback = ioLineItemsCalls === 3;
        return {
          update: vi.fn((payload: unknown) => {
            updateCalls.push(payload);
            return {
              eq: vi.fn().mockResolvedValue({
                error:
                  isRollback && opts.rollbackFails
                    ? { message: "db down" }
                    : null,
              }),
            };
          }),
        };
      }
      if (table === "insertion_orders") return ioBuilder;
      throw new Error(`unexpected from(${table})`);
    });

    chargeForEpisode.mockRejectedValueOnce(
      new Error("Brand profile p1 has no stripe_customer_id")
    );

    return { updateCalls };
  }

  it("rolls back the delivery write and returns ok:false when the charge fails", async () => {
    const { updateCalls } = stageChargeFailure();

    const res = await POST(
      makeReq({
        ioLineItemId: "li_1",
        actualPostDate: "2026-09-14",
        actualDownloads: 12000,
      }) as never
    );

    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.charge).toBeNull();
    expect(body.chargeError).toMatch(/no stripe_customer_id/);
    expect(body.rolledBack).toBe(true);

    // Forward write, then exact restoration of the prior snapshot.
    expect(updateCalls).toHaveLength(2);
    expect(updateCalls[0]).toMatchObject({
      verified: true,
      actual_post_date: "2026-09-14",
      actual_downloads: 12000,
    });
    expect(updateCalls[1]).toEqual({
      verified: false,
      actual_post_date: "2026-09-01",
      actual_downloads: 5000,
    });

    // Both state transitions audited.
    expect(logEvent).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: "io_line_item.delivered" })
    );
    expect(logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "io_line_item.delivery_rolled_back",
        payload: expect.objectContaining({ rolled_back: true }),
      })
    );
  });

  it("surfaces rollbackError when the rollback write also fails", async () => {
    stageChargeFailure({ rollbackFails: true });

    const res = await POST(makeReq({ ioLineItemId: "li_1" }) as never);

    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.rolledBack).toBe(false);
    expect(body.rollbackError).toBe("db down");
  });
});
