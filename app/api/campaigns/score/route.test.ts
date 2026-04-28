import { describe, it, expect, vi, beforeEach } from "vitest";

// Mocks must be declared before the route import so vi.mock hoisting takes effect.
const getAuthenticatedUser = vi.fn();
const ensureProfile = vi.fn();
const createCampaign = vi.fn();
const updateCampaignScoredShows = vi.fn();
const scoreShows = vi.fn();
const anthropicCreate = vi.fn();

vi.mock("@/lib/data/queries", () => ({
  getAuthenticatedUser: (...args: unknown[]) => getAuthenticatedUser(...args),
  ensureProfile: (...args: unknown[]) => ensureProfile(...args),
  createCampaign: (...args: unknown[]) => createCampaign(...args),
  updateCampaignScoredShows: (...args: unknown[]) => updateCampaignScoredShows(...args),
}));

vi.mock("@/lib/scoring", () => ({
  scoreShows: (...args: unknown[]) => scoreShows(...args),
}));

vi.mock("@/lib/data/event-log", () => ({
  recordEvent: vi.fn(),
}));

vi.mock("@anthropic-ai/sdk", () => {
  return {
    default: class {
      messages = {
        create: (...args: unknown[]) => anthropicCreate(...args),
      };
    },
  };
});

import { POST } from "./route";

function jsonRequest(body: unknown): Request {
  return new Request("http://x/api/campaigns/score", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function okScoringResult() {
  return {
    shows: [],
    meta: {
      candidatesFound: 0,
      candidatesScored: 0,
      sourceCounts: {},
      durationMs: 1,
      errors: [],
    },
  };
}

describe("POST /api/campaigns/score — brief parser fallback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ANTHROPIC_API_KEY = "test-key";
    getAuthenticatedUser.mockResolvedValue({ id: "u1", email: "u@x.co" });
    ensureProfile.mockResolvedValue({});
    createCampaign.mockResolvedValue({ id: "c1" });
    updateCampaignScoredShows.mockResolvedValue(true);
    scoreShows.mockResolvedValue(okScoringResult());
  });

  it("returns a user-friendly 503 — not the raw API error — when Claude throws and no fallback signal exists", async () => {
    anthropicCreate.mockRejectedValue(new Error("credit balance too low"));

    // No legacy structured fields at all.
    const res = await POST(
      jsonRequest({
        name: "Test",
        budget_total: 5000,
        platforms: ["podcast"],
        brief_text: "we sell saunas to tech workers",
      }) as unknown as Parameters<typeof POST>[0]
    );

    expect(res.status).toBe(503);
    const data = await res.json();
    expect(data.error).toContain("temporary issue");
    expect(data.error).not.toContain("credit balance");
  });

  it("falls back to legacy structured fields when Claude throws and signal exists", async () => {
    anthropicCreate.mockRejectedValue(new Error("rate limit exceeded"));

    const res = await POST(
      jsonRequest({
        name: "Test",
        budget_total: 5000,
        platforms: ["podcast"],
        brief_text: "we sell saunas",
        target_interests: ["Health & Wellness"],
        keywords: ["wellness"],
      }) as unknown as Parameters<typeof POST>[0]
    );

    expect(res.status).toBe(200);
    expect(scoreShows).toHaveBeenCalledOnce();
    const briefArg = scoreShows.mock.calls[0][0];
    expect(briefArg.target_interests).toEqual(["Health & Wellness"]);
    expect(briefArg.keywords).toEqual(["wellness"]);
  });

  it("falls back when ANTHROPIC_API_KEY is missing but signal exists", async () => {
    delete process.env.ANTHROPIC_API_KEY;

    const res = await POST(
      jsonRequest({
        name: "Test",
        budget_total: 5000,
        platforms: ["podcast"],
        brief_text: "anything",
        target_interests: ["Fitness"],
      }) as unknown as Parameters<typeof POST>[0]
    );

    expect(res.status).toBe(200);
    expect(anthropicCreate).not.toHaveBeenCalled();
  });

  it("never exposes raw Claude error messages to the user on scoring failure", async () => {
    anthropicCreate.mockResolvedValue({
      content: [
        {
          type: "text",
          text: JSON.stringify({
            target_interests: ["Fitness"],
            keywords: ["wellness"],
            target_age_range: "30-45",
            target_gender: "mostly_men",
            campaign_goals: "drive sales",
          }),
        },
      ],
    });
    scoreShows.mockRejectedValue(new Error("Podscan API key invalid: sk_abc123"));

    const res = await POST(
      jsonRequest({
        name: "Test",
        budget_total: 5000,
        platforms: ["podcast"],
        brief_text: "we sell saunas",
      }) as unknown as Parameters<typeof POST>[0]
    );

    expect(res.status).toBe(500);
    const data = await res.json();
    expect(data.error).toContain("temporary issue");
    expect(data.error).not.toContain("sk_abc123");
    expect(data.error).not.toContain("Podscan");
  });
});
