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

const findStaleUnsignedDealsForReminder = vi.fn();
const findDealsToTimeoutCancel = vi.fn();
const updateWave12Deal = vi.fn();
const getOutreachById = vi.fn();
const voidEnvelope = vi.fn().mockResolvedValue({ ok: true });
const logEvent = vi.fn().mockResolvedValue(null);
const sendEmail = vi.fn().mockResolvedValue({ ok: true });

vi.mock("@/lib/supabase/admin", () => ({ supabaseAdmin }));
vi.mock("@/lib/data/queries", () => ({
  findStaleUnsignedDealsForReminder: (...a: unknown[]) =>
    findStaleUnsignedDealsForReminder(...a),
  findDealsToTimeoutCancel: (...a: unknown[]) => findDealsToTimeoutCancel(...a),
  updateWave12Deal: (...a: unknown[]) => updateWave12Deal(...a),
  getOutreachById: (...a: unknown[]) => getOutreachById(...a),
}));
vi.mock("@/lib/docusign/envelope", () => ({
  voidEnvelope: (...a: unknown[]) => voidEnvelope(...a),
}));
vi.mock("@/lib/data/events", () => ({ logEvent: (...a: unknown[]) => logEvent(...a) }));
vi.mock("@/lib/email/send", () => ({ sendEmail: (...a: unknown[]) => sendEmail(...a) }));

import { GET } from "./route";

const baseDeal = {
  id: "deal-1",
  outreach_id: "out-1",
  brand_profile_id: "bp1",
  show_profile_id: "sp1",
  status: "planning",
  agreed_cpm: 28,
  agreed_episode_count: 4,
  agreed_placement: "mid-roll",
  agreed_flight_start: "2026-05-01",
  agreed_flight_end: "2026-05-31",
  docusign_envelope_id: null,
  brand_signed_at: null,
  show_signed_at: null,
  created_at: new Date(Date.now() - 5 * 86_400_000).toISOString(),
  updated_at: "2026-04-23T00:00:00Z",
};

function authedRequest(): Request {
  return new Request("http://x/api/cron/deal-timeouts", {
    headers: { Authorization: "Bearer dev-cron-secret" },
  });
}

describe("GET /api/cron/deal-timeouts", () => {
  beforeEach(() => {
    process.env.CRON_SECRET = "dev-cron-secret";
    vi.clearAllMocks();
    updateWave12Deal.mockImplementation(async (id: string, patch: object) => ({
      ...baseDeal,
      ...patch,
      id,
    }));
    getOutreachById.mockResolvedValue({ show_name: "Daily Briefing" });
    // brand_profiles + brand user lookups + show_profiles + show user
    adminBuilder.single.mockImplementation(async () => ({
      data: {
        id: "bp1",
        user_id: "u-brand",
        brand_identity: "Aurora Sleep — better sleep",
        email: "brand@example.com",
      },
      error: null,
    }));
  });

  it("rejects unauthenticated requests", async () => {
    const res = await GET(
      new Request("http://x/api/cron/deal-timeouts") as never
    );
    expect(res.status).toBe(401);
  });

  it("sends reminder + stamps brand_reminder_sent_at on day 3+ deals", async () => {
    findStaleUnsignedDealsForReminder.mockResolvedValueOnce([baseDeal]);
    findDealsToTimeoutCancel.mockResolvedValueOnce([]);
    const res = await GET(authedRequest() as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.reminders_sent).toBe(1);
    expect(updateWave12Deal).toHaveBeenCalledWith(
      "deal-1",
      expect.objectContaining({ brand_reminder_sent_at: expect.any(String) })
    );
    expect(sendEmail).toHaveBeenCalled();
  });

  it("cancels deals past day 14 and fires timeout event", async () => {
    findStaleUnsignedDealsForReminder.mockResolvedValueOnce([]);
    findDealsToTimeoutCancel.mockResolvedValueOnce([
      { ...baseDeal, docusign_envelope_id: "env-1" },
    ]);
    const res = await GET(authedRequest() as never);
    expect(res.status).toBe(200);
    expect(voidEnvelope).toHaveBeenCalledWith("env-1", expect.any(String));
    expect(updateWave12Deal).toHaveBeenCalledWith(
      "deal-1",
      expect.objectContaining({
        status: "cancelled",
        cancellation_reason: "timeout",
      })
    );
    expect(logEvent).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: "io.timeout_cancelled" })
    );
  });

  it("is idempotent — empty result sets produce no work", async () => {
    findStaleUnsignedDealsForReminder.mockResolvedValueOnce([]);
    findDealsToTimeoutCancel.mockResolvedValueOnce([]);
    const res = await GET(authedRequest() as never);
    const body = await res.json();
    expect(body.reminders_sent).toBe(0);
    expect(body.cancellations).toBe(0);
    expect(updateWave12Deal).not.toHaveBeenCalled();
  });
});
