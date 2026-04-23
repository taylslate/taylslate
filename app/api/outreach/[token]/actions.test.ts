import { describe, it, expect, vi, beforeEach } from "vitest";

const verifyOutreachToken = vi.fn();
const getOutreachById = vi.fn();
const getCampaignById = vi.fn();
const updateOutreachResponse = vi.fn();
const isOutreachOpen = vi.fn();

const { adminBuilder, supabaseAdmin } = vi.hoisted(() => {
  const builder = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    ilike: vi.fn().mockReturnThis(),
    single: vi.fn(),
    maybeSingle: vi.fn(),
  };
  return {
    adminBuilder: builder,
    supabaseAdmin: { from: vi.fn(() => builder) },
  };
});

const sendEmail = vi.fn().mockResolvedValue({ ok: true });
const checkRateLimit = vi.fn();
const createWave12Deal = vi.fn();
const getWave12DealByOutreachId = vi.fn();
const logEvent = vi.fn().mockResolvedValue(null);

vi.mock("@/lib/io/tokens", () => ({
  verifyOutreachToken: (...args: unknown[]) => verifyOutreachToken(...args),
}));
vi.mock("@/lib/data/queries", () => ({
  getOutreachById: (...args: unknown[]) => getOutreachById(...args),
  getCampaignById: (...args: unknown[]) => getCampaignById(...args),
  updateOutreachResponse: (...args: unknown[]) => updateOutreachResponse(...args),
  isOutreachOpen: (...args: unknown[]) => isOutreachOpen(...args),
  createWave12Deal: (...args: unknown[]) => createWave12Deal(...args),
  getWave12DealByOutreachId: (...args: unknown[]) => getWave12DealByOutreachId(...args),
}));
vi.mock("@/lib/data/events", () => ({ logEvent: (...a: unknown[]) => logEvent(...a) }));
vi.mock("@/lib/supabase/admin", () => ({ supabaseAdmin }));
vi.mock("@/lib/email/send", () => ({ sendEmail: (...a: unknown[]) => sendEmail(...a) }));
vi.mock("@/lib/utils/rate-limit", () => ({
  checkRateLimit: (...a: unknown[]) => checkRateLimit(...a),
  _resetRateLimits: vi.fn(),
}));

import { POST as ACCEPT } from "./accept/route";
import { POST as COUNTER } from "./counter/route";
import { POST as DECLINE } from "./decline/route";

function jsonReq(body: unknown): Request {
  return new Request("http://x/api/outreach/tok/x", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
}

const params = { params: Promise.resolve({ token: "tok" }) };

const baseOutreach = {
  id: "o1",
  brand_profile_id: "bp1",
  campaign_id: "c1",
  show_name: "Daily Briefing",
  sent_to_email: "host@daily.fm",
  proposed_cpm: 28,
  proposed_episode_count: 3,
  proposed_placement: "mid-roll",
  proposed_flight_start: "2026-05-01",
  proposed_flight_end: "2026-05-31",
  pitch_body: "long pitch body",
  response_status: "pending",
  token: "tok",
  created_at: "",
  updated_at: "",
};

beforeEach(() => {
  vi.clearAllMocks();
  verifyOutreachToken.mockReturnValue({ outreach_id: "o1", iat: 0, v: 1 });
  isOutreachOpen.mockImplementation((s: string) => s === "pending");
  checkRateLimit.mockReturnValue({ ok: true, remaining: 4, retryAfterSec: 0 });
  getOutreachById.mockResolvedValue({ ...baseOutreach });
  getCampaignById.mockResolvedValue({ id: "c1", user_id: "u1", name: "Spring Launch" });
  updateOutreachResponse.mockImplementation(async (id: string, patch: object) => ({
    ...baseOutreach,
    ...patch,
    id,
  }));

  // First admin lookup → brand_profile, second → user profile
  adminBuilder.single
    .mockResolvedValueOnce({
      data: { id: "bp1", user_id: "u1", brand_identity: "Aurora", brand_website: "https://x" },
      error: null,
    })
    .mockResolvedValueOnce({
      data: { id: "u1", email: "brand@example.com", role: "brand", full_name: "Brand", company_name: "Aurora" },
      error: null,
    });
  // Wave 12: show profile lookup is a maybeSingle on profiles table for the
  // sent_to_email. Default to "no onboarded show found" so deal creation is
  // skipped — those tests live in their own files.
  adminBuilder.maybeSingle.mockResolvedValue({ data: null, error: null });
  getWave12DealByOutreachId.mockResolvedValue(null);
});

describe("POST /api/outreach/[token]/accept", () => {
  it("rejects an invalid token", async () => {
    verifyOutreachToken.mockReturnValueOnce(null);
    const res = await ACCEPT(jsonReq({}) as never, params as never);
    expect(res.status).toBe(401);
  });

  it("rejects when already responded", async () => {
    getOutreachById.mockResolvedValueOnce({ ...baseOutreach, response_status: "accepted" });
    const res = await ACCEPT(jsonReq({}) as never, params as never);
    expect(res.status).toBe(409);
  });

  it("rejects when rate-limited", async () => {
    checkRateLimit.mockReturnValueOnce({ ok: false, remaining: 0, retryAfterSec: 30 });
    const res = await ACCEPT(jsonReq({}) as never, params as never);
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("30");
  });

  it("updates outreach to accepted and notifies brand", async () => {
    const res = await ACCEPT(jsonReq({}) as never, params as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.outreach.response_status).toBe("accepted");
    expect(updateOutreachResponse).toHaveBeenCalled();
    expect(sendEmail).toHaveBeenCalled();
    const sendArgs = sendEmail.mock.calls[0][0];
    expect(sendArgs.to).toBe("brand@example.com");
    expect(sendArgs.subject).toMatch(/Accepted/);
  });
});

describe("POST /api/outreach/[token]/counter", () => {
  it("requires positive counter_cpm", async () => {
    const res = await COUNTER(jsonReq({ counter_cpm: -1 }) as never, params as never);
    expect(res.status).toBe(400);
  });

  it("records counter and notifies brand", async () => {
    const res = await COUNTER(
      jsonReq({ counter_cpm: 32, counter_message: "4-spot minimum" }) as never,
      params as never
    );
    expect(res.status).toBe(200);
    const update = updateOutreachResponse.mock.calls[0][1];
    expect(update.response_status).toBe("countered");
    expect(update.counter_cpm).toBe(32);
    expect(update.counter_message).toBe("4-spot minimum");
  });
});

describe("POST /api/outreach/[token]/decline", () => {
  it("declines without reason", async () => {
    const res = await DECLINE(jsonReq({}) as never, params as never);
    expect(res.status).toBe(200);
    const update = updateOutreachResponse.mock.calls[0][1];
    expect(update.response_status).toBe("declined");
    expect(update.decline_reason).toBeNull();
  });

  it("declines with reason", async () => {
    const res = await DECLINE(
      jsonReq({ decline_reason: "Not a fit" }) as never,
      params as never
    );
    expect(res.status).toBe(200);
    expect(updateOutreachResponse.mock.calls[0][1].decline_reason).toBe("Not a fit");
  });
});
