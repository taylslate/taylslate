import { describe, it, expect, vi, beforeEach } from "vitest";

const { adminBuilder, supabaseAdmin } = vi.hoisted(() => {
  const builder = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    single: vi.fn(),
  };
  return {
    adminBuilder: builder,
    supabaseAdmin: { from: vi.fn(() => builder) },
  };
});

const getAllPaygCustomersAboveBreakeven = vi.fn();
const listEventsForCustomer = vi.fn();
const recordEvent = vi.fn().mockResolvedValue(undefined);
const logEvent = vi.fn().mockResolvedValue(null);
const sendEmail = vi.fn().mockResolvedValue({ ok: true });

vi.mock("@/lib/supabase/admin", () => ({ supabaseAdmin }));
vi.mock("@/lib/analytics/gmv", () => ({
  getAllPaygCustomersAboveBreakeven: (...a: unknown[]) =>
    getAllPaygCustomersAboveBreakeven(...a),
}));
vi.mock("@/lib/data/event-log", () => ({
  listEventsForCustomer: (...a: unknown[]) => listEventsForCustomer(...a),
  recordEvent: (...a: unknown[]) => recordEvent(...a),
}));
vi.mock("@/lib/data/events", () => ({
  logEvent: (...a: unknown[]) => logEvent(...a),
}));
vi.mock("@/lib/email/send", () => ({
  sendEmail: (...a: unknown[]) => sendEmail(...a),
}));

import { GET } from "./route";

function authedRequest(): Request {
  return new Request("http://x/api/cron/conversion-alerts", {
    headers: { Authorization: "Bearer dev-cron-secret" },
  });
}

describe("GET /api/cron/conversion-alerts", () => {
  beforeEach(() => {
    process.env.CRON_SECRET = "dev-cron-secret";
    process.env.INTERNAL_ALERT_EMAIL = "chris@taylslate.com";
    vi.clearAllMocks();
    sendEmail.mockResolvedValue({ ok: true });
    listEventsForCustomer.mockResolvedValue([]); // no prior alert by default
    adminBuilder.single.mockResolvedValue({
      data: {
        id: "u-1",
        email: "founder@brand.com",
        full_name: "Jamie Founder",
        company_name: "Aurora Sleep",
      },
      error: null,
    });
  });

  it("rejects unauthenticated requests", async () => {
    const res = await GET(
      new Request("http://x/api/cron/conversion-alerts") as never
    );
    expect(res.status).toBe(401);
  });

  it("sends alerts to the internal address for each candidate above breakeven", async () => {
    getAllPaygCustomersAboveBreakeven.mockResolvedValueOnce([
      { customerId: "u-1", monthlyAvgCents: 2_500_000 },
    ]);
    const res = await GET(authedRequest() as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.alerts_sent).toBe(1);
    expect(sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: "chris@taylslate.com" })
    );
    expect(recordEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        customerId: "u-1",
        operationType: "conversion_alert_sent",
      })
    );
    expect(logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "customer.conversion_alert_sent",
      })
    );
  });

  it("idempotency: a second run within 7 days does not re-send", async () => {
    getAllPaygCustomersAboveBreakeven.mockResolvedValue([
      { customerId: "u-1", monthlyAvgCents: 2_500_000 },
    ]);

    // First run: no prior event → fires
    listEventsForCustomer.mockResolvedValueOnce([]);
    const first = await GET(authedRequest() as never);
    const firstBody = await first.json();
    expect(firstBody.alerts_sent).toBe(1);

    // Second run: prior event exists → skipped
    listEventsForCustomer.mockResolvedValueOnce([
      { id: "e1", operation_type: "conversion_alert_sent" },
    ]);
    sendEmail.mockClear();
    const second = await GET(authedRequest() as never);
    const secondBody = await second.json();
    expect(secondBody.alerts_sent).toBe(0);
    expect(secondBody.skipped_recently_alerted).toBe(1);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("does not record event when sendEmail fails (so next run will retry)", async () => {
    getAllPaygCustomersAboveBreakeven.mockResolvedValueOnce([
      { customerId: "u-1", monthlyAvgCents: 2_500_000 },
    ]);
    sendEmail.mockResolvedValueOnce({ ok: false, reason: "send_failed" });
    const res = await GET(authedRequest() as never);
    const body = await res.json();
    expect(body.alerts_sent).toBe(0);
    expect(recordEvent).not.toHaveBeenCalled();
    expect(logEvent).not.toHaveBeenCalled();
    expect(body.errors.length).toBe(1);
  });

  it("does nothing when no candidates are above breakeven", async () => {
    getAllPaygCustomersAboveBreakeven.mockResolvedValueOnce([]);
    const res = await GET(authedRequest() as never);
    const body = await res.json();
    expect(body.candidates).toBe(0);
    expect(body.alerts_sent).toBe(0);
    expect(sendEmail).not.toHaveBeenCalled();
  });
});
