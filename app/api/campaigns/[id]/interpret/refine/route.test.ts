import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const {
  mockGetAuthenticatedUser,
  mockGetCampaignById,
  mockLogEvent,
  mockCallLLM,
  mockGetLatestForCampaign,
  mockGetReasoning,
  mockRecordRing,
  mockUpdateRingDecision,
} = vi.hoisted(() => ({
  mockGetAuthenticatedUser: vi.fn(),
  mockGetCampaignById: vi.fn(),
  mockLogEvent: vi.fn(),
  mockCallLLM: vi.fn(),
  mockGetLatestForCampaign: vi.fn(),
  mockGetReasoning: vi.fn(),
  mockRecordRing: vi.fn(),
  mockUpdateRingDecision: vi.fn(),
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
  updateRingDecision: mockUpdateRingDecision,
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
      primary_ring: { ring_label: "protocol recovery", analog_campaigns: ["ColdCo"] },
      lateral_rings: [{ ring_label: "overlanding", analog_campaigns: [] }],
    },
  },
  customer_description: "Recovery buyers.",
  aov_bucket: "high",
  scoring_weights: null,
};

const RINGS = [
  {
    id: "ring_1",
    kind: "primary",
    label: "protocol recovery",
    confidence: "high",
    reasoning: "ColdCo playbook.",
    brand_decision: "pending",
  },
  {
    id: "ring_2",
    kind: "lateral",
    label: "overlanding",
    confidence: "medium",
    reasoning: "Mobile use case.",
    brand_decision: "pending",
  },
];

function llmMessage(text: string, stopReason = "end_turn") {
  return { stop_reason: stopReason, content: [{ type: "text", text }] };
}

function refinedRingJSON() {
  return JSON.stringify({
    ring_label: "van-life & overlanding",
    confidence: "medium",
    reasoning: "Sharper on the vehicle-based audience the brand flagged.",
    analog_campaigns: [],
  });
}

function call(body: Record<string, unknown>, id = "camp_1") {
  const req = new Request(`http://x/api/campaigns/${id}/interpret/refine`, {
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
    rings: RINGS,
    convictionScores: [],
    analogs: [],
  });
  mockRecordRing.mockResolvedValue("ring_3");
  mockUpdateRingDecision.mockResolvedValue(true);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("POST /api/campaigns/[id]/interpret/refine", () => {
  it("inserts a new pending ring and marks the old one refined", async () => {
    mockCallLLM.mockResolvedValue(llmMessage(refinedRingJSON()));

    const res = await call({ ring_hypothesis_id: "ring_2", refinement_text: "more van-life" });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ring.ring_hypothesis_id).toBe("ring_3");
    expect(body.ring.ring_label).toBe("van-life & overlanding");

    expect(mockRecordRing).toHaveBeenCalledTimes(1);
    expect(mockRecordRing.mock.calls[0][0]).toMatchObject({
      campaignPatternId: "pat_1",
      kind: "lateral",
      brandDecision: "pending",
    });
    expect(mockUpdateRingDecision).toHaveBeenCalledWith("ring_2", "refined");
    expect(mockLogEvent.mock.calls[0][0].eventType).toBe(
      "brief.refinement_submitted"
    );
  });

  it("keeps primary kind when refining the primary ring", async () => {
    mockCallLLM.mockResolvedValue(llmMessage(refinedRingJSON()));
    await call({ ring_hypothesis_id: "ring_1", refinement_text: "tweak" });
    expect(mockRecordRing.mock.calls[0][0].kind).toBe("primary");
  });

  it("soft-fails on malformed LLM output without touching rings", async () => {
    mockCallLLM.mockResolvedValue(llmMessage("not json"));
    const res = await call({ ring_hypothesis_id: "ring_2", refinement_text: "x" });
    const body = await res.json();
    expect(body.error).toBe("refinement_failed");
    expect(body.reason).toBe("malformed_json");
    expect(mockRecordRing).not.toHaveBeenCalled();
    expect(mockUpdateRingDecision).not.toHaveBeenCalled();
  });

  it("soft-fails on refusal", async () => {
    mockCallLLM.mockResolvedValue(llmMessage("{}", "refusal"));
    const res = await call({ ring_hypothesis_id: "ring_2", refinement_text: "x" });
    const body = await res.json();
    expect(body.error).toBe("refinement_failed");
    expect(body.reason).toBe("refusal");
  });

  it("does not mark the old ring refined when the new ring fails to persist", async () => {
    mockCallLLM.mockResolvedValue(llmMessage(refinedRingJSON()));
    mockRecordRing.mockResolvedValue(null);
    const res = await call({ ring_hypothesis_id: "ring_2", refinement_text: "x" });
    const body = await res.json();
    expect(body.error).toBe("refinement_failed");
    expect(body.reason).toBe("persist_failed");
    expect(mockUpdateRingDecision).not.toHaveBeenCalled();
  });

  it("404s when the ring is not part of the campaign's pattern", async () => {
    mockCallLLM.mockResolvedValue(llmMessage(refinedRingJSON()));
    const res = await call({ ring_hypothesis_id: "ring_999", refinement_text: "x" });
    expect(res.status).toBe(404);
    expect(mockCallLLM).not.toHaveBeenCalled();
  });

  it("404s when the campaign belongs to another user", async () => {
    mockGetCampaignById.mockResolvedValue({ id: "camp_1", user_id: "someone_else" });
    const res = await call({ ring_hypothesis_id: "ring_2", refinement_text: "x" });
    expect(res.status).toBe(404);
  });
});
