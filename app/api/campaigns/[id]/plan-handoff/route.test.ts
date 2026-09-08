import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  mockGetAuthenticatedUser,
  mockGetCampaignById,
  mockUpdatePlanHandoff,
  mockUpdateScoredShows,
  mockUpdateSelections,
  mockGetLatestPattern,
  mockGetTieredUniverse,
  mockAdapter,
  mockLogEvent,
} = vi.hoisted(() => ({
  mockGetAuthenticatedUser: vi.fn(),
  mockGetCampaignById: vi.fn(),
  mockUpdatePlanHandoff: vi.fn(),
  mockUpdateScoredShows: vi.fn(),
  mockUpdateSelections: vi.fn(),
  mockGetLatestPattern: vi.fn(),
  mockGetTieredUniverse: vi.fn(),
  mockAdapter: vi.fn(),
  mockLogEvent: vi.fn(),
}));

vi.mock("@/lib/data/queries", () => ({
  getAuthenticatedUser: mockGetAuthenticatedUser,
  getCampaignById: mockGetCampaignById,
  updateCampaignPlanHandoff: mockUpdatePlanHandoff,
  // Present so the test can prove the route never calls the old two-write path.
  updateCampaignScoredShows: mockUpdateScoredShows,
  updateCampaignSelections: mockUpdateSelections,
}));

vi.mock("@/lib/data/reasoning-log", () => ({
  getLatestCampaignPatternForCampaign: mockGetLatestPattern,
}));

vi.mock("@/lib/discovery/tiered-universe", () => ({
  getTieredUniverse: mockGetTieredUniverse,
}));

vi.mock("@/lib/discovery/scored-show-adapter", () => ({
  tieredShowToScoredShowRecord: mockAdapter,
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
    new Request("http://x/api/campaigns/camp_1/plan-handoff", {
      method: "POST",
      body: JSON.stringify(body),
    }) as never,
    { params: Promise.resolve({ id: "camp_1" }) }
  );
}

// A tiered universe with one selectable test show, s1.
function tieredWith(testIds: string[], scaleIds: string[] = []) {
  return {
    test: testIds.map((showId) => ({ showId })),
    scale: scaleIds.map((showId) => ({ showId })),
    bench: [],
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
  mockGetTieredUniverse.mockResolvedValue(tieredWith(["s1"]));
  // Adapter echoes the tiered show as a scored-show record with podcastId.
  mockAdapter.mockImplementation((t: { showId: string }) => ({
    podcastId: t.showId,
    name: t.showId,
  }));
  mockUpdatePlanHandoff.mockResolvedValue(true);
  mockLogEvent.mockResolvedValue(null);
});

describe("POST /api/campaigns/[id]/plan-handoff — auth + ownership", () => {
  it("401 when unauthenticated", async () => {
    mockGetAuthenticatedUser.mockResolvedValue(null);
    expect((await call({ showIds: ["s1"] })).status).toBe(401);
    expect(mockUpdatePlanHandoff).not.toHaveBeenCalled();
  });

  it("404 when the campaign belongs to another user", async () => {
    mockGetCampaignById.mockResolvedValue({ id: "camp_1", user_id: "other" });
    expect((await call({ showIds: ["s1"] })).status).toBe(404);
    expect(mockUpdatePlanHandoff).not.toHaveBeenCalled();
  });
});

describe("POST plan-handoff — validation", () => {
  it("400 when no showIds provided", async () => {
    expect((await call({ showIds: [] })).status).toBe(400);
    expect((await call({})).status).toBe(400);
    expect(mockUpdatePlanHandoff).not.toHaveBeenCalled();
  });

  it("409 when there's no discovery pattern yet", async () => {
    mockGetLatestPattern.mockResolvedValue(null);
    expect((await call({ showIds: ["s1"] })).status).toBe(409);
    expect(mockUpdatePlanHandoff).not.toHaveBeenCalled();
  });

  it("400 when none of the requested ids are in test∪scale", async () => {
    mockGetTieredUniverse.mockResolvedValue(tieredWith(["s1"]));
    expect((await call({ showIds: ["not-in-universe"] })).status).toBe(400);
    expect(mockUpdatePlanHandoff).not.toHaveBeenCalled();
  });
});

describe("POST plan-handoff — atomic single write", () => {
  it("writes once with both scored shows and selected ids, then 200", async () => {
    const res = await call({ showIds: ["s1"] });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, count: 1 });

    // Exactly one write, carrying both the scored-show records AND the selection
    // — there is no second write that could partially fail.
    expect(mockUpdatePlanHandoff).toHaveBeenCalledTimes(1);
    expect(mockUpdatePlanHandoff).toHaveBeenCalledWith(
      "camp_1",
      [{ podcastId: "s1", name: "s1" }],
      { source: "tiered_handoff", pattern_id: "pat_1", count: 1 },
      ["s1"]
    );

    // The legacy two-call path is never used.
    expect(mockUpdateScoredShows).not.toHaveBeenCalled();
    expect(mockUpdateSelections).not.toHaveBeenCalled();
  });

  it("honors only requested ids from the universe (scale promotion allowed)", async () => {
    mockGetTieredUniverse.mockResolvedValue(tieredWith(["s1"], ["s2"]));
    const res = await call({ showIds: ["s1", "s2"] });
    expect(res.status).toBe(200);
    expect(mockUpdatePlanHandoff).toHaveBeenCalledWith(
      "camp_1",
      [
        { podcastId: "s1", name: "s1" },
        { podcastId: "s2", name: "s2" },
      ],
      expect.objectContaining({ count: 2 }),
      ["s1", "s2"]
    );
  });

  it("500 when the atomic write fails — no inconsistent state is reachable", async () => {
    mockUpdatePlanHandoff.mockResolvedValue(false);
    const res = await call({ showIds: ["s1"] });
    expect(res.status).toBe(500);
    expect((await res.json()).error).toMatch(/Couldn't hand off/);
    // Still a single write attempt; nothing falls back to a second writer.
    expect(mockUpdatePlanHandoff).toHaveBeenCalledTimes(1);
    expect(mockUpdateScoredShows).not.toHaveBeenCalled();
    expect(mockUpdateSelections).not.toHaveBeenCalled();
  });
});

describe("POST plan-handoff — selection-signal event", () => {
  it("emits one discovery.selection_captured with shown/selected/filters/prices", async () => {
    mockGetTieredUniverse.mockResolvedValue(tieredWith(["s1", "s3"], ["s2"]));
    const res = await call({
      showIds: ["s1", "s2"],
      shownShowIds: ["s1", "s2", "s3"],
      filters: { ring: "ring-a", band: "medium", sort: "composite_desc" },
    });
    expect(res.status).toBe(200);

    expect(mockLogEvent).toHaveBeenCalledTimes(1);
    const arg = mockLogEvent.mock.calls[0][0];
    expect(arg.eventType).toBe("discovery.selection_captured");
    expect(arg.entityType).toBe("campaign");
    expect(arg.entityId).toBe("camp_1");
    expect(arg.payload).toMatchObject({
      campaign_pattern_id: "pat_1",
      shown_show_ids: ["s1", "s2", "s3"],
      shown_count: 3,
      selected_show_ids: ["s1", "s2"],
      selected_count: 2,
      filters_applied: { ring: "ring-a", band: "medium", sort: "composite_desc" },
    });
    // Prices are snapshot SERVER-side for the whole shown universe (test∪scale∪bench).
    expect(
      arg.payload.estimated_prices.map((p: { show_id: string }) => p.show_id)
    ).toEqual(["s1", "s3", "s2"]);
  });

  it("falls back to the server universe for the shown set when the client omits it", async () => {
    mockGetTieredUniverse.mockResolvedValue(tieredWith(["s1"], ["s2"]));
    await call({ showIds: ["s1"] });
    const arg = mockLogEvent.mock.calls[0][0];
    expect(arg.payload.shown_show_ids).toEqual(["s1", "s2"]);
    expect(arg.payload.filters_applied).toBeNull();
  });

  it("does not emit when the handoff write fails", async () => {
    mockUpdatePlanHandoff.mockResolvedValue(false);
    const res = await call({ showIds: ["s1"] });
    expect(res.status).toBe(500);
    expect(mockLogEvent).not.toHaveBeenCalled();
  });
});
