import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  mockGetAuthenticatedUser,
  mockGetCampaignById,
  mockGetLatestPattern,
  mockUpdateCuration,
  mockGetTieredUniverse,
  mockLogEvent,
} = vi.hoisted(() => ({
  mockGetAuthenticatedUser: vi.fn(),
  mockGetCampaignById: vi.fn(),
  mockGetLatestPattern: vi.fn(),
  mockUpdateCuration: vi.fn(),
  mockGetTieredUniverse: vi.fn(),
  mockLogEvent: vi.fn(),
}));

vi.mock("@/lib/data/queries", () => ({
  getAuthenticatedUser: mockGetAuthenticatedUser,
  getCampaignById: mockGetCampaignById,
}));

vi.mock("@/lib/data/reasoning-log", () => ({
  getLatestCampaignPatternForCampaign: mockGetLatestPattern,
  updateScaleShowCuration: mockUpdateCuration,
}));

vi.mock("@/lib/discovery/tiered-universe", () => ({
  getTieredUniverse: mockGetTieredUniverse,
}));

vi.mock("@/lib/data/events", () => ({
  logEvent: mockLogEvent,
}));

import { POST } from "./route";

const USER = { id: "user_1", email: "brand@example.com" };
const CAMPAIGN = { id: "camp_1", user_id: USER.id };
const PATTERN = { id: "pat_1" };

function call(body: unknown) {
  return POST(
    new Request("http://x/api/campaigns/camp_1/scale-watchlist", {
      method: "POST",
      body: JSON.stringify(body),
    }) as never,
    { params: Promise.resolve({ id: "camp_1" }) }
  );
}

// Scale tier holds s_scale; test/bench hold others so they fail the gate.
function tiered() {
  return {
    test: [{ showId: "s_test" }],
    scale: [{ showId: "s_scale" }],
    bench: [{ showId: "s_bench" }],
    testBudgetCents: 0,
    testUnderfilled: false,
    hasScores: true,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetAuthenticatedUser.mockResolvedValue(USER);
  mockGetCampaignById.mockResolvedValue(CAMPAIGN);
  mockGetLatestPattern.mockResolvedValue(PATTERN);
  mockGetTieredUniverse.mockResolvedValue(tiered());
  mockUpdateCuration.mockResolvedValue(true);
  mockLogEvent.mockResolvedValue(undefined);
});

describe("POST /api/campaigns/[id]/scale-watchlist — auth + ownership", () => {
  it("401 when unauthenticated", async () => {
    mockGetAuthenticatedUser.mockResolvedValue(null);
    expect((await call({ showId: "s_scale", action: "save" })).status).toBe(401);
    expect(mockUpdateCuration).not.toHaveBeenCalled();
  });

  it("404 when the campaign belongs to another user", async () => {
    mockGetCampaignById.mockResolvedValue({ id: "camp_1", user_id: "other" });
    expect((await call({ showId: "s_scale", action: "save" })).status).toBe(404);
    expect(mockUpdateCuration).not.toHaveBeenCalled();
  });
});

describe("POST scale-watchlist — validation", () => {
  it("400 on a missing showId or unknown action", async () => {
    expect((await call({ action: "save" })).status).toBe(400);
    expect((await call({ showId: "s_scale", action: "frobnicate" })).status).toBe(400);
    expect(mockUpdateCuration).not.toHaveBeenCalled();
  });

  it("409 when there's no discovery pattern yet", async () => {
    mockGetLatestPattern.mockResolvedValue(null);
    expect((await call({ showId: "s_scale", action: "save" })).status).toBe(409);
    expect(mockUpdateCuration).not.toHaveBeenCalled();
  });
});

describe("POST scale-watchlist — tier-membership gate", () => {
  it("400 when saving a show that isn't in the scale tier (no write, no event)", async () => {
    const res = await call({ showId: "s_test", action: "save" });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/scale tier/);
    expect(mockUpdateCuration).not.toHaveBeenCalled();
    expect(mockLogEvent).not.toHaveBeenCalled();
  });

  it("400 when promoting a show that isn't in the scale tier", async () => {
    expect((await call({ showId: "s_bench", action: "promote" })).status).toBe(400);
    expect(mockLogEvent).not.toHaveBeenCalled();
  });

  it("400 (fails closed) when the universe read returns empty", async () => {
    mockGetTieredUniverse.mockResolvedValue({
      test: [],
      scale: [],
      bench: [],
      testBudgetCents: 0,
      testUnderfilled: true,
      hasScores: false,
    });
    expect((await call({ showId: "s_scale", action: "save" })).status).toBe(400);
    expect(mockUpdateCuration).not.toHaveBeenCalled();
  });
});

describe("POST scale-watchlist — writes on a valid scale show", () => {
  it("200 and writes the saved flag for a scale show", async () => {
    const res = await call({ showId: "s_scale", action: "save" });
    expect(res.status).toBe(200);
    expect(mockUpdateCuration).toHaveBeenCalledWith({
      campaignPatternId: "pat_1",
      showId: "s_scale",
      brandSaved: true,
      brandDismissed: false,
    });
    expect(mockLogEvent).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: "scale_show.saved" })
    );
  });

  it("500 when the curation write matches 0 rows (surfaced, not silent)", async () => {
    mockUpdateCuration.mockResolvedValue(false);
    const res = await call({ showId: "s_scale", action: "dismiss" });
    expect(res.status).toBe(500);
    expect((await res.json()).error).toMatch(/Couldn't update the watchlist/);
  });

  it("200 on promote (scale show) without a flag write", async () => {
    const res = await call({ showId: "s_scale", action: "promote" });
    expect(res.status).toBe(200);
    expect(mockUpdateCuration).not.toHaveBeenCalled();
    expect(mockLogEvent).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: "scale_show.promoted_to_test" })
    );
  });
});
