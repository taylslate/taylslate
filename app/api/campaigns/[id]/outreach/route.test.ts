import { describe, it, expect, vi, beforeEach } from "vitest";

const getAuthenticatedUser = vi.fn();
const getCampaignById = vi.fn();
const getOutreachesForCampaign = vi.fn();

vi.mock("@/lib/data/queries", () => ({
  getAuthenticatedUser: (...args: unknown[]) => getAuthenticatedUser(...args),
  getCampaignById: (...args: unknown[]) => getCampaignById(...args),
  getOutreachesForCampaign: (...args: unknown[]) => getOutreachesForCampaign(...args),
}));

import { GET } from "./route";

const params = { params: Promise.resolve({ id: "c1" }) };

const stored = {
  id: "o1",
  campaign_id: "c1",
  show_name: "Daily Briefing",
  sent_to_email: "host@daily.fm",
  token: "eyJhbGciOiJIUzI1NiJ9.payload.signature",
};

describe("GET /api/campaigns/[id]/outreach", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAuthenticatedUser.mockResolvedValue({ id: "u1" });
    getCampaignById.mockResolvedValue({ id: "c1", user_id: "u1" });
    getOutreachesForCampaign.mockResolvedValue([
      stored,
      { ...stored, id: "o2", token: "aaa.bbb.ccc" },
    ]);
  });

  it("returns the owner's rows with an empty token", async () => {
    const res = await GET({} as never, params as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.outreaches).toHaveLength(2);
    expect(body.outreaches.every((row: { token: string }) => row.token === "")).toBe(true);
    expect(body.outreaches[0]).toMatchObject({
      id: "o1",
      show_name: "Daily Briefing",
      sent_to_email: "host@daily.fm",
    });
  });

  it("returns 404 when the caller does not own the campaign", async () => {
    getCampaignById.mockResolvedValue({ id: "c1", user_id: "someone-else" });
    const res = await GET({} as never, params as never);
    expect(res.status).toBe(404);
    expect(getOutreachesForCampaign).not.toHaveBeenCalled();
  });
});
