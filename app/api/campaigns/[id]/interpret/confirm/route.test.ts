import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const {
  mockGetAuthenticatedUser,
  mockGetCampaignById,
  mockLogEvent,
  mockGetLatestForCampaign,
  mockPersistConfirmation,
} = vi.hoisted(() => ({
  mockGetAuthenticatedUser: vi.fn(),
  mockGetCampaignById: vi.fn(),
  mockLogEvent: vi.fn(),
  mockGetLatestForCampaign: vi.fn(),
  mockPersistConfirmation: vi.fn(),
}));

vi.mock("@/lib/data/queries", () => ({
  getAuthenticatedUser: mockGetAuthenticatedUser,
  getCampaignById: mockGetCampaignById,
}));
vi.mock("@/lib/data/events", () => ({ logEvent: mockLogEvent }));
vi.mock("@/lib/data/reasoning-log", () => ({
  getLatestCampaignPatternForCampaign: mockGetLatestForCampaign,
  persistConfirmationAtomic: mockPersistConfirmation,
}));

import { POST } from "./route";

const USER = { id: "user_1", email: "brand@example.com" };
const PATTERN = { id: "pat_1", customer_id: "user_1" };

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
  mockPersistConfirmation.mockResolvedValue({
    ok: true,
    confirmed: 2,
    rejected: 1,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("POST /api/campaigns/[id]/interpret/confirm", () => {
  it("writes the decisions atomically and returns the confirmed count", async () => {
    const rings = [
      { id: "ring_1", decision: "confirmed" },
      { id: "ring_2", decision: "rejected" },
      { id: "ring_3", decision: "added_by_brand" },
    ];
    const res = await call({ rings });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.confirmed_ring_count).toBe(2); // from the RPC result
    expect(mockPersistConfirmation).toHaveBeenCalledWith("pat_1", rings);
    expect(mockLogEvent.mock.calls[0][0].eventType).toBe(
      "brief.interpretation_confirmed"
    );
  });

  it("400s with a structured error on a validation failure (unknown/refined/invalid ring)", async () => {
    mockPersistConfirmation.mockResolvedValue({ ok: false, reason: "validation" });
    const res = await call({
      rings: [{ id: "ring_refined", decision: "confirmed" }],
    });
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.code).toBe("invalid_rings");
    expect(mockLogEvent).not.toHaveBeenCalled();
  });

  it("500s when the atomic write hits a DB error (no decisions written)", async () => {
    mockPersistConfirmation.mockResolvedValue({ ok: false, reason: "error" });
    const res = await call({
      rings: [{ id: "ring_1", decision: "confirmed" }],
    });
    const body = await res.json();
    expect(res.status).toBe(500);
    expect(body.code).toBe("confirm_failed");
    expect(mockLogEvent).not.toHaveBeenCalled();
  });

  it("404s when the campaign belongs to another user", async () => {
    mockGetCampaignById.mockResolvedValue({ id: "camp_1", user_id: "other" });
    const res = await call({ rings: [{ id: "ring_1", decision: "confirmed" }] });
    expect(res.status).toBe(404);
    expect(mockPersistConfirmation).not.toHaveBeenCalled();
  });

  it("400s when rings is empty", async () => {
    const res = await call({ rings: [] });
    expect(res.status).toBe(400);
    expect(mockPersistConfirmation).not.toHaveBeenCalled();
  });
});
