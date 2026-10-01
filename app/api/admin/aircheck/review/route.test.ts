import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  getAuthenticatedUser,
  confirmAircheck,
  rejectAircheck,
  AircheckReviewNotFound,
  AircheckReviewConflict,
} = vi.hoisted(() => {
  class AircheckReviewNotFound extends Error {
    readonly status = 404;
    constructor(message?: string) {
      super(message);
      this.name = "AircheckReviewNotFound";
    }
  }
  class AircheckReviewConflict extends Error {
    readonly status = 409;
    constructor(message?: string) {
      super(message);
      this.name = "AircheckReviewConflict";
    }
  }
  return {
    getAuthenticatedUser: vi.fn(),
    confirmAircheck: vi.fn(),
    rejectAircheck: vi.fn(),
    AircheckReviewNotFound,
    AircheckReviewConflict,
  };
});

vi.mock("@/lib/data/queries", () => ({
  getAuthenticatedUser: (...args: unknown[]) => getAuthenticatedUser(...args),
}));
vi.mock("@/lib/airchecks/review", () => ({
  confirmAircheck: (...args: unknown[]) => confirmAircheck(...args),
  rejectAircheck: (...args: unknown[]) => rejectAircheck(...args),
  AircheckReviewNotFound,
  AircheckReviewConflict,
}));

import { POST } from "./route";

function makeReq(body: unknown): Request {
  return new Request("http://x/api/admin/aircheck/review", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.INTERNAL_ADMIN_EMAILS = "ops@taylslate.com";
});

describe("POST /api/admin/aircheck/review", () => {
  it("rejects unauthenticated callers", async () => {
    getAuthenticatedUser.mockResolvedValueOnce(null);
    const res = await POST(makeReq({ ioLineItemId: "li_1", decision: "confirm" }) as never);
    expect(res.status).toBe(401);
    expect(confirmAircheck).not.toHaveBeenCalled();
    expect(rejectAircheck).not.toHaveBeenCalled();
  });

  it("forbids users not on the allowlist", async () => {
    getAuthenticatedUser.mockResolvedValueOnce({
      id: "u1",
      email: "random@notallowed.com",
    });
    const res = await POST(makeReq({ ioLineItemId: "li_1", decision: "reject" }) as never);
    expect(res.status).toBe(403);
    expect(rejectAircheck).not.toHaveBeenCalled();
  });

  it("returns the stored charge error and does not report success", async () => {
    getAuthenticatedUser.mockResolvedValueOnce({
      id: "admin_1",
      email: "ops@taylslate.com",
    });
    confirmAircheck.mockResolvedValueOnce({
      ok: false,
      chargeError: "card declined",
      aircheck: { review_decision: null, charge_error: "card declined" },
    });
    const res = await POST(makeReq({ ioLineItemId: "li_1", decision: "confirm" }) as never);
    expect(res.status).toBe(502);
    const json = await res.json();
    expect(json.ok).toBe(false);
    expect(json.chargeError).toBe("card declined");
    expect(rejectAircheck).not.toHaveBeenCalled();
  });

  it("rejects without calling confirm", async () => {
    getAuthenticatedUser.mockResolvedValueOnce({
      id: "admin_1",
      email: "ops@taylslate.com",
    });
    rejectAircheck.mockResolvedValueOnce({
      review_decision: "rejected",
      review_reason: "wrong show",
      decided_by: "ops@taylslate.com",
    });
    const res = await POST(
      makeReq({
        ioLineItemId: "li_1",
        decision: "reject",
        reason: "wrong show",
      }) as never
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(confirmAircheck).not.toHaveBeenCalled();
    expect(rejectAircheck).toHaveBeenCalledWith({
      ioLineItemId: "li_1",
      decidedBy: "ops@taylslate.com",
      actorId: "admin_1",
      reason: "wrong show",
    });
  });
});
