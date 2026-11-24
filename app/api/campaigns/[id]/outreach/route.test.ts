import { describe, it, expect, vi, beforeEach } from "vitest";

const { getAuthenticatedUser, getCampaignById, getOutreachesForCampaign, contactVisibleOutreachIds } =
  vi.hoisted(() => ({
    getAuthenticatedUser: vi.fn(),
    getCampaignById: vi.fn(),
    getOutreachesForCampaign: vi.fn(),
    contactVisibleOutreachIds: vi.fn(),
  }));

vi.mock("@/lib/data/queries", () => ({
  getAuthenticatedUser: (...args: unknown[]) => getAuthenticatedUser(...args),
  getCampaignById: (...args: unknown[]) => getCampaignById(...args),
  getOutreachesForCampaign: (...args: unknown[]) => getOutreachesForCampaign(...args),
}));

vi.mock("@/lib/shows/can-edit-show", () => ({
  isShowsAdmin: async () => false,
}));

vi.mock("@/lib/relay/contact-visibility", async () => {
  const actual = await vi.importActual<typeof import("@/lib/relay/contact-visibility")>(
    "@/lib/relay/contact-visibility"
  );
  return {
    ...actual,
    contactVisibleOutreachIds: (...args: unknown[]) => contactVisibleOutreachIds(...args),
  };
});

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
    contactVisibleOutreachIds.mockResolvedValue(new Set());
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
      sent_to_email: "",
    });
  });

  it("keeps sent_to_email on an unlocked row and blanks a locked row", async () => {
    contactVisibleOutreachIds.mockResolvedValue(new Set(["o1"]));
    const res = await GET({} as never, params as never);
    const body = await res.json();
    expect(body.outreaches[0].sent_to_email).toBe("host@daily.fm");
    expect(body.outreaches[1].sent_to_email).toBe("");
  });

  it("returns 404 when the caller does not own the campaign", async () => {
    getCampaignById.mockResolvedValue({ id: "c1", user_id: "someone-else" });
    const res = await GET({} as never, params as never);
    expect(res.status).toBe(404);
    expect(getOutreachesForCampaign).not.toHaveBeenCalled();
  });
});
