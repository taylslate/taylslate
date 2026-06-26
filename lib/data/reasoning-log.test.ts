import { describe, it, expect, vi, beforeEach } from "vitest";

// Hoisted mock harness. Each test reaches in to override the resolved
// values per-call. Two flavors: `insertChain` resolves at .single() (used
// by recordCampaignPattern / recordRingHypothesis which both call
// .insert().select().single()), and `directInsert` resolves at insert()
// itself (used by the void-returning helpers).
const { directInsert, insertChain, readers, rpc, supabaseAdmin } = vi.hoisted(() => {
  const rpc = vi.fn();
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
    rpc,
  };
  return { directInsert, insertChain, readers, rpc, supabaseAdmin };
});

vi.mock("@/lib/supabase/admin", () => ({ supabaseAdmin }));

import {
  recordCampaignPattern,
  recordRingHypothesis,
  recordConvictionScore,
  recordAnalogMatch,
  recordFounderAnnotation,
  getFounderAnnotationsForShows,
  deleteFounderAnnotation,
  getCampaignReasoning,
  persistInterpretationAtomic,
  persistRefinementAtomic,
  persistConfirmationAtomic,
  updateScaleShowCuration,
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
        brand_decision: "pending",
      })
    );
  });

  it("forwards an explicit brandDecision to the insert", async () => {
    await recordRingHypothesis({
      campaignPatternId: "p1",
      kind: "lateral",
      label: "overlanders",
      confidence: "low",
      brandDecision: "added_by_brand",
    });
    expect(directInsert).toHaveBeenCalledWith(
      expect.objectContaining({ brand_decision: "added_by_brand" })
    );
  });

  it("forwards slotPosition to the insert (add-ring path)", async () => {
    await recordRingHypothesis({
      campaignPatternId: "p1",
      kind: "lateral",
      label: "busy parents",
      confidence: "medium",
      brandDecision: "added_by_brand",
      slotPosition: 4,
    });
    expect(directInsert).toHaveBeenCalledWith(
      expect.objectContaining({ slot_position: 4 })
    );
  });

  it("defaults slot_position to null when omitted", async () => {
    await recordRingHypothesis({
      campaignPatternId: "p1",
      kind: "primary",
      label: "x",
      confidence: "high",
    });
    expect(directInsert).toHaveBeenCalledWith(
      expect.objectContaining({ slot_position: null })
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
  it("inserts the row with the right shape, defaults tags to [], returns the id", async () => {
    const id = await recordFounderAnnotation({
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
    expect(id).toBe("row-1");
  });

  it("returns null (never throws) when supabase itself throws", async () => {
    supabaseAdmin.from.mockImplementationOnce(() => {
      throw new Error("network down");
    });
    await expect(
      recordFounderAnnotation({
        showId: "s1",
        note: "n",
      })
    ).resolves.toBeNull();
  });
});

// ============================================================
// getFounderAnnotationsForShows
// ============================================================

describe("getFounderAnnotationsForShows", () => {
  it("returns {} for an empty id list without hitting the DB", async () => {
    const result = await getFounderAnnotationsForShows([]);
    expect(result).toEqual({});
    expect(supabaseAdmin.from).not.toHaveBeenCalled();
  });

  it("groups rows by show_id", async () => {
    const order = vi.fn().mockResolvedValue({
      data: [
        { id: "a1", show_id: "s1", note: "n1", tags: [], created_at: "t2" },
        { id: "a2", show_id: "s2", note: "n2", tags: [], created_at: "t1" },
        { id: "a3", show_id: "s1", note: "n3", tags: [], created_at: "t0" },
      ],
      error: null,
    });
    const inFn = vi.fn(() => ({ order }));
    const select = vi.fn(() => ({ in: inFn }));
    supabaseAdmin.from.mockImplementationOnce(() => ({ select }) as never);

    const result = await getFounderAnnotationsForShows(["s1", "s2"]);
    expect(supabaseAdmin.from).toHaveBeenCalledWith("founder_annotations");
    expect(inFn).toHaveBeenCalledWith("show_id", ["s1", "s2"]);
    expect(result.s1.map((r) => r.id)).toEqual(["a1", "a3"]);
    expect(result.s2.map((r) => r.id)).toEqual(["a2"]);
  });

  it("returns {} on a read error", async () => {
    const order = vi
      .fn()
      .mockResolvedValue({ data: null, error: { message: "boom" } });
    const select = vi.fn(() => ({ in: vi.fn(() => ({ order })) }));
    supabaseAdmin.from.mockImplementationOnce(() => ({ select }) as never);
    await expect(getFounderAnnotationsForShows(["s1"])).resolves.toEqual({});
  });

  it("returns {} (never throws) when supabase throws", async () => {
    supabaseAdmin.from.mockImplementationOnce(() => {
      throw new Error("network down");
    });
    await expect(getFounderAnnotationsForShows(["s1"])).resolves.toEqual({});
  });
});

// ============================================================
// deleteFounderAnnotation
// ============================================================

describe("deleteFounderAnnotation", () => {
  it("returns true on a clean delete", async () => {
    const eq = vi.fn().mockResolvedValue({ error: null });
    const del = vi.fn(() => ({ eq }));
    supabaseAdmin.from.mockImplementationOnce(() => ({ delete: del }) as never);

    await expect(deleteFounderAnnotation("a1")).resolves.toBe(true);
    expect(supabaseAdmin.from).toHaveBeenCalledWith("founder_annotations");
    expect(eq).toHaveBeenCalledWith("id", "a1");
  });

  it("returns false on a delete error", async () => {
    const eq = vi.fn().mockResolvedValue({ error: { message: "boom" } });
    supabaseAdmin.from.mockImplementationOnce(
      () => ({ delete: vi.fn(() => ({ eq })) }) as never
    );
    await expect(deleteFounderAnnotation("a1")).resolves.toBe(false);
  });

  it("returns false (never throws) when supabase throws", async () => {
    supabaseAdmin.from.mockImplementationOnce(() => {
      throw new Error("network down");
    });
    await expect(deleteFounderAnnotation("a1")).resolves.toBe(false);
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

// ============================================================
// persistInterpretationAtomic (migration 024 RPC wrapper)
// ============================================================

describe("persistInterpretationAtomic", () => {
  const input = {
    campaignId: "c1",
    customerId: "u1",
    productAttributes: { brand_name: "SaunaBox" },
    customerDescription: "Affluent men 30-55.",
    aovBucket: "high" as const,
    scoringWeights: { purchasePower: 0.2 },
    rings: [
      {
        kind: "primary" as const,
        label: "recovery",
        reasoning: "fits",
        confidence: "high" as const,
      },
    ],
    analogs: [
      { analogName: "ColdCo", reasoning: "cited", analogPatternId: "lib_1" },
    ],
  };

  it("maps the rpc result into { patternId, ringIds } and snake-cases the args", async () => {
    rpc.mockResolvedValue({
      data: { pattern_id: "pat_1", ring_ids: { recovery: "ring_1" } },
      error: null,
    });

    const result = await persistInterpretationAtomic(input);

    expect(result).toEqual({ patternId: "pat_1", ringIds: { recovery: "ring_1" } });
    expect(rpc).toHaveBeenCalledWith(
      "persist_interpretation",
      expect.objectContaining({
        p_campaign_id: "c1",
        p_customer_id: "u1",
        p_product_attributes: { brand_name: "SaunaBox" },
        p_aov_bucket: "high",
        p_rings: [
          {
            kind: "primary",
            label: "recovery",
            reasoning: "fits",
            confidence: "high",
          },
        ],
        p_analogs: [
          {
            analog_name: "ColdCo",
            reasoning: "cited",
            analog_pattern_id: "lib_1",
          },
        ],
      })
    );
  });

  it("defaults ringIds to {} when the rpc omits ring_ids", async () => {
    rpc.mockResolvedValue({ data: { pattern_id: "pat_1" }, error: null });
    const result = await persistInterpretationAtomic(input);
    expect(result).toEqual({ patternId: "pat_1", ringIds: {} });
  });

  it("returns null without calling the rpc when customerId is missing", async () => {
    const result = await persistInterpretationAtomic({
      ...input,
      customerId: null,
    });
    expect(result).toBeNull();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("returns null when the rpc errors", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "boom" } });
    expect(await persistInterpretationAtomic(input)).toBeNull();
  });

  it("returns null when the rpc returns no pattern_id", async () => {
    rpc.mockResolvedValue({ data: { ring_ids: {} }, error: null });
    expect(await persistInterpretationAtomic(input)).toBeNull();
  });

  it("never throws when the rpc itself throws", async () => {
    rpc.mockImplementation(() => {
      throw new Error("network down");
    });
    await expect(persistInterpretationAtomic(input)).resolves.toBeNull();
  });
});

// ============================================================
// persistRefinementAtomic (migration 025 RPC wrapper)
// ============================================================

describe("persistRefinementAtomic", () => {
  const input = {
    oldRingId: "ring_2",
    campaignPatternId: "pat_1",
    kind: "lateral" as const,
    label: "van-life & overlanding",
    reasoning: "Sharper vehicle-based framing.",
    confidence: "medium" as const,
  };

  it("maps the rpc result and snake-cases the args", async () => {
    rpc.mockResolvedValue({
      data: { new_ring_id: "ring_3", slot_position: 1 },
      error: null,
    });

    const result = await persistRefinementAtomic(input);

    expect(result).toEqual({ newRingId: "ring_3", slotPosition: 1 });
    expect(rpc).toHaveBeenCalledWith(
      "persist_refinement",
      expect.objectContaining({
        p_old_ring_id: "ring_2",
        p_campaign_pattern_id: "pat_1",
        p_kind: "lateral",
        p_label: "van-life & overlanding",
        p_reasoning: "Sharper vehicle-based framing.",
        p_confidence: "medium",
      })
    );
  });

  it("returns null when the rpc errors", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "boom" } });
    expect(await persistRefinementAtomic(input)).toBeNull();
  });

  it("returns null when the rpc returns no new_ring_id", async () => {
    rpc.mockResolvedValue({ data: { slot_position: 1 }, error: null });
    expect(await persistRefinementAtomic(input)).toBeNull();
  });

  it("never throws when the rpc itself throws", async () => {
    rpc.mockImplementation(() => {
      throw new Error("network down");
    });
    await expect(persistRefinementAtomic(input)).resolves.toBeNull();
  });
});

// ============================================================
// persistConfirmationAtomic (migration 025 RPC wrapper)
// ============================================================

describe("persistConfirmationAtomic", () => {
  const decisions = [
    { id: "ring_1", decision: "confirmed" },
    { id: "ring_2", decision: "rejected" },
  ];

  it("returns counts and snake-cases the args on success", async () => {
    rpc.mockResolvedValue({
      data: { confirmed: 1, rejected: 1 },
      error: null,
    });

    const result = await persistConfirmationAtomic("pat_1", decisions);

    expect(result).toEqual({ ok: true, confirmed: 1, rejected: 1 });
    expect(rpc).toHaveBeenCalledWith("persist_confirmation", {
      p_campaign_pattern_id: "pat_1",
      p_decisions: decisions,
    });
  });

  it("reports a validation failure when the rpc raises PT400", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { code: "PT400", message: "persist_confirmation: ring x not valid" },
    });
    expect(await persistConfirmationAtomic("pat_1", decisions)).toEqual({
      ok: false,
      reason: "validation",
    });
  });

  it("reports a validation failure from the message fallback (no code)", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { message: "persist_confirmation: invalid decision foo" },
    });
    expect(await persistConfirmationAtomic("pat_1", decisions)).toEqual({
      ok: false,
      reason: "validation",
    });
  });

  it("reports a plain DB error as reason 'error'", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { code: "57014", message: "statement timeout" },
    });
    expect(await persistConfirmationAtomic("pat_1", decisions)).toEqual({
      ok: false,
      reason: "error",
    });
  });

  it("never throws when the rpc itself throws", async () => {
    rpc.mockImplementation(() => {
      throw new Error("network down");
    });
    await expect(
      persistConfirmationAtomic("pat_1", decisions)
    ).resolves.toEqual({ ok: false, reason: "error" });
  });
});

// ============================================================
// updateScaleShowCuration (Wave 14 Phase 2C — 0-row detection)
// ============================================================

describe("updateScaleShowCuration", () => {
  // Build an .update().eq().eq().select() chain whose terminal .select()
  // resolves to the given {data,error}. The default `from()` mock has no
  // update builder, so each test installs this via from.mockImplementationOnce.
  function installUpdate(result: { data: unknown; error: unknown }) {
    const select = vi.fn().mockResolvedValue(result);
    const chain: Record<string, unknown> = {};
    chain.eq = vi.fn(() => chain);
    chain.select = select;
    const update = vi.fn(() => chain);
    supabaseAdmin.from.mockImplementationOnce(() => ({ update }) as never);
    return { update, select };
  }

  const INPUT = {
    campaignPatternId: "pat_1",
    showId: "s1",
    brandSaved: true,
    brandDismissed: false,
  };

  it("returns true when at least one row is updated", async () => {
    const { update } = installUpdate({
      data: [{ show_id: "s1" }],
      error: null,
    });
    await expect(updateScaleShowCuration(INPUT)).resolves.toBe(true);
    expect(update).toHaveBeenCalledWith({
      brand_saved: true,
      brand_dismissed: false,
    });
  });

  it("returns false on a 0-row write (no matching pattern/show)", async () => {
    installUpdate({ data: [], error: null });
    await expect(updateScaleShowCuration(INPUT)).resolves.toBe(false);
  });

  it("returns false when supabase returns an error", async () => {
    installUpdate({ data: null, error: { message: "boom" } });
    await expect(updateScaleShowCuration(INPUT)).resolves.toBe(false);
  });

  it("returns false (and never writes) on an empty patch", async () => {
    await expect(
      updateScaleShowCuration({ campaignPatternId: "pat_1", showId: "s1" })
    ).resolves.toBe(false);
    expect(supabaseAdmin.from).not.toHaveBeenCalled();
  });

  it("never throws when the client itself throws", async () => {
    supabaseAdmin.from.mockImplementationOnce(() => {
      throw new Error("network down");
    });
    await expect(updateScaleShowCuration(INPUT)).resolves.toBe(false);
  });
});
