import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const {
  mockGetAuthenticatedUser,
  mockGetCampaignById,
  mockLogEvent,
  mockCallLLM,
  mockRetrieveAnalogs,
  mockPersistAtomic,
  mockGetPatternById,
  mockGetLatestForCampaign,
  mockGetReasoning,
  mockClaimLock,
  mockReleaseLock,
} = vi.hoisted(() => ({
  mockGetAuthenticatedUser: vi.fn(),
  mockGetCampaignById: vi.fn(),
  mockLogEvent: vi.fn(),
  mockCallLLM: vi.fn(),
  mockRetrieveAnalogs: vi.fn(),
  mockPersistAtomic: vi.fn(),
  mockGetPatternById: vi.fn(),
  mockGetLatestForCampaign: vi.fn(),
  mockGetReasoning: vi.fn(),
  mockClaimLock: vi.fn(),
  mockReleaseLock: vi.fn(),
}));

vi.mock("@/lib/data/queries", () => ({
  getAuthenticatedUser: mockGetAuthenticatedUser,
  getCampaignById: mockGetCampaignById,
}));

vi.mock("@/lib/data/events", () => ({
  logEvent: mockLogEvent,
}));

vi.mock("@/lib/llm/client", () => ({
  callLLMWithFallback: mockCallLLM,
  createLLMClient: vi.fn(() => ({})),
  loadPrompt: vi.fn(() => "system prompt"),
}));

vi.mock("@/lib/discovery/pattern-library-retrieval", () => ({
  retrieveAnalogCampaigns: mockRetrieveAnalogs,
}));

vi.mock("@/lib/data/reasoning-log", () => ({
  persistInterpretationAtomic: mockPersistAtomic,
  getCampaignPatternById: mockGetPatternById,
  getLatestCampaignPatternForCampaign: mockGetLatestForCampaign,
  getCampaignReasoning: mockGetReasoning,
}));

vi.mock("@/lib/data/interpretation-lock", () => ({
  claimInterpretation: mockClaimLock,
  releaseInterpretation: mockReleaseLock,
}));

import { POST } from "./route";

const USER = { id: "user_1", email: "brand@example.com" };
const SUBMITTED_AT = "2026-06-10T12:00:00.000Z";

const FRESH_BRIEF = {
  version: 2,
  product: {
    source: "url",
    url: "https://saunabox.com",
    brand_name: "SaunaBox",
    category: "premium wellness",
    product_description: "Portable infrared sauna kits for at-home recovery.",
    aov_bucket: "high",
    aov_reasoning: "Kits listed at $399-$2,799.",
    key_attributes: ["mobile use case", "premium price point"],
  },
  customer_text: "Affluent men 30-55 into recovery and biohacking.",
  goals: ["test_channel", "direct_response"],
  flight: { mode: "preset", preset: "next_30_days" },
  exclusions_text: "No competitor sauna brands.",
  submitted_at: SUBMITTED_AT,
};

const CAMPAIGN = {
  id: "camp_1",
  user_id: "user_1",
  budget_total: 25000,
  brief: FRESH_BRIEF,
};

// Pattern library rows the retrieval mock returns (analogs the LLM may cite).
const LIBRARY = [
  {
    id: "lib_1",
    campaign_id: null,
    customer_id: "founder",
    created_at: "2026-05-01T00:00:00.000Z",
    product_attributes: {
      brand_name: "ColdCo",
      category: "premium wellness",
      customer_summary: "Recovery-obsessed men with high disposable income.",
    },
    customer_description: "Cold plunge buyers.",
    aov_bucket: "high",
    scoring_weights: null,
  },
  {
    id: "lib_2",
    campaign_id: null,
    customer_id: "founder",
    created_at: "2026-04-01T00:00:00.000Z",
    product_attributes: {
      brand_name: "HeatWorks",
      category: "premium wellness",
    },
    customer_description: "Infrared mat buyers.",
    aov_bucket: "high",
    scoring_weights: null,
  },
];

// Deterministic LLM response fixtures (spec: no real API calls in CI).
function interpretation(overrides: Record<string, unknown> = {}) {
  return {
    campaign_pattern: {
      customer_summary:
        "Affluent men 30-55 already spending on premium recovery hardware.",
      interpretation_confidence: "high",
      exclusions_parsed: ["competitor sauna brands"],
    },
    primary_ring: {
      ring_label: "protocol-driven recovery & biohacking",
      confidence: "high",
      reasoning: "Matches the ColdCo playbook on purchase power.",
      analog_campaigns: ["ColdCo"],
    },
    lateral_rings: [
      {
        ring_label: "overlanding & van-life",
        confidence: "medium",
        reasoning: "Mobile use case opens vehicle-based audiences.",
        analog_campaigns: ["HeatWorks"],
      },
      {
        ring_label: "cold-climate remote workers",
        confidence: "speculative",
        reasoning: "Defensible hypothesis, nothing in the library.",
        analog_campaigns: [],
      },
    ],
    ...overrides,
  };
}

function lateral(label: string, confidence = "medium") {
  return {
    ring_label: label,
    confidence,
    reasoning: `Reasoning for ${label}.`,
    analog_campaigns: [],
  };
}

function llmMessage(text: string, stopReason = "end_turn") {
  return { stop_reason: stopReason, content: [{ type: "text", text }] };
}

function call(id = "camp_1") {
  const req = new Request(`http://x/api/campaigns/${id}/interpret`, {
    method: "POST",
  });
  return POST(req as never, { params: Promise.resolve({ id }) });
}

function llmUserContent(): string {
  return mockCallLLM.mock.calls[0][0].userContent;
}

// Input handed to the single atomic-persist call.
function persistInput() {
  return mockPersistAtomic.mock.calls[0][0];
}

// Default atomic-persist: derive ring ids from the rings array by label so
// the route can map ids back into the response (primary → ring_1, etc.).
function defaultPersist() {
  return async (input: {
    rings: Array<{ label: string }>;
  }): Promise<{ patternId: string; ringIds: Record<string, string> }> => {
    const ringIds: Record<string, string> = {};
    input.rings.forEach((r, i) => {
      ringIds[r.label] = `ring_${i + 1}`;
    });
    return { patternId: "pat_1", ringIds };
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
  mockGetAuthenticatedUser.mockResolvedValue(USER);
  mockGetCampaignById.mockResolvedValue(CAMPAIGN);
  mockLogEvent.mockResolvedValue(null);
  mockRetrieveAnalogs.mockResolvedValue(LIBRARY);
  mockPersistAtomic.mockImplementation(defaultPersist());
  mockGetLatestForCampaign.mockResolvedValue(null);
  mockGetPatternById.mockResolvedValue(null);
  mockGetReasoning.mockResolvedValue({
    pattern: null,
    rings: [],
    convictionScores: [],
    analogs: [],
  });
  mockClaimLock.mockResolvedValue("acquired");
  mockReleaseLock.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("POST /api/campaigns/[id]/interpret", () => {
  it("interprets a fresh brief with a seeded library: pattern, rings, analogs persisted", async () => {
    mockCallLLM.mockResolvedValue(llmMessage(JSON.stringify(interpretation())));

    const res = await call();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.campaign_pattern_id).toBe("pat_1");
    expect(body.campaign_pattern.customer_summary).toContain("Affluent men");
    expect(body.primary_ring.ring_label).toBe(
      "protocol-driven recovery & biohacking"
    );
    expect(body.primary_ring.ring_hypothesis_id).toBe("ring_1");
    expect(body.lateral_rings).toHaveLength(2);
    expect(body.lateral_rings[0].ring_hypothesis_id).toBe("ring_2");

    // Critical wiring: analogs retrieved by brand-confirmed derivations and
    // injected into the prompt's pattern library context, excluding the
    // campaign's own prior pattern rows.
    expect(mockRetrieveAnalogs).toHaveBeenCalledWith({
      aovBucket: "high",
      category: "premium wellness",
      excludeCampaignId: "camp_1",
    });
    expect(llmUserContent()).toContain("## Pattern library context");
    expect(llmUserContent()).toContain("ColdCo");
    expect(llmUserContent()).toContain("Recovery-obsessed men");

    // One atomic persist carries the pattern + all rings + all analogs.
    expect(mockPersistAtomic).toHaveBeenCalledTimes(1);
    const rings = persistInput().rings;
    expect(rings).toHaveLength(3);
    expect(rings[0]).toEqual(
      expect.objectContaining({
        kind: "primary",
        label: "protocol-driven recovery & biohacking",
        confidence: "high",
      })
    );
    expect(rings[1]).toEqual(
      expect.objectContaining({ kind: "lateral", label: "overlanding & van-life" })
    );
    // Both cited analogs exist in the library; each carries the FK back to the
    // library pattern it was retrieved from (migration 022).
    const analogs = persistInput().analogs;
    expect(analogs).toHaveLength(2);
    expect(analogs).toContainEqual(
      expect.objectContaining({ analogName: "ColdCo", analogPatternId: "lib_1" })
    );
    expect(analogs).toContainEqual(
      expect.objectContaining({
        analogName: "HeatWorks",
        analogPatternId: "lib_2",
      })
    );
    expect(mockLogEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "brief.interpretation_completed",
        entityId: "camp_1",
        payload: expect.objectContaining({
          campaign_pattern_id: "pat_1",
          interpretation_confidence: "high",
        }),
      })
    );
  });

  it("handles an empty library: pattern + rings persist, zero analog rows, first-principles prompt", async () => {
    mockRetrieveAnalogs.mockResolvedValue([]);
    mockCallLLM.mockResolvedValue(
      llmMessage(
        JSON.stringify(
          interpretation({
            primary_ring: {
              ...interpretation().primary_ring,
              analog_campaigns: [],
              confidence: "speculative",
            },
            lateral_rings: [lateral("endurance athletes", "low")],
          })
        )
      )
    );

    const body = await (await call()).json();

    expect(body.campaign_pattern_id).toBe("pat_1");
    expect(mockPersistAtomic).toHaveBeenCalledTimes(1);
    expect(persistInput().rings).toHaveLength(2);
    expect(persistInput().analogs).toHaveLength(0);
    expect(llmUserContent()).toContain(
      "Pattern library is empty — reason from first principles"
    );
  });

  it("persists all rings when the LLM returns 5", async () => {
    mockCallLLM.mockResolvedValue(
      llmMessage(
        JSON.stringify(
          interpretation({
            lateral_rings: [
              lateral("ring a"),
              lateral("ring b"),
              lateral("ring c"),
              lateral("ring d"),
            ],
          })
        )
      )
    );

    const body = await (await call()).json();

    expect(body.lateral_rings).toHaveLength(4);
    expect(persistInput().rings).toHaveLength(5); // primary + 4
  });

  it("persists all rings with a warning when the LLM exceeds the soft cap", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    mockCallLLM.mockResolvedValue(
      llmMessage(
        JSON.stringify(
          interpretation({
            lateral_rings: [
              lateral("ring a"),
              lateral("ring b"),
              lateral("ring c"),
              lateral("ring d"),
              lateral("ring e"),
              lateral("ring f"),
              lateral("ring g"),
            ],
          })
        )
      )
    );

    const body = await (await call()).json();

    expect(body.lateral_rings).toHaveLength(7); // no truncation
    expect(persistInput().rings).toHaveLength(8);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("soft cap"));
  });

  it("skips analog rows for cited brands not in the library, with a warning", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    mockCallLLM.mockResolvedValue(
      llmMessage(
        JSON.stringify(
          interpretation({
            primary_ring: {
              ...interpretation().primary_ring,
              analog_campaigns: ["ColdCo", "Plunge"], // Plunge not in library
            },
          })
        )
      )
    );

    await call();

    const analogs = persistInput().analogs;
    expect(analogs).toHaveLength(2); // ColdCo + HeatWorks only
    expect(
      analogs.some((a: { analogName: string }) => a.analogName === "Plunge")
    ).toBe(false);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('"Plunge" not in the pattern library context')
    );
  });

  it("still returns the interpretation when persistence fails", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockPersistAtomic.mockResolvedValue(null);
    mockCallLLM.mockResolvedValue(llmMessage(JSON.stringify(interpretation())));

    const res = await call();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.campaign_pattern_id).toBeNull();
    expect(body.primary_ring.ring_label).toBe(
      "protocol-driven recovery & biohacking"
    );
    expect(body.primary_ring.ring_hypothesis_id).toBeNull();
    expect(errorSpy).toHaveBeenCalled();
  });

  it("returns interpretation_failed on malformed JSON with zero persistence", async () => {
    mockCallLLM.mockResolvedValue(
      llmMessage("Here's my read of the brief: {campaign")
    );

    const res = await call();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({
      error: "interpretation_failed",
      reason: "malformed_json",
    });
    expect(mockPersistAtomic).not.toHaveBeenCalled();
    expect(mockLogEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "brief.interpretation_failed",
        payload: { reason: "malformed_json" },
      })
    );
  });

  it("returns interpretation_failed when the LLM still refuses after fallback", async () => {
    // callLLMWithFallback owns the retry; a refusal stop_reason here means
    // both the configured model and the fallback refused.
    mockCallLLM.mockResolvedValue(llmMessage("", "refusal"));

    const body = await (await call()).json();

    expect(body).toEqual({ error: "interpretation_failed", reason: "refusal" });
    expect(mockPersistAtomic).not.toHaveBeenCalled();
  });

  it("stores AOV-tilted effective weights for a high-AOV brief", async () => {
    mockCallLLM.mockResolvedValue(llmMessage(JSON.stringify(interpretation())));

    await call();

    const input = persistInput();
    expect(input.aovBucket).toBe("high");
    expect(input.scoringWeights).toEqual(
      expect.objectContaining({ purchasePower: 0.2, reach: 0.05 })
    );
    expect(input.productAttributes).toEqual(
      expect.objectContaining({
        customer_summary:
          "Affluent men 30-55 already spending on premium recovery hardware.",
        interpretation_confidence: "high",
        brief_context: expect.objectContaining({
          goals: ["test_channel", "direct_response"],
          budget_total: 25000,
          exclusions_text: "No competitor sauna brands.",
          // Server-side parse of the raw text — not the LLM's version.
          exclusions_parsed: ["No competitor sauna brands."],
        }),
      })
    );
  });

  it("keeps legacy 4-dimension weights for a mid-AOV brief", async () => {
    mockGetCampaignById.mockResolvedValue({
      ...CAMPAIGN,
      brief: {
        ...FRESH_BRIEF,
        product: { ...FRESH_BRIEF.product, aov_bucket: "mid" },
      },
    });
    mockCallLLM.mockResolvedValue(llmMessage(JSON.stringify(interpretation())));

    await call();

    expect(persistInput().scoringWeights).toEqual({
      audienceFit: 0.4,
      adEngagement: 0.3,
      sponsorRetention: 0.2,
      reach: 0.1,
    });
  });

  it("round-trips all confidence values and normalizes invalid ones to speculative", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    mockCallLLM.mockResolvedValue(
      llmMessage(
        JSON.stringify(
          interpretation({
            lateral_rings: [
              lateral("ring medium", "medium"),
              lateral("ring low", "low"),
              lateral("ring speculative", "speculative"),
              lateral("ring invalid", "certain"),
            ],
          })
        )
      )
    );

    await call();

    const confidences = persistInput().rings.map(
      (r: { confidence: string }) => r.confidence
    );
    expect(confidences).toEqual([
      "high", // primary
      "medium",
      "low",
      "speculative",
      "speculative", // "certain" normalized
    ]);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("invalid confidence"),
      "certain"
    );
  });

  it("interprets a returning-brand brief: prior derivations drive retrieval, new values are canonical", async () => {
    const PRIOR_PATTERN = {
      id: "pat_prior",
      campaign_id: "camp_old",
      customer_id: "user_1",
      created_at: "2026-03-01T00:00:00.000Z",
      product_attributes: {
        brand_name: "SaunaBox",
        category: "premium wellness",
        product_description: "Portable infrared sauna kits.",
        aov_bucket: "high",
        aov_reasoning: "Kits at $399-$2,799.",
        key_attributes: ["mobile use case"],
        customer_summary: "Affluent recovery-focused men 30-55.",
      },
      customer_description: "Men into recovery.",
      aov_bucket: "high",
      scoring_weights: null,
    };
    mockGetPatternById.mockResolvedValue(PRIOR_PATTERN);
    mockGetCampaignById.mockResolvedValue({
      ...CAMPAIGN,
      brief: {
        version: 2,
        customer_text: "Now also seeing lots of women 25-40 buying for home spas.",
        customer_context: {
          reused_from_pattern_id: "pat_prior",
          changed_fields: {
            customer_description: {
              before: "Men into recovery.",
              after: "Now also seeing lots of women 25-40 buying for home spas.",
            },
          },
        },
        goals: ["scale_winner"],
        flight: { mode: "preset", preset: "asap" },
        exclusions_text: "No competitor wellness brands.",
        submitted_at: SUBMITTED_AT,
      },
    });
    mockCallLLM.mockResolvedValue(llmMessage(JSON.stringify(interpretation())));

    await call();

    expect(mockGetPatternById).toHaveBeenCalledWith("pat_prior");
    // Retrieval queried with the prior pattern's brand-confirmed derivations.
    expect(mockRetrieveAnalogs).toHaveBeenCalledWith({
      aovBucket: "high",
      category: "premium wellness",
      excludeCampaignId: "camp_1",
    });
    const content = llmUserContent();
    // New full top-level values are canonical in the prompt...
    expect(content).toContain("women 25-40 buying for home spas");
    expect(content).toContain("No competitor wellness brands.");
    // ...and the changes record rides along as audit context.
    expect(content).toContain("## Returning-brand context");
    expect(content).toContain("Affluent recovery-focused men 30-55.");
    expect(content).toContain(
      '- customer_description: before "Men into recovery." → after "Now also seeing lots of women 25-40 buying for home spas."'
    );
    // The new pattern records the canonical customer text.
    expect(persistInput().customerDescription).toContain("women 25-40");
  });

  it("falls back to prior pattern values when a returning brand changed nothing", async () => {
    mockGetPatternById.mockResolvedValue({
      id: "pat_prior",
      campaign_id: "camp_old",
      customer_id: "user_1",
      created_at: "2026-03-01T00:00:00.000Z",
      product_attributes: {
        brand_name: "SaunaBox",
        category: "premium wellness",
        product_description: "Portable infrared sauna kits.",
        aov_bucket: "high",
        aov_reasoning: "",
        key_attributes: [],
        customer_summary: "Affluent recovery-focused men 30-55.",
      },
      customer_description: "Men into recovery.",
      aov_bucket: "high",
      scoring_weights: null,
    });
    mockGetCampaignById.mockResolvedValue({
      ...CAMPAIGN,
      brief: {
        version: 2,
        customer_context: { reused_from_pattern_id: "pat_prior" },
        goals: ["test_channel"],
        flight: { mode: "preset", preset: "next_30_days" },
        submitted_at: SUBMITTED_AT,
      },
    });
    mockCallLLM.mockResolvedValue(llmMessage(JSON.stringify(interpretation())));

    await call();

    const content = llmUserContent();
    expect(content).toContain("Men into recovery."); // prior raw description
    expect(content).toContain("Delta since last campaign: no changes reported.");
    expect(persistInput().customerDescription).toBe("Men into recovery.");
  });

  it("runs fresh when the latest pattern predates the brief submission", async () => {
    mockGetLatestForCampaign.mockResolvedValue({
      id: "pat_stale",
      campaign_id: "camp_1",
      customer_id: "user_1",
      created_at: "2026-06-09T00:00:00.000Z", // before submitted_at
      product_attributes: { interpretation: interpretation() },
      customer_description: null,
      aov_bucket: "high",
      scoring_weights: null,
    });
    mockCallLLM.mockResolvedValue(llmMessage(JSON.stringify(interpretation())));

    const body = await (await call()).json();

    expect(mockCallLLM).toHaveBeenCalledTimes(1);
    expect(body.campaign_pattern_id).toBe("pat_1");
  });

  it("returns 401 / 404 / 400 on auth, ownership, and unsubmitted-brief failures", async () => {
    mockGetAuthenticatedUser.mockResolvedValueOnce(null);
    expect((await call()).status).toBe(401);

    mockGetCampaignById.mockResolvedValueOnce({
      ...CAMPAIGN,
      user_id: "someone_else",
    });
    expect((await call()).status).toBe(404);

    mockGetCampaignById.mockResolvedValueOnce({
      ...CAMPAIGN,
      brief: { version: 2 }, // draft, never submitted
    });
    const res = await call();
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("brief_not_submitted");
  });
});

// ============================================================
// Layer 4 amendment — Codex review fixes (lock lifecycle)
// ============================================================

// Ring ids matching the interpretation() fixture's labels — used to align a
// winner's atomic-persist result with a loser's replay so the two responses
// are identical.
const FIXTURE_RING_IDS = {
  "protocol-driven recovery & biohacking": "ring_a",
  "overlanding & van-life": "ring_b",
  "cold-climate remote workers": "ring_c",
};
const FIXTURE_REASONING_RINGS = [
  { id: "ring_a", label: "protocol-driven recovery & biohacking" },
  { id: "ring_b", label: "overlanding & van-life" },
  { id: "ring_c", label: "cold-climate remote workers" },
];

// A pattern row the "winner" of a concurrent race persisted: created after
// submitted_at, carrying the stored interpretation blob for replay. Its
// exclusions_parsed matches the server-side parse of FRESH_BRIEF.exclusions_text
// so a replayed response is byte-identical to the winner's built response.
const COMPLETED_PATTERN = {
  id: "pat_done",
  campaign_id: "camp_1",
  customer_id: "user_1",
  created_at: "2026-06-10T12:05:00.000Z",
  product_attributes: {
    brand_name: "SaunaBox",
    interpretation: interpretation({
      campaign_pattern: {
        ...interpretation().campaign_pattern,
        exclusions_parsed: ["No competitor sauna brands."],
      },
    }),
  },
  customer_description: "Affluent men 30-55.",
  aov_bucket: "high",
  scoring_weights: null,
};

const PRIOR_PATTERN_BASE = {
  id: "pat_prior",
  campaign_id: "camp_old",
  customer_id: "user_1",
  created_at: "2026-03-01T00:00:00.000Z",
  product_attributes: {
    brand_name: "SaunaBox",
    category: "premium wellness",
    product_description: "Portable infrared sauna kits.",
    aov_bucket: "high",
    aov_reasoning: "",
    key_attributes: ["mobile use case"],
    customer_summary: "Affluent recovery-focused men 30-55.",
  },
  customer_description: "Men into recovery.",
  aov_bucket: "high",
  scoring_weights: null,
};

describe("POST /api/campaigns/[id]/interpret — Layer 4 amendment", () => {
  it("concurrent double-POST returns identical, complete interpretations", async () => {
    vi.useFakeTimers();
    try {
      // First request wins the sentinel claim; second sees "exists".
      mockClaimLock
        .mockResolvedValueOnce("acquired")
        .mockResolvedValue("exists");
      mockCallLLM.mockResolvedValue(
        llmMessage(JSON.stringify(interpretation()))
      );
      // The winner persists atomically as pat_done with ids aligned to the
      // fixture; the loser replays that same row.
      mockPersistAtomic.mockResolvedValue({
        patternId: "pat_done",
        ringIds: FIXTURE_RING_IDS,
      });
      mockGetReasoning.mockResolvedValue({
        pattern: null,
        rings: FIXTURE_REASONING_RINGS,
        convictionScores: [],
        analogs: [],
      });
      // Replay-guard reads (both requests) see nothing; the loser's poll after
      // the wait interval finds the winner's persisted row.
      mockGetLatestForCampaign
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        .mockResolvedValue(COMPLETED_PATTERN);

      const winner = call();
      const loser = call();
      await vi.advanceTimersByTimeAsync(2000);
      const [res1, res2] = await Promise.all([winner, loser]);
      const [body1, body2] = [await res1.json(), await res2.json()];

      // Exactly one LLM call and one atomic persist across both requests.
      expect(mockCallLLM).toHaveBeenCalledTimes(1);
      expect(mockPersistAtomic).toHaveBeenCalledTimes(1);
      expect(mockClaimLock).toHaveBeenCalledTimes(2);
      expect(res1.status).toBe(200);
      expect(res2.status).toBe(200);

      // Both responses are identical AND complete (every ring carries an id).
      expect(body1).toEqual(body2);
      for (const body of [body1, body2]) {
        expect(body.campaign_pattern_id).toBe("pat_done");
        expect(body.primary_ring.ring_hypothesis_id).toBe("ring_a");
        expect(
          body.lateral_rings.map(
            (r: { ring_hypothesis_id: string | null }) => r.ring_hypothesis_id
          )
        ).toEqual(["ring_b", "ring_c"]);
        expect(
          [body.primary_ring, ...body.lateral_rings].every(
            (r: { ring_hypothesis_id: string | null }) =>
              r.ring_hypothesis_id !== null
          )
        ).toBe(true);
      }
      // Success keeps the sentinel — the replay guard owns refreshes.
      expect(mockReleaseLock).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("partial-write recovery: after an orphaned crash, the retry reclaims and re-interprets", async () => {
    // A prior request claimed the lock then crashed mid-write — the process
    // died before the atomic persist committed or the lock was released,
    // leaving an orphan with no pattern row. The TTL steal that frees that
    // orphan is unit-tested in interpretation-lock.test.ts; here the expired
    // lock has been stolen, so the retry's claim succeeds and a fresh
    // interpretation runs to completion.
    mockGetLatestForCampaign.mockResolvedValue(null); // crash left no pattern row
    mockClaimLock.mockResolvedValue("acquired"); // orphan stolen → reclaimed
    mockCallLLM.mockResolvedValue(llmMessage(JSON.stringify(interpretation())));

    const res = await call();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(mockCallLLM).toHaveBeenCalledTimes(1);
    expect(mockPersistAtomic).toHaveBeenCalledTimes(1);
    expect(body.campaign_pattern_id).toBe("pat_1");
    expect(body.primary_ring.ring_hypothesis_id).toBe("ring_1");
    expect(
      [body.primary_ring, ...body.lateral_rings].every(
        (r: { ring_hypothesis_id: string | null }) => r.ring_hypothesis_id !== null
      )
    ).toBe(true);
    // Success keeps the sentinel.
    expect(mockReleaseLock).not.toHaveBeenCalled();
  });

  it("idempotent replay after completion: no LLM call, no re-persist, same result", async () => {
    // A completed interpretation already exists for this brief version.
    mockGetLatestForCampaign.mockResolvedValue(COMPLETED_PATTERN);
    mockGetReasoning.mockResolvedValue({
      pattern: null,
      rings: FIXTURE_REASONING_RINGS,
      convictionScores: [],
      analogs: [],
    });

    const res = await call();
    const body = await res.json();

    expect(res.status).toBe(200);
    // The replay guard short-circuits before the LLM, the persist, and even
    // the lock claim.
    expect(mockCallLLM).not.toHaveBeenCalled();
    expect(mockPersistAtomic).not.toHaveBeenCalled();
    expect(mockClaimLock).not.toHaveBeenCalled();
    expect(body.campaign_pattern_id).toBe("pat_done");
    expect(body.primary_ring.ring_hypothesis_id).toBe("ring_a");
    expect(body.lateral_rings.map((r: { ring_label: string }) => r.ring_label)).toEqual([
      "overlanding & van-life",
      "cold-climate remote workers",
    ]);
  });

  it("releases the sentinel on LLM failure so refresh can retry", async () => {
    mockCallLLM.mockRejectedValue(new Error("api down"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const body = await (await call()).json();

    expect(body).toEqual({ error: "interpretation_failed", reason: "llm_error" });
    expect(mockReleaseLock).toHaveBeenCalledWith("camp_1", SUBMITTED_AT);
    expect(errorSpy).toHaveBeenCalled();
  });

  it("releases the sentinel when persistence fails (no replayable row)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mockPersistAtomic.mockResolvedValue(null);
    mockCallLLM.mockResolvedValue(llmMessage(JSON.stringify(interpretation())));

    const body = await (await call()).json();

    expect(body.campaign_pattern_id).toBeNull();
    expect(mockReleaseLock).toHaveBeenCalledWith("camp_1", SUBMITTED_AT);
  });

  it("returning brand with changed product: confirmed re-derivation drives retrieval and persistence", async () => {
    mockGetPatternById.mockResolvedValue(PRIOR_PATTERN_BASE);
    mockGetCampaignById.mockResolvedValue({
      ...CAMPAIGN,
      brief: {
        version: 2,
        customer_context: {
          reused_from_pattern_id: "pat_prior",
          product_url: "https://homespa.com",
          changed_fields: {
            product_url: {
              before: "https://saunabox.com",
              after: "https://homespa.com",
            },
          },
          // Brand-confirmed re-derivation from the new URL — canonical
          // over the prior pattern's attributes.
          product_attributes: {
            brand_name: "SaunaBox",
            category: "home spa equipment",
            product_description: "Built-in home spa and sauna installs.",
            aov_bucket: "mid",
            aov_reasoning: "Installs from $150.",
            key_attributes: ["home install"],
          },
        },
        goals: ["scale_winner"],
        flight: { mode: "preset", preset: "asap" },
        submitted_at: SUBMITTED_AT,
      },
    });
    mockCallLLM.mockResolvedValue(llmMessage(JSON.stringify(interpretation())));

    await call();

    // Retrieval keyed off the NEW derivation, not the prior pattern.
    expect(mockRetrieveAnalogs).toHaveBeenCalledWith({
      aovBucket: "mid",
      category: "home spa equipment",
      excludeCampaignId: "camp_1",
    });
    expect(llmUserContent()).toContain("home spa equipment");
    const input = persistInput();
    expect(input.aovBucket).toBe("mid");
    expect(input.productAttributes).toEqual(
      expect.objectContaining({ category: "home spa equipment" })
    );
  });

  it("fails with a security warning when the reused pattern belongs to another user", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    mockGetPatternById.mockResolvedValue({
      ...PRIOR_PATTERN_BASE,
      customer_id: "someone_else",
    });
    mockGetCampaignById.mockResolvedValue({
      ...CAMPAIGN,
      brief: {
        version: 2,
        customer_context: { reused_from_pattern_id: "pat_prior" },
        goals: ["test_channel"],
        flight: { mode: "preset", preset: "asap" },
        submitted_at: SUBMITTED_AT,
      },
    });

    const res = await call();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({
      error: "interpretation_failed",
      reason: "reused_pattern_forbidden",
    });
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("SECURITY"));
    expect(mockCallLLM).not.toHaveBeenCalled();
    expect(mockPersistAtomic).not.toHaveBeenCalled();
    expect(mockReleaseLock).toHaveBeenCalledWith("camp_1", SUBMITTED_AT);
    expect(mockLogEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "brief.interpretation_failed",
        payload: { reason: "reused_pattern_forbidden" },
      })
    );
  });

  it("returns 503 NO_API_KEY when ANTHROPIC_API_KEY is missing", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");

    const res = await call();
    const body = await res.json();

    expect(res.status).toBe(503);
    expect(body.code).toBe("NO_API_KEY");
    expect(mockCallLLM).not.toHaveBeenCalled();
    expect(mockReleaseLock).toHaveBeenCalledWith("camp_1", SUBMITTED_AT);
  });

  it("parses exclusions server-side, ignoring whatever the LLM emitted", async () => {
    mockGetCampaignById.mockResolvedValue({
      ...CAMPAIGN,
      brief: {
        ...FRESH_BRIEF,
        exclusions_text: "Plunge, Therabody; also\nBig Sauna, plunge",
      },
    });
    mockCallLLM.mockResolvedValue(
      llmMessage(
        JSON.stringify(
          interpretation({
            campaign_pattern: {
              ...interpretation().campaign_pattern,
              exclusions_parsed: ["HALLUCINATED ENTRY"],
            },
          })
        )
      )
    );

    const body = await (await call()).json();

    const expected = ["Plunge", "Therabody", "also", "Big Sauna"];
    expect(body.campaign_pattern.exclusions_parsed).toEqual(expected);
    expect(
      persistInput().productAttributes.brief_context.exclusions_parsed
    ).toEqual(expected);
  });

  it("accepts zero lateral rings with a warning", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    mockCallLLM.mockResolvedValue(
      llmMessage(JSON.stringify(interpretation({ lateral_rings: [] })))
    );

    const res = await call();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.lateral_rings).toEqual([]);
    expect(persistInput().rings).toHaveLength(1); // primary only
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("zero lateral rings")
    );
  });

  it("runs fresh on a malformed submitted_at instead of colliding with replay", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    mockGetCampaignById.mockResolvedValue({
      ...CAMPAIGN,
      brief: { ...FRESH_BRIEF, submitted_at: "not-a-timestamp" },
    });
    // A stored row exists — an unguarded NaN comparison could misfire here.
    mockGetLatestForCampaign.mockResolvedValue(COMPLETED_PATTERN);
    mockCallLLM.mockResolvedValue(llmMessage(JSON.stringify(interpretation())));

    const body = await (await call()).json();

    expect(mockCallLLM).toHaveBeenCalledTimes(1); // fresh run, no replay
    expect(body.campaign_pattern_id).toBe("pat_1");
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("not a parseable timestamp"),
      "not-a-timestamp"
    );
    expect(mockClaimLock).toHaveBeenCalledWith("camp_1", "not-a-timestamp");
  });

  it("normalizes an unnormalized aov_bucket before retrieval, weights, and persistence", async () => {
    mockGetCampaignById.mockResolvedValue({
      ...CAMPAIGN,
      brief: {
        ...FRESH_BRIEF,
        product: { ...FRESH_BRIEF.product, aov_bucket: " HIGH " },
      },
    });
    mockCallLLM.mockResolvedValue(llmMessage(JSON.stringify(interpretation())));

    await call();

    expect(mockRetrieveAnalogs).toHaveBeenCalledWith(
      expect.objectContaining({ aovBucket: "high" })
    );
    const input = persistInput();
    expect(input.aovBucket).toBe("high");
    expect(input.scoringWeights).toEqual(
      expect.objectContaining({ purchasePower: 0.2 })
    );
  });
});
