import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockGetAuthenticatedUser, mockGetCampaignById, mockApply } = vi.hoisted(
  () => ({
    mockGetAuthenticatedUser: vi.fn(),
    mockGetCampaignById: vi.fn(),
    mockApply: vi.fn(),
  })
);

vi.mock("@/lib/data/queries", () => ({
  getAuthenticatedUser: mockGetAuthenticatedUser,
  getCampaignById: mockGetCampaignById,
}));

vi.mock("@/lib/discovery/recompute-portfolio", () => ({
  applyPortfolioOverride: mockApply,
}));

import { POST } from "./route";

const USER = { id: "user_1", email: "brand@example.com" };
const CAMPAIGN = { id: "camp_1", user_id: USER.id };

function call(body: unknown) {
  return POST(
    new Request("http://x/api/campaigns/camp_1/portfolio-overrides", {
      method: "POST",
      body: JSON.stringify(body),
    }) as never,
    { params: Promise.resolve({ id: "camp_1" }) }
  );
}

const OK_TIER = {
  ok: true,
  campaignPatternId: "pat_1",
  tier: {
    campaignPatternId: "pat_1",
    testCount: 4,
    scaleCount: 1,
    droppedCount: 2,
    testUnderfilled: false,
    showsClassified: 7,
    persisted: 7,
    errors: [],
  },
  errors: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  mockGetAuthenticatedUser.mockResolvedValue(USER);
  mockGetCampaignById.mockResolvedValue(CAMPAIGN);
  mockApply.mockResolvedValue(OK_TIER);
});

describe("POST /api/campaigns/[id]/portfolio-overrides — auth + ownership", () => {
  it("401 when unauthenticated", async () => {
    mockGetAuthenticatedUser.mockResolvedValue(null);
    expect((await call({ kind: "reset" })).status).toBe(401);
  });

  it("404 when the campaign belongs to another user", async () => {
    mockGetCampaignById.mockResolvedValue({ id: "camp_1", user_id: "someone_else" });
    expect((await call({ kind: "reset" })).status).toBe(404);
    expect(mockApply).not.toHaveBeenCalled();
  });
});

describe("POST portfolio-overrides — validation (money-adjacent gate)", () => {
  it("rejects a non-integer / out-of-range spot count", async () => {
    for (const bad of [0, 13, 1.5, -1, "3"]) {
      const res = await call({ kind: "campaign_spot_count", spotCount: bad });
      expect(res.status).toBe(400);
    }
    expect(mockApply).not.toHaveBeenCalled();
  });

  it("rejects an unknown placement", async () => {
    expect((await call({ kind: "campaign_placement", placement: "host-read" })).status).toBe(400);
  });

  it("rejects a non-positive per-show CPM", async () => {
    expect((await call({ kind: "show_cpm", showId: "s1", cpmDollars: 0 })).status).toBe(400);
    expect((await call({ kind: "show_cpm", showId: "s1", cpmDollars: -5 })).status).toBe(400);
  });

  it("rejects a per-show action without a showId", async () => {
    expect((await call({ kind: "show_cpm", cpmDollars: 30 })).status).toBe(400);
  });

  it("rejects an unknown kind", async () => {
    expect((await call({ kind: "delete_everything" })).status).toBe(400);
  });
});

describe("POST portfolio-overrides — translation + recompute", () => {
  it("passes a valid spot-count override through and returns the new counts", async () => {
    const res = await call({ kind: "campaign_spot_count", spotCount: 1 });
    expect(res.status).toBe(200);
    expect(mockApply).toHaveBeenCalledWith("camp_1", {
      kind: "campaign_spot_count",
      spotCount: 1,
    });
    expect(await res.json()).toMatchObject({
      ok: true,
      test_count: 4,
      scale_count: 1,
      dropped_count: 2,
      test_underfilled: false,
    });
  });

  it("converts a per-show CPM from dollars to integer cents", async () => {
    await call({ kind: "show_cpm", showId: "s1", cpmDollars: 30 });
    expect(mockApply).toHaveBeenCalledWith("camp_1", {
      kind: "show_cpm",
      showId: "s1",
      cpmOverrideCents: 3000,
    });
  });

  it("forwards a null per-show CPM as a clear", async () => {
    await call({ kind: "show_cpm", showId: "s1", cpmDollars: null });
    expect(mockApply).toHaveBeenCalledWith("camp_1", {
      kind: "show_cpm",
      showId: "s1",
      cpmOverrideCents: null,
    });
  });

  it("forwards a per-show placement (and null to clear)", async () => {
    await call({ kind: "show_placement", showId: "s1", placement: "postroll" });
    expect(mockApply).toHaveBeenLastCalledWith("camp_1", {
      kind: "show_placement",
      showId: "s1",
      placementOverride: "postroll",
    });
    await call({ kind: "show_placement", showId: "s1", placement: null });
    expect(mockApply).toHaveBeenLastCalledWith("camp_1", {
      kind: "show_placement",
      showId: "s1",
      placementOverride: null,
    });
  });

  it("forwards reset", async () => {
    await call({ kind: "reset" });
    expect(mockApply).toHaveBeenCalledWith("camp_1", { kind: "reset" });
  });
});

describe("POST portfolio-overrides — failure surfaces", () => {
  it("409 when there's no discovery pattern yet", async () => {
    mockApply.mockResolvedValue({ ok: false, campaignPatternId: null, tier: null, errors: [] });
    expect((await call({ kind: "reset" })).status).toBe(409);
  });

  it("500 when the input persisted-fail (pattern exists, recompute aborted)", async () => {
    mockApply.mockResolvedValue({ ok: false, campaignPatternId: "pat_1", tier: null, errors: [] });
    expect((await call({ kind: "campaign_spot_count", spotCount: 2 })).status).toBe(500);
  });
});
