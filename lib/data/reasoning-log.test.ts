import { describe, it, expect, vi, beforeEach } from "vitest";

// Hoisted mock harness. Each test reaches in to override the resolved
// values per-call. Two flavors: `insertChain` resolves at .single() (used
// by recordCampaignPattern / recordRingHypothesis which both call
// .insert().select().single()), and `directInsert` resolves at insert()
// itself (used by the void-returning helpers).
const { directInsert, insertChain, readers, supabaseAdmin } = vi.hoisted(() => {
  const insertChain = {
    select: vi.fn().mockReturnThis(),
    single: vi.fn(),
  };
  const directInsert = vi.fn();
  const readers = {
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    single: vi.fn(),
    select: vi.fn().mockReturnThis(),
  };
  // The default `from()` builder returns an object whose `insert()` returns
  // the chain (so `.select().single()` works) AND is itself thenable so
  // `await supabaseAdmin.from(t).insert(row)` resolves to {data,error}.
  const supabaseAdmin = {
    from: vi.fn(() => ({
      insert: (row: unknown) => {
        // Hold the row for assertion convenience
        directInsert(row);
        const chain = {
          ...insertChain,
          // Make insert() awaitable directly: forward to directInsert's mock
          // which the test populates with mockResolvedValueOnce.
          then: (resolve: (v: unknown) => unknown) =>
            Promise.resolve(directInsert.mock.results.at(-1)?.value ?? {
              data: null,
              error: null,
            }).then(resolve),
        };
        return chain;
      },
      select: readers.select,
      eq: readers.eq,
      order: readers.order,
      single: readers.single,
    })),
  };
  return { directInsert, insertChain, readers, supabaseAdmin };
});

vi.mock("@/lib/supabase/admin", () => ({ supabaseAdmin }));

import {
  recordCampaignPattern,
  recordRingHypothesis,
  recordConvictionScore,
  recordAnalogMatch,
  recordFounderAnnotation,
  getCampaignReasoning,
} from "./reasoning-log";

beforeEach(() => {
  vi.clearAllMocks();
  directInsert.mockReturnValue({ data: null, error: null });
  insertChain.single.mockResolvedValue({ data: { id: "row-1" }, error: null });
});

// ============================================================
// recordCampaignPattern
// ============================================================

describe("recordCampaignPattern", () => {
  it("returns the new row id when supabase succeeds", async () => {
    const id = await recordCampaignPattern({
      campaignId: "c1",
      customerId: "u1",
      productAttributes: { aov: 1200 },
      customerDescription: "luxury cold plunge",
      aovBucket: "high",
      scoringWeights: { audienceFit: 0.4 },
    });
    expect(id).toBe("row-1");
    expect(supabaseAdmin.from).toHaveBeenCalledWith("campaign_patterns");
    expect(directInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        campaign_id: "c1",
        customer_id: "u1",
        product_attributes: { aov: 1200 },
        customer_description: "luxury cold plunge",
        aov_bucket: "high",
        scoring_weights: { audienceFit: 0.4 },
      })
    );
  });

  it("returns null without inserting when customerId is missing", async () => {
    const id = await recordCampaignPattern({
      campaignId: "c1",
      customerId: null,
      productAttributes: {},
    });
    expect(id).toBeNull();
    expect(directInsert).not.toHaveBeenCalled();
  });

  it("returns null when supabase returns an error", async () => {
    insertChain.single.mockResolvedValueOnce({
      data: null,
      error: { message: "boom" },
    });
    const id = await recordCampaignPattern({
      campaignId: "c1",
      customerId: "u1",
      productAttributes: {},
    });
    expect(id).toBeNull();
  });

  it("never throws when supabase itself throws", async () => {
    supabaseAdmin.from.mockImplementationOnce(() => {
      throw new Error("network down");
    });
    await expect(
      recordCampaignPattern({
        campaignId: "c1",
        customerId: "u1",
        productAttributes: {},
      })
    ).resolves.toBeNull();
  });
});

// ============================================================
// recordRingHypothesis
// ============================================================

describe("recordRingHypothesis", () => {
  it("returns the new row id and inserts the right shape", async () => {
    const id = await recordRingHypothesis({
      campaignPatternId: "p1",
      kind: "primary",
      label: "biohacking-adjacent wellness",
      reasoning: "host uses cold plunge organically",
      confidence: "high",
      confidenceScore: 82,
      brandConfirmed: null,
    });
    expect(id).toBe("row-1");
    expect(directInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        campaign_pattern_id: "p1",
        kind: "primary",
        label: "biohacking-adjacent wellness",
        reasoning: "host uses cold plunge organically",
        confidence: "high",
        confidence_score: 82,
        brand_confirmed: null,
      })
    );
  });

  it("returns null when supabase returns an error", async () => {
    insertChain.single.mockResolvedValueOnce({
      data: null,
      error: { message: "boom" },
    });
    const id = await recordRingHypothesis({
      campaignPatternId: "p1",
      kind: "lateral",
      label: "performance recovery",
      confidence: "medium",
    });
    expect(id).toBeNull();
  });

  it("never throws when supabase throws", async () => {
    supabaseAdmin.from.mockImplementationOnce(() => {
      throw new Error("network down");
    });
    await expect(
      recordRingHypothesis({
        campaignPatternId: "p1",
        kind: "primary",
        label: "x",
        confidence: "low",
      })
    ).resolves.toBeNull();
  });
});

// ============================================================
// recordConvictionScore
// ============================================================

describe("recordConvictionScore", () => {
  it("inserts the row with the right shape", async () => {
    await recordConvictionScore({
      campaignPatternId: "p1",
      showId: "s1",
      ringHypothesisId: "r1",
      audienceFitScore: 70,
      topicalRelevanceScore: 80,
      purchasePowerScore: 65,
      compositeScore: 72,
      convictionBand: "high",
      reasoning: "solid match",
      tier: "scale",
    });
    expect(supabaseAdmin.from).toHaveBeenCalledWith("conviction_scores");
    expect(directInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        campaign_pattern_id: "p1",
        show_id: "s1",
        ring_hypothesis_id: "r1",
        audience_fit_score: 70,
        topical_relevance_score: 80,
        purchase_power_score: 65,
        composite_score: 72,
        conviction_band: "high",
        reasoning: "solid match",
        tier: "scale",
      })
    );
  });

  it("never throws when supabase returns an error", async () => {
    directInsert.mockReturnValueOnce({
      data: null,
      error: { message: "boom" },
    });
    await expect(
      recordConvictionScore({
        campaignPatternId: "p1",
        showId: "s1",
      })
    ).resolves.toBeUndefined();
  });

  it("never throws when supabase itself throws", async () => {
    supabaseAdmin.from.mockImplementationOnce(() => {
      throw new Error("network down");
    });
    await expect(
      recordConvictionScore({
        campaignPatternId: "p1",
        showId: "s1",
      })
    ).resolves.toBeUndefined();
  });
});

// ============================================================
// recordAnalogMatch
// ============================================================

describe("recordAnalogMatch", () => {
  it("inserts the row with the right shape", async () => {
    await recordAnalogMatch({
      campaignPatternId: "p1",
      analogName: "Plunge",
      reasoning: "same product category, same audience",
      similarityScore: 88,
    });
    expect(supabaseAdmin.from).toHaveBeenCalledWith("analog_matches");
    expect(directInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        campaign_pattern_id: "p1",
        analog_name: "Plunge",
        reasoning: "same product category, same audience",
        similarity_score: 88,
      })
    );
  });

  it("never throws when supabase itself throws", async () => {
    supabaseAdmin.from.mockImplementationOnce(() => {
      throw new Error("network down");
    });
    await expect(
      recordAnalogMatch({
        campaignPatternId: "p1",
        analogName: "Plunge",
      })
    ).resolves.toBeUndefined();
  });
});

// ============================================================
// recordFounderAnnotation
// ============================================================

describe("recordFounderAnnotation", () => {
  it("inserts the row with the right shape and defaults tags to []", async () => {
    await recordFounderAnnotation({
      showId: "s1",
      authorId: "u1",
      note: "host personally uses cold plunge",
    });
    expect(supabaseAdmin.from).toHaveBeenCalledWith("founder_annotations");
    expect(directInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        show_id: "s1",
        author_id: "u1",
        note: "host personally uses cold plunge",
        tags: [],
      })
    );
  });

  it("never throws when supabase itself throws", async () => {
    supabaseAdmin.from.mockImplementationOnce(() => {
      throw new Error("network down");
    });
    await expect(
      recordFounderAnnotation({
        showId: "s1",
        note: "n",
      })
    ).resolves.toBeUndefined();
  });
});

// ============================================================
// getCampaignReasoning
// ============================================================

describe("getCampaignReasoning", () => {
  it("returns empty structure when supabase throws", async () => {
    supabaseAdmin.from.mockImplementationOnce(() => {
      throw new Error("network down");
    });
    const result = await getCampaignReasoning("p1");
    expect(result).toEqual({
      pattern: null,
      rings: [],
      convictionScores: [],
      analogs: [],
    });
  });
});
