import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  getAuthenticatedUser,
  getBrandProfileByUserId,
  getWave12DealById,
  chargeForEpisode,
} = vi.hoisted(() => ({
  getAuthenticatedUser: vi.fn(),
  getBrandProfileByUserId: vi.fn(),
  getWave12DealById: vi.fn(),
  chargeForEpisode: vi.fn(),
}));

vi.mock("@/lib/data/queries", () => ({
  getAuthenticatedUser: (...a: unknown[]) => getAuthenticatedUser(...a),
  getBrandProfileByUserId: (...a: unknown[]) => getBrandProfileByUserId(...a),
  getWave12DealById: (...a: unknown[]) => getWave12DealById(...a),
}));
vi.mock("@/lib/stripe/payment-intent", () => ({
  chargeForEpisode: (...a: unknown[]) => chargeForEpisode(...a),
}));

import { POST } from "./route";

function makeReq(body: object): Request {
  return new Request("http://x/api/deals/d1/charge-episode", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const params = Promise.resolve({ id: "d1" });

beforeEach(() => {
  vi.clearAllMocks();
  process.env.INTERNAL_ADMIN_EMAILS = "ops@taylslate.com";
});

describe("POST /api/deals/[id]/charge-episode", () => {
  it("rejects unauthenticated callers", async () => {
    getAuthenticatedUser.mockResolvedValueOnce(null);
    const res = await POST(makeReq({ ioLineItemId: "li_1" }) as never, { params });
    expect(res.status).toBe(401);
  });

  it("rejects when ioLineItemId missing", async () => {
    getAuthenticatedUser.mockResolvedValueOnce({ id: "u1", email: "brand@x.com" });
    const res = await POST(makeReq({}) as never, { params });
    expect(res.status).toBe(400);
  });

  it("returns 404 when deal does not exist", async () => {
    getAuthenticatedUser.mockResolvedValueOnce({ id: "u1", email: "brand@x.com" });
    getWave12DealById.mockResolvedValueOnce(null);
    const res = await POST(
      makeReq({ ioLineItemId: "li_1" }) as never,
      { params }
    );
    expect(res.status).toBe(404);
  });

  it("forbids non-admin user not owning the deal's brand profile", async () => {
    getAuthenticatedUser.mockResolvedValueOnce({ id: "u_other", email: "other@x.com" });
    getWave12DealById.mockResolvedValueOnce({
      id: "d1",
      brand_profile_id: "bp_owner",
    });
    getBrandProfileByUserId.mockResolvedValueOnce({ id: "bp_other" });
    const res = await POST(
      makeReq({ ioLineItemId: "li_1" }) as never,
      { params }
    );
    expect(res.status).toBe(403);
    expect(chargeForEpisode).not.toHaveBeenCalled();
  });

  it("succeeds for the owning brand", async () => {
    getAuthenticatedUser.mockResolvedValueOnce({ id: "u_owner", email: "brand@x.com" });
    getWave12DealById.mockResolvedValueOnce({
      id: "d1",
      brand_profile_id: "bp_owner",
    });
    getBrandProfileByUserId.mockResolvedValueOnce({ id: "bp_owner" });
    chargeForEpisode.mockResolvedValueOnce({
      paymentId: "pay_x",
      stripePaymentIntentId: "pi_x",
      amountChargedCents: 25000,
      applicationFeeAmountCents: 2500,
      platformFeePercentageAtCharge: 0.10,
      status: "succeeded",
    });
    const res = await POST(
      makeReq({ ioLineItemId: "li_1" }) as never,
      { params }
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.paymentId).toBe("pay_x");
    expect(chargeForEpisode).toHaveBeenCalledWith({
      dealId: "d1",
      ioLineItemId: "li_1",
    });
  });

  it("allows internal admin caller without brand profile match", async () => {
    getAuthenticatedUser.mockResolvedValueOnce({ id: "u_admin", email: "ops@taylslate.com" });
    getWave12DealById.mockResolvedValueOnce({ id: "d1", brand_profile_id: "bp_owner" });
    chargeForEpisode.mockResolvedValueOnce({
      paymentId: "pay_y",
      stripePaymentIntentId: "pi_y",
      amountChargedCents: 10000,
      applicationFeeAmountCents: 1000,
      platformFeePercentageAtCharge: 0.10,
      status: "succeeded",
    });
    const res = await POST(
      makeReq({ ioLineItemId: "li_1" }) as never,
      { params }
    );
    expect(res.status).toBe(200);
    expect(getBrandProfileByUserId).not.toHaveBeenCalled();
  });

  it("returns 502 when chargeForEpisode throws", async () => {
    getAuthenticatedUser.mockResolvedValueOnce({ id: "u_owner", email: "brand@x.com" });
    getWave12DealById.mockResolvedValueOnce({ id: "d1", brand_profile_id: "bp_owner" });
    getBrandProfileByUserId.mockResolvedValueOnce({ id: "bp_owner" });
    chargeForEpisode.mockRejectedValueOnce(new Error("Stripe down"));
    const res = await POST(
      makeReq({ ioLineItemId: "li_1" }) as never,
      { params }
    );
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toMatch(/Stripe down/);
  });
});
