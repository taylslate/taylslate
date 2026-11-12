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

const CHARGE_FAILED =
  "The charge failed, so this line is not confirmed. The details are saved on this line for the team.";

const ALREADY_DECIDED =
  "This line was already decided. No new charge was made.";

function expectNoStore(res: Response) {
  expect(res.headers.get("cache-control")).toBe("no-store");
}

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
    expectNoStore(res);
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
    expectNoStore(res);
    expect(rejectAircheck).not.toHaveBeenCalled();
  });

  it("returns a fixed charge error and does not report success", async () => {
    getAuthenticatedUser.mockResolvedValueOnce({
      id: "admin_1",
      email: "ops@taylslate.com",
    });
    confirmAircheck.mockResolvedValueOnce({
      ok: false,
      chargeError: "card declined Delivery rollback failed: rollback write failed",
      aircheck: {
        review_decision: null,
        charge_error: "card declined Delivery rollback failed: rollback write failed",
      },
    });
    const res = await POST(makeReq({ ioLineItemId: LINE, decision: "confirm" }) as never);
    expect(res.status).toBe(502);
    expectNoStore(res);
    const json = await res.json();
    expect(json).toEqual({
      ok: false,
      chargeError: CHARGE_FAILED,
      aircheck: { review_decision: null },
    });
    expect(json.aircheck.charge_error).toBeUndefined();
    expect(JSON.stringify(json)).not.toMatch(/card declined/);
    expect(rejectAircheck).not.toHaveBeenCalled();
  });

  it("returns the fixed conflict text", async () => {
    getAuthenticatedUser.mockResolvedValueOnce({
      id: "admin_1",
      email: "ops@taylslate.com",
    });
    confirmAircheck.mockRejectedValueOnce(new AircheckReviewConflict(ALREADY_DECIDED));
    const res = await POST(makeReq({ ioLineItemId: LINE, decision: "confirm" }) as never);
    expect(res.status).toBe(409);
    expectNoStore(res);
    expect(await res.json()).toEqual({ error: ALREADY_DECIDED });
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
    expectNoStore(res);
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
    expectNoStore(res);
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
    expectNoStore(missing);

    confirmAircheck.mockRejectedValueOnce(
      new AircheckReviewConflict("This aircheck was skipped and cannot be confirmed.")
    );
    const blocked = await POST(makeReq({ ioLineItemId: LINE, decision: "confirm" }) as never);
    expect(blocked.status).toBe(409);
    expectNoStore(blocked);
    expect((await blocked.json()).error).toMatch(/skipped/);

    confirmAircheck.mockRejectedValueOnce(new AircheckConfirmInProgress("This line is already being reviewed."));
    const busy = await POST(makeReq({ ioLineItemId: LINE, decision: "confirm" }) as never);
    expect(busy.status).toBe(409);
    expectNoStore(busy);

    confirmAircheck.mockRejectedValueOnce(
      new AircheckConfirmUnavailable("Confirm is unavailable until migration 080 is applied.")
    );
    const unavailable = await POST(makeReq({ ioLineItemId: LINE, decision: "confirm" }) as never);
    expect(unavailable.status).toBe(503);
    expectNoStore(unavailable);
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
        charge_error: "card declined",
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
    expectNoStore(ok);
    const json = await ok.json();
    expect(json.aircheck.transcript_text).toBeUndefined();
    expect(json.aircheck.audio_url).toBeUndefined();
    expect(json.aircheck.charge_error).toBeUndefined();
    expect(json.charge.client_secret).toBeUndefined();
    expect(JSON.stringify(json)).not.toMatch(/secret read|sec_live|audio\.example|card declined/);
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
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    confirmAircheck.mockRejectedValueOnce(new Error("db says x"));
    const res = await POST(makeReq({ ioLineItemId: LINE, decision: "confirm" }) as never);
    expect(res.status).toBe(500);
    expectNoStore(res);
    expect(await res.json()).toEqual({ error: "Review failed." });
    const logged = spy.mock.calls.flat().map(String).join(" ");
    expect(logged).not.toMatch(/db says x/);
    expect(logged).not.toMatch(LINE);
    expect(logged).toMatch(/Error/);
    spy.mockRestore();
  });
});
