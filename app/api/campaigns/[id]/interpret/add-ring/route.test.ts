import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const {
  mockGetAuthenticatedUser,
  mockGetCampaignById,
  mockLogEvent,
  mockCallLLM,
  mockGetLatestForCampaign,
  mockGetReasoning,
  mockRecordRing,
} = vi.hoisted(() => ({
  mockGetAuthenticatedUser: vi.fn(),
  mockGetCampaignById: vi.fn(),
  mockLogEvent: vi.fn(),
  mockCallLLM: vi.fn(),
  mockGetLatestForCampaign: vi.fn(),
  mockGetReasoning: vi.fn(),
  mockRecordRing: vi.fn(),
}));

vi.mock("@/lib/data/queries", () => ({
  getAuthenticatedUser: mockGetAuthenticatedUser,
  getCampaignById: mockGetCampaignById,
}));
vi.mock("@/lib/data/events", () => ({ logEvent: mockLogEvent }));
vi.mock("@/lib/llm/client", () => ({
  callLLMWithFallback: mockCallLLM,
  createLLMClient: vi.fn(() => ({})),
  loadPrompt: vi.fn(() => "system prompt"),
}));
vi.mock("@/lib/data/reasoning-log", () => ({
  getLatestCampaignPatternForCampaign: mockGetLatestForCampaign,
  getCampaignReasoning: mockGetReasoning,
  recordRingHypothesis: mockRecordRing,
}));

import { POST } from "./route";

const USER = { id: "user_1", email: "brand@example.com" };
const PATTERN = {
  id: "pat_1",
  campaign_id: "camp_1",
  customer_id: "user_1",
  created_at: "2026-06-10T12:00:00.000Z",
  product_attributes: {
    brand_name: "SaunaBox",
    category: "premium wellness",
    customer_summary: "Affluent recovery-obsessed men 30-55.",
    brief_context: { goals: ["test_channel"], budget_total: 25000 },
    interpretation: {
      primary_ring: { ring_label: "protocol recovery", analog_campaigns: [] },
      lateral_rings: [],
    },
  },
  customer_description: "Recovery buyers.",
  aov_bucket: "high",
  scoring_weights: null,
};

function llmMessage(text: string, stopReason = "end_turn") {
  return { stop_reason: stopReason, content: [{ type: "text", text }] };
}

function call(body: Record<string, unknown>, id = "camp_1") {
  const req = new Request(`http://x/api/campaigns/${id}/interpret/add-ring`, {
    method: "POST",
    body: JSON.stringify(body),
  });
  return POST(req as never, { params: Promise.resolve({ id }) });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
  mockGetAuthenticatedUser.mockResolvedValue(USER);
  mockGetCampaignById.mockResolvedValue({ id: "camp_1", user_id: "user_1" });
  mockLogEvent.mockResolvedValue(null);
  mockGetLatestForCampaign.mockResolvedValue(PATTERN);
  mockGetReasoning.mockResolvedValue({
    pattern: PATTERN,
    rings: [
      { id: "ring_p", slot_position: 0 },
      { id: "ring_l", slot_position: 1 },
    ],
    convictionScores: [],
    analogs: [],
  });
  mockRecordRing.mockResolvedValue("ring_new");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("POST /api/campaigns/[id]/interpret/add-ring", () => {
  it("persists a lateral ring with brand_decision='added_by_brand'", async () => {
    mockCallLLM.mockResolvedValue(
      llmMessage(
        JSON.stringify({
          ring_label: "endurance athletes",
          confidence: "medium",
          reasoning: "Performance-insurance buyers.",
          analog_campaigns: [],
        })
      )
    );

    const res = await call({ framing_text: "what about marathon runners?" });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ring.ring_hypothesis_id).toBe("ring_new");
    expect(body.ring.ring_label).toBe("endurance athletes");
    expect(mockRecordRing.mock.calls[0][0]).toMatchObject({
      campaignPatternId: "pat_1",
      kind: "lateral",
      brandDecision: "added_by_brand",
    });
    expect(mockLogEvent.mock.calls[0][0].payload.mode).toBe("add");
  });

  it("appends the added ring at the next slot_position", async () => {
    mockCallLLM.mockResolvedValue(
      llmMessage(
        JSON.stringify({
          ring_label: "busy parents",
          confidence: "medium",
          reasoning: "Convenience buyers.",
          analog_campaigns: [],
        })
      )
    );
    // existing rings occupy slots 0 and 1 → next available is 2
    await call({ framing_text: "what about parents?" });
    expect(mockRecordRing.mock.calls[0][0].slotPosition).toBe(2);
  });

  it("soft-fails on malformed LLM output", async () => {
    mockCallLLM.mockResolvedValue(llmMessage("nope"));
    const res = await call({ framing_text: "x" });
    const body = await res.json();
    expect(body.error).toBe("add_ring_failed");
    expect(mockRecordRing).not.toHaveBeenCalled();
  });

  it("400s when framing_text is missing", async () => {
    const res = await call({});
    expect(res.status).toBe(400);
  });

  it("404s when the campaign belongs to another user", async () => {
    mockGetCampaignById.mockResolvedValue({ id: "camp_1", user_id: "other" });
    const res = await call({ framing_text: "x" });
    expect(res.status).toBe(404);
  });
});
