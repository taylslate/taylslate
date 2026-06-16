import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const {
  mockGetAuthenticatedUser,
  mockGetCampaignById,
  mockLogEvent,
  mockGetLatestForCampaign,
  mockGetReasoning,
  mockUpdateRingDecision,
} = vi.hoisted(() => ({
  mockGetAuthenticatedUser: vi.fn(),
  mockGetCampaignById: vi.fn(),
  mockLogEvent: vi.fn(),
  mockGetLatestForCampaign: vi.fn(),
  mockGetReasoning: vi.fn(),
  mockUpdateRingDecision: vi.fn(),
}));

vi.mock("@/lib/data/queries", () => ({
  getAuthenticatedUser: mockGetAuthenticatedUser,
  getCampaignById: mockGetCampaignById,
}));
vi.mock("@/lib/data/events", () => ({ logEvent: mockLogEvent }));
vi.mock("@/lib/data/reasoning-log", () => ({
  getLatestCampaignPatternForCampaign: mockGetLatestForCampaign,
  getCampaignReasoning: mockGetReasoning,
  updateRingDecision: mockUpdateRingDecision,
}));

import { POST } from "./route";

const USER = { id: "user_1", email: "brand@example.com" };
const PATTERN = { id: "pat_1", customer_id: "user_1" };
const RINGS = [
  { id: "ring_1", kind: "primary" },
  { id: "ring_2", kind: "lateral" },
  { id: "ring_3", kind: "lateral" },
];

function call(body: Record<string, unknown>, id = "camp_1") {
  const req = new Request(`http://x/api/campaigns/${id}/interpret/confirm`, {
    method: "POST",
    body: JSON.stringify(body),
  });
  return POST(req as never, { params: Promise.resolve({ id }) });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetAuthenticatedUser.mockResolvedValue(USER);
  mockGetCampaignById.mockResolvedValue({ id: "camp_1", user_id: "user_1" });
  mockLogEvent.mockResolvedValue(null);
  mockGetLatestForCampaign.mockResolvedValue(PATTERN);
  mockGetReasoning.mockResolvedValue({
    pattern: PATTERN,
    rings: RINGS,
    convictionScores: [],
    analogs: [],
  });
  mockUpdateRingDecision.mockResolvedValue(true);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("POST /api/campaigns/[id]/interpret/confirm", () => {
  it("writes confirmed/rejected/added_by_brand decisions", async () => {
    const res = await call({
      rings: [
        { id: "ring_1", decision: "confirmed" },
        { id: "ring_2", decision: "rejected" },
        { id: "ring_3", decision: "added_by_brand" },
      ],
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.confirmed_ring_count).toBe(2); // confirmed + added_by_brand
    expect(mockUpdateRingDecision).toHaveBeenCalledWith("ring_1", "confirmed");
    expect(mockUpdateRingDecision).toHaveBeenCalledWith("ring_2", "rejected");
    expect(mockUpdateRingDecision).toHaveBeenCalledWith("ring_3", "added_by_brand");
    expect(mockLogEvent.mock.calls[0][0].eventType).toBe(
      "brief.interpretation_confirmed"
    );
  });

  it("ignores ids that do not belong to the pattern", async () => {
    const res = await call({
      rings: [
        { id: "ring_1", decision: "confirmed" },
        { id: "ring_evil", decision: "confirmed" },
      ],
    });
    await res.json();
    expect(mockUpdateRingDecision).toHaveBeenCalledTimes(1);
    expect(mockUpdateRingDecision).toHaveBeenCalledWith("ring_1", "confirmed");
  });

  it("ignores invalid decision values (pending/refined not allowed)", async () => {
    await call({
      rings: [
        { id: "ring_1", decision: "pending" },
        { id: "ring_2", decision: "refined" },
      ],
    });
    expect(mockUpdateRingDecision).not.toHaveBeenCalled();
  });

  it("404s when the campaign belongs to another user", async () => {
    mockGetCampaignById.mockResolvedValue({ id: "camp_1", user_id: "other" });
    const res = await call({ rings: [{ id: "ring_1", decision: "confirmed" }] });
    expect(res.status).toBe(404);
  });

  it("400s when rings is empty", async () => {
    const res = await call({ rings: [] });
    expect(res.status).toBe(400);
  });
});
