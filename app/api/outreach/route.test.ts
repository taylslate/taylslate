import { describe, it, expect, vi, beforeEach } from "vitest";

const getAuthenticatedUser = vi.fn();
const getBrandProfileByUserId = vi.fn();
const getCampaignById = vi.fn();
const createOutreach = vi.fn();
const adminFromBuilder = {
  update: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  select: vi.fn().mockReturnThis(),
  single: vi.fn(),
};

vi.mock("@/lib/data/queries", () => ({
  getAuthenticatedUser: (...args: unknown[]) => getAuthenticatedUser(...args),
  getBrandProfileByUserId: (...args: unknown[]) => getBrandProfileByUserId(...args),
  getCampaignById: (...args: unknown[]) => getCampaignById(...args),
  createOutreach: (...args: unknown[]) => createOutreach(...args),
}));

vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: {
    from: () => adminFromBuilder,
  },
}));

vi.mock("@/lib/email/send", () => ({
  sendEmail: vi.fn().mockResolvedValue({ ok: true, id: "msg_test" }),
}));

vi.mock("@/lib/io/tokens", () => ({
  signOutreachToken: (id: string) => `signed.${id}`,
}));

import { POST } from "./route";

function jsonReq(body: unknown): Request {
  return new Request("http://x/api/outreach", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const validBody = {
  campaign_id: "c1",
  show: {
    podscan_id: "p1",
    show_name: "Daily Briefing",
    contact_email: "host@daily.fm",
    audience_size: 12000,
    categories: ["business"],
  },
  proposed: {
    cpm: 28,
    episode_count: 3,
    placement: "mid-roll",
    flight_start: "2026-05-01",
    flight_end: "2026-05-31",
  },
  pitch_body:
    "We love your show — the way you cover small-business operations lines up with our customer profile. Would love to find time to chat next week.",
};

describe("POST /api/outreach", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    adminFromBuilder.single.mockResolvedValue({
      data: { id: "o1", token: "signed.o1", sent_at: "2026-04-23T00:00:00Z" },
      error: null,
    });
  });

  it("requires auth", async () => {
    getAuthenticatedUser.mockResolvedValue(null);
    const res = await POST(jsonReq(validBody) as never);
    expect(res.status).toBe(401);
  });

  it("rejects when brand profile is missing", async () => {
    getAuthenticatedUser.mockResolvedValue({ id: "u1" });
    getBrandProfileByUserId.mockResolvedValue(null);
    const res = await POST(jsonReq(validBody) as never);
    expect(res.status).toBe(400);
  });

  it("rejects when campaign does not belong to user", async () => {
    getAuthenticatedUser.mockResolvedValue({ id: "u1" });
    getBrandProfileByUserId.mockResolvedValue({ id: "bp1", user_id: "u1" });
    getCampaignById.mockResolvedValue({ id: "c1", user_id: "u_OTHER", name: "X" });
    const res = await POST(jsonReq(validBody) as never);
    expect(res.status).toBe(404);
  });

  it("rejects pitch body that is too short", async () => {
    getAuthenticatedUser.mockResolvedValue({ id: "u1" });
    getBrandProfileByUserId.mockResolvedValue({ id: "bp1", user_id: "u1" });
    getCampaignById.mockResolvedValue({ id: "c1", user_id: "u1", name: "C" });
    const res = await POST(jsonReq({ ...validBody, pitch_body: "too short" }) as never);
    expect(res.status).toBe(400);
  });

  it("creates outreach, signs token, and reports email send", async () => {
    getAuthenticatedUser.mockResolvedValue({ id: "u1" });
    getBrandProfileByUserId.mockResolvedValue({
      id: "bp1",
      user_id: "u1",
      brand_identity: "Aurora Sleep — better sleep",
      brand_website: "https://aurora.example",
    });
    getCampaignById.mockResolvedValue({ id: "c1", user_id: "u1", name: "Spring Launch" });
    createOutreach.mockResolvedValue({ id: "o1" });

    const res = await POST(jsonReq(validBody) as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.outreach.id).toBe("o1");
    expect(body.pitch_url).toMatch(/\/outreach\/signed\.o1$/);
    expect(body.email_sent).toBe(true);
    expect(createOutreach).toHaveBeenCalledOnce();
    const draft = createOutreach.mock.calls[0][0];
    expect(draft.brand_profile_id).toBe("bp1");
    expect(draft.sent_to_email).toBe("host@daily.fm");
    expect(draft.proposed_cpm).toBe(28);
  });

  it("surfaces unique-constraint failures as 409", async () => {
    getAuthenticatedUser.mockResolvedValue({ id: "u1" });
    getBrandProfileByUserId.mockResolvedValue({ id: "bp1", user_id: "u1" });
    getCampaignById.mockResolvedValue({ id: "c1", user_id: "u1", name: "C" });
    createOutreach.mockResolvedValue(null);
    const res = await POST(jsonReq(validBody) as never);
    expect(res.status).toBe(409);
  });
});
