import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  getAuthenticatedUser,
  transferEarlyPayoutForPayment,
  supabaseAdmin,
  rows,
} = vi.hoisted(() => {
  const rows: {
    payment?: unknown;
    deal?: unknown;
    show_profile?: unknown;
  } = {};
  function builderFor(table: string) {
    return {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data:
          table === "payments"
            ? rows.payment ?? null
            : table === "deals"
              ? rows.deal ?? null
              : table === "show_profiles"
                ? rows.show_profile ?? null
                : null,
        error: null,
      }),
    };
  }
  return {
    getAuthenticatedUser: vi.fn(),
    transferEarlyPayoutForPayment: vi.fn(),
    supabaseAdmin: {
      from: vi.fn((table: string) => builderFor(table)),
    },
    rows,
  };
});

vi.mock("@/lib/data/queries", () => ({
  getAuthenticatedUser: (...a: unknown[]) => getAuthenticatedUser(...a),
}));
vi.mock("@/lib/supabase/admin", () => ({ supabaseAdmin }));
vi.mock("@/lib/payouts/transfer", () => ({
  transferEarlyPayoutForPayment: (...a: unknown[]) =>
    transferEarlyPayoutForPayment(...a),
}));

import { POST } from "./route";
import { EARLY_PAYOUT_FEE_PERCENTAGE } from "@/lib/payouts/constants";

function makeReq(body: object): Request {
  return new Request("http://x/api/payouts/early", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  rows.payment = undefined;
  rows.deal = undefined;
  rows.show_profile = undefined;
});

describe("POST /api/payouts/early", () => {
  it("rejects unauthenticated callers", async () => {
    getAuthenticatedUser.mockResolvedValueOnce(null);
    const res = await POST(makeReq({ paymentId: "pay_1" }) as never);
    expect(res.status).toBe(401);
  });

  it("requires paymentId in body", async () => {
    getAuthenticatedUser.mockResolvedValueOnce({ id: "u1", email: "show@x.com" });
    const res = await POST(makeReq({}) as never);
    expect(res.status).toBe(400);
  });

  it("returns 404 when payment is missing", async () => {
    getAuthenticatedUser.mockResolvedValueOnce({ id: "u1", email: "show@x.com" });
    rows.payment = null;
    const res = await POST(makeReq({ paymentId: "pay_404" }) as never);
    expect(res.status).toBe(404);
  });

  it("forbids show users that don't own the receiving account", async () => {
    getAuthenticatedUser.mockResolvedValueOnce({ id: "u_other", email: "other@x.com" });
    rows.payment = { id: "pay_1", deal_id: "deal_1" };
    rows.deal = { id: "deal_1", show_profile_id: "sp_1" };
    rows.show_profile = { id: "sp_1", user_id: "u_owner" };

    const res = await POST(makeReq({ paymentId: "pay_1" }) as never);
    expect(res.status).toBe(403);
    expect(transferEarlyPayoutForPayment).not.toHaveBeenCalled();
  });

  it("happy path: invokes transferEarlyPayoutForPayment with the locked fee constant", async () => {
    getAuthenticatedUser.mockResolvedValueOnce({ id: "u_owner", email: "show@x.com" });
    rows.payment = { id: "pay_1", deal_id: "deal_1" };
    rows.deal = { id: "deal_1", show_profile_id: "sp_1" };
    rows.show_profile = { id: "sp_1", user_id: "u_owner" };
    transferEarlyPayoutForPayment.mockResolvedValueOnce({
      payoutId: "po_e1",
      stripeTransferId: "tr_early",
      amountCents: 21937,
    });

    const res = await POST(makeReq({ paymentId: "pay_1" }) as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.amountCents).toBe(21937);
    expect(transferEarlyPayoutForPayment).toHaveBeenCalledWith(
      "pay_1",
      EARLY_PAYOUT_FEE_PERCENTAGE
    );
  });
});
