import { describe, it, expect, vi, beforeEach } from "vitest";

const { adminBuilder, supabaseAdmin } = vi.hoisted(() => {
  const builder = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    ilike: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn(),
    single: vi.fn(),
  };
  return {
    adminBuilder: builder,
    supabaseAdmin: { from: vi.fn(() => builder) },
  };
});

const getAuthenticatedUser = vi.fn();
const getBrandProfileByUserId = vi.fn();
const getCampaignById = vi.fn();
const getOutreachById = vi.fn();
const getWave12DealByOutreachId = vi.fn();
const createWave12Deal = vi.fn();
const logEvent = vi.fn().mockResolvedValue(null);
const sendEmail = vi.fn().mockResolvedValue({ ok: true });

vi.mock("@/lib/supabase/admin", () => ({ supabaseAdmin }));
vi.mock("@/lib/data/queries", () => ({
  getAuthenticatedUser: (...a: unknown[]) => getAuthenticatedUser(...a),
  getBrandProfileByUserId: (...a: unknown[]) => getBrandProfileByUserId(...a),
  getCampaignById: (...a: unknown[]) => getCampaignById(...a),
  getOutreachById: (...a: unknown[]) => getOutreachById(...a),
  getWave12DealByOutreachId: (...a: unknown[]) => getWave12DealByOutreachId(...a),
  createWave12Deal: (...a: unknown[]) => createWave12Deal(...a),
}));
vi.mock("@/lib/data/events", () => ({ logEvent: (...a: unknown[]) => logEvent(...a) }));
vi.mock("@/lib/email/send", () => ({ sendEmail: (...a: unknown[]) => sendEmail(...a) }));

import { POST } from "./route";

const params = { params: Promise.resolve({ token: "out-1" }) };

const baseOutreach = {
  id: "out-1",
  brand_profile_id: "bp1",
  campaign_id: "c1",
  show_name: "Daily Briefing",
  proposed_cpm: 28,
  proposed_episode_count: 4,
  proposed_placement: "mid-roll",
  proposed_flight_start: "2026-05-01",
  proposed_flight_end: "2026-05-31",
  pitch_body: "...",
  sent_to_email: "host@daily.fm",
  response_status: "countered",
  counter_cpm: 32,
  counter_message: "4 spot min",
  token: "t",
  created_at: "",
  updated_at: "",
};

beforeEach(() => {
  vi.clearAllMocks();
  getAuthenticatedUser.mockResolvedValue({ id: "u-brand", email: "brand@example.com" });
  getBrandProfileByUserId.mockResolvedValue({
    id: "bp1",
    user_id: "u-brand",
    brand_identity: "Aurora Sleep",
  });
  getOutreachById.mockResolvedValue(baseOutreach);
  getCampaignById.mockResolvedValue({ id: "c1", name: "Spring" });
  getWave12DealByOutreachId.mockResolvedValue(null);
  createWave12Deal.mockResolvedValue({
    id: "deal-1",
    outreach_id: "out-1",
    brand_profile_id: "bp1",
    show_profile_id: "sp1",
    agreed_cpm: 32,
    agreed_episode_count: 4,
    agreed_placement: "mid-roll",
    agreed_flight_start: "2026-05-01",
    agreed_flight_end: "2026-05-31",
    status: "planning",
    created_at: "2026-04-23T00:00:00Z",
    updated_at: "2026-04-23T00:00:00Z",
  });
  // Show user lookup → show profile lookup → outreach update return
  adminBuilder.maybeSingle
    .mockResolvedValueOnce({ data: { id: "u-show", role: "show" }, error: null })
    .mockResolvedValueOnce({
      data: { id: "sp1", onboarded_at: "2026-04-22T00:00:00Z" },
      error: null,
    });
  adminBuilder.single.mockResolvedValueOnce({
    data: { ...baseOutreach, response_status: "accepted" },
    error: null,
  });
});

function req(): Request {
  return new Request("http://x/api/outreach/out-1/accept-counter", { method: "POST" });
}

describe("POST /api/outreach/[id]/accept-counter", () => {
  it("rejects unauthenticated", async () => {
    getAuthenticatedUser.mockResolvedValueOnce(null);
    const res = await POST(req() as never, params as never);
    expect(res.status).toBe(401);
  });

  it("rejects when caller is not the brand on the outreach", async () => {
    getBrandProfileByUserId.mockResolvedValueOnce({ id: "bp-other", user_id: "u-brand" });
    const res = await POST(req() as never, params as never);
    expect(res.status).toBe(403);
  });

  it("rejects when outreach is not in countered state", async () => {
    getOutreachById.mockResolvedValueOnce({ ...baseOutreach, response_status: "pending" });
    const res = await POST(req() as never, params as never);
    expect(res.status).toBe(409);
  });

  it("creates a deal at the COUNTERED CPM and fires both events", async () => {
    const res = await POST(req() as never, params as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.deal.agreed_cpm).toBe(32);
    expect(createWave12Deal).toHaveBeenCalledWith(
      expect.objectContaining({ agreed_cpm: 32 })
    );
    const types = logEvent.mock.calls.map((c) => c[0].eventType);
    expect(types).toContain("io.counter_accepted");
    expect(types).toContain("deal.created");
  });

  it("is idempotent — second call returns existing deal", async () => {
    getWave12DealByOutreachId.mockResolvedValueOnce({ id: "deal-1", agreed_cpm: 32 });
    const res = await POST(req() as never, params as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.alreadyExisted).toBe(true);
    expect(createWave12Deal).not.toHaveBeenCalled();
  });
});
