import { describe, it, expect, vi, beforeEach } from "vitest";

const { getAuthenticatedUser, chargeForEpisode, supabaseAdmin, builders } = vi.hoisted(() => {
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
});
