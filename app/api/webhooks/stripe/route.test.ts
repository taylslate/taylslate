import { describe, it, expect, vi, beforeEach } from "vitest";

const { verifyAndHandleStripeEvent } = vi.hoisted(() => ({
  verifyAndHandleStripeEvent: vi.fn(),
}));

vi.mock("@/lib/stripe/webhook", () => ({
  verifyAndHandleStripeEvent: (...a: unknown[]) =>
    verifyAndHandleStripeEvent(...a),
}));

import { POST } from "./route";

function makeReq(headers: Record<string, string>, body: string): Request {
  return new Request("http://x/api/webhooks/stripe", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/webhooks/stripe", () => {
  it("returns 200 with event metadata on a verified event", async () => {
    verifyAndHandleStripeEvent.mockResolvedValueOnce({
      eventId: "evt_1",
      eventType: "charge.succeeded",
      handled: true,
    });

    const res = await POST(
      makeReq({ "stripe-signature": "t=1,v1=abc" }, '{"id":"evt_1"}') as never
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      ok: true,
      eventId: "evt_1",
      eventType: "charge.succeeded",
      handled: true,
    });
  });

  it("returns 400 when verification throws (bad signature)", async () => {
    verifyAndHandleStripeEvent.mockRejectedValueOnce(
      new Error("Invalid Stripe signature")
    );

    const res = await POST(makeReq({ "stripe-signature": "wrong" }, "{}") as never);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/Invalid Stripe signature/);
  });

  it("forwards the raw body bytes (not re-serialised JSON) to the verifier", async () => {
    verifyAndHandleStripeEvent.mockResolvedValueOnce({
      eventId: "evt_2",
      eventType: "payment_intent.succeeded",
      handled: true,
    });
    const raw = '{"id":"evt_2","spaces":  "preserved"}';
    await POST(makeReq({ "stripe-signature": "sig" }, raw) as never);
    const args = verifyAndHandleStripeEvent.mock.calls[0][0];
    expect(args.rawBody).toBe(raw);
    expect(args.signatureHeader).toBe("sig");
  });
});
