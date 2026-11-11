import { beforeEach, describe, expect, it, vi } from "vitest";

const LINE = "11111111-1111-4111-8111-111111111111";

const {
  getAuthenticatedUser,
  confirmAircheck,
  rejectAircheck,
  AircheckReviewNotFound,
  AircheckReviewConflict,
  AircheckConfirmInProgress,
  AircheckConfirmUnavailable,
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
  class AircheckConfirmInProgress extends Error {
    readonly status = 409;
    constructor(message?: string) {
      super(message);
      this.name = "AircheckConfirmInProgress";
    }
  }
  class AircheckConfirmUnavailable extends Error {
    readonly status = 503;
    constructor(message?: string) {
      super(message);
      this.name = "AircheckConfirmUnavailable";
    }
  }
  return {
    getAuthenticatedUser: vi.fn(),
    confirmAircheck: vi.fn(),
    rejectAircheck: vi.fn(),
    AircheckReviewNotFound,
    AircheckReviewConflict,
    AircheckConfirmInProgress,
    AircheckConfirmUnavailable,
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
  AircheckConfirmInProgress,
  AircheckConfirmUnavailable,
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
    const res = await POST(makeReq({ ioLineItemId: LINE, decision: "confirm" }) as never);
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
        ioLineItemId: LINE,
        decision: "reject",
        reason: "wrong show",
        decidedBy: "evil@example.com",
        actorId: "nope",
      }) as never
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(confirmAircheck).not.toHaveBeenCalled();
    expect(rejectAircheck).toHaveBeenCalledWith({
      ioLineItemId: LINE,
      decidedBy: "ops@taylslate.com",
      actorId: "admin_1",
      reason: "wrong show",
    });
  });

  it("returns 400 for a bad id and does not confirm", async () => {
    getAuthenticatedUser.mockResolvedValueOnce({
      id: "admin_1",
      email: "ops@taylslate.com",
    });
    const res = await POST(makeReq({ ioLineItemId: "li_1", decision: "confirm" }) as never);
    expect(res.status).toBe(400);
    expect(confirmAircheck).not.toHaveBeenCalled();
  });

  it("returns 404, 409, 503, and strips the transcript and client secret", async () => {
    getAuthenticatedUser.mockResolvedValue({
      id: "admin_1",
      email: "ops@taylslate.com",
    });

    confirmAircheck.mockRejectedValueOnce(new AircheckReviewNotFound("No aircheck is stored for this line."));
    const missing = await POST(makeReq({ ioLineItemId: LINE, decision: "confirm" }) as never);
    expect(missing.status).toBe(404);

    confirmAircheck.mockRejectedValueOnce(
      new AircheckReviewConflict("This aircheck was skipped and cannot be confirmed.")
    );
    const blocked = await POST(makeReq({ ioLineItemId: LINE, decision: "confirm" }) as never);
    expect(blocked.status).toBe(409);
    expect((await blocked.json()).error).toMatch(/skipped/);

    confirmAircheck.mockRejectedValueOnce(new AircheckConfirmInProgress("This line is already being reviewed."));
    const busy = await POST(makeReq({ ioLineItemId: LINE, decision: "confirm" }) as never);
    expect(busy.status).toBe(409);

    confirmAircheck.mockRejectedValueOnce(
      new AircheckConfirmUnavailable("Confirm is unavailable until migration 080 is applied.")
    );
    const unavailable = await POST(makeReq({ ioLineItemId: LINE, decision: "confirm" }) as never);
    expect(unavailable.status).toBe(503);
    expect(rejectAircheck).not.toHaveBeenCalled();

    confirmAircheck.mockResolvedValueOnce({
      ok: true,
      alreadyCharged: false,
      charge: { paymentId: "pay_1", client_secret: "sec_live" },
      aircheck: {
        id: "ac_1",
        transcript_text: "secret read",
        audio_url: "https://audio.example/ep",
        review_decision: "confirmed",
      },
    });
    const ok = await POST(
      makeReq({
        ioLineItemId: LINE,
        decision: "confirm",
        decidedBy: "evil@example.com",
      }) as never
    );
    expect(ok.status).toBe(200);
    const json = await ok.json();
    expect(json.aircheck.transcript_text).toBeUndefined();
    expect(json.aircheck.audio_url).toBeUndefined();
    expect(json.charge.client_secret).toBeUndefined();
    expect(JSON.stringify(json)).not.toMatch(/secret read|sec_live|audio\.example/);
    expect(confirmAircheck).toHaveBeenCalledWith({
      ioLineItemId: LINE,
      decidedBy: "ops@taylslate.com",
      actorId: "admin_1",
    });
  });

  it("returns a fixed 500 and hides the thrown message", async () => {
    getAuthenticatedUser.mockResolvedValueOnce({
      id: "admin_1",
      email: "ops@taylslate.com",
    });
    confirmAircheck.mockRejectedValueOnce(new Error("db says x"));
    const res = await POST(makeReq({ ioLineItemId: LINE, decision: "confirm" }) as never);
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Review failed." });
  });
});
