import { describe, it, expect, vi } from "vitest";

// tier-portfolio's default deps statically import reasoning-log, which
// constructs the admin Supabase client at import time (requires live env).
// Tests inject fakes, so the real client is never used — stub the module so
// the import doesn't require env. Matches conviction-discovery.test.ts.
vi.mock("@/lib/supabase/admin", () => ({ supabaseAdmin: { from: vi.fn() } }));

import type {
  ConvictionScoreRow,
  RingHypothesisRow,
  Show,
} from "@/lib/data/types";
import { dollarsToCents } from "./spot-cost";
import {
  classifyTier,
  rollupShowComposite,
  tierCampaignPortfolio,
  MEDIUM_FLOOR,
  THREE_SPOT_THRESHOLD,
  MIN_TEST_SHOWS,
  type ClassifyTierInput,
  type TierPortfolioDeps,
} from "./tier-portfolio";
import type { UpdateConvictionTierCostInput } from "@/lib/data/reasoning-log";

// Budget $30,000 → 3,000,000 cents; 25% affordability ceiling = 750,000 cents.
const BUDGET_DOLLARS = 30_000;
const BUDGET_CENTS = dollarsToCents(BUDGET_DOLLARS); // 3_000_000
const CEILING = THREE_SPOT_THRESHOLD * BUDGET_CENTS; // 750_000

function classifyInput(
  overrides: Partial<ClassifyTierInput> = {}
): ClassifyTierInput {
  return {
    compositeScore: 70, // ≥ MEDIUM_FLOOR
    threeSpotCents: 420_000, // affordable (≤ 750_000)
    costBasis: "derived",
    needsQuote: false,
    testBudgetCents: BUDGET_CENTS,
    ...overrides,
  };
}

describe("classifyTier — gate-worthy cost (derived/rate_card)", () => {
  it("affordable + derived + composite ≥ floor → test", () => {
    expect(classifyTier(classifyInput())).toBe("test");
  });

  it("affordable + derived + composite < floor → dropped", () => {
    expect(
      classifyTier(classifyInput({ compositeScore: MEDIUM_FLOOR - 1 }))
    ).toBe("dropped");
  });

  it("over-threshold + derived + composite ≥ floor → scale", () => {
    expect(
      classifyTier(classifyInput({ threeSpotCents: CEILING + 1 }))
    ).toBe("scale");
  });

  it("over-threshold + derived + composite < floor → dropped (floor wins)", () => {
    expect(
      classifyTier(
        classifyInput({
          threeSpotCents: CEILING + 1,
          compositeScore: MEDIUM_FLOOR - 1,
        })
      )
    ).toBe("dropped");
  });

  it("rate_card gates exactly like derived (affordable → test, over → scale)", () => {
    expect(classifyTier(classifyInput({ costBasis: "rate_card" }))).toBe(
      "test"
    );
    expect(
      classifyTier(
        classifyInput({ costBasis: "rate_card", threeSpotCents: CEILING + 1 })
      )
    ).toBe("scale");
  });
});

describe("classifyTier — flat_fee is conviction-only (cost never gates)", () => {
  it("flat_fee + composite ≥ floor → test even when cost dwarfs the budget", () => {
    expect(
      classifyTier(
        classifyInput({
          costBasis: "flat_fee",
          threeSpotCents: BUDGET_CENTS * 10, // wildly over budget
        })
      )
    ).toBe("test");
  });

  it("flat_fee over-threshold NEVER becomes scale on cost", () => {
    const tier = classifyTier(
      classifyInput({ costBasis: "flat_fee", threeSpotCents: CEILING + 999_999 })
    );
    expect(tier).toBe("test");
    expect(tier).not.toBe("scale");
  });
});

describe("classifyTier — needsQuote + boundaries", () => {
  it("needsQuote → dropped, even at composite ≥ floor", () => {
    expect(
      classifyTier(
        classifyInput({
          needsQuote: true,
          costBasis: null,
          threeSpotCents: null,
          compositeScore: 95,
        })
      )
    ).toBe("dropped");
  });

  it("threshold boundary: exactly 25% of budget → test (inclusive ≤)", () => {
    expect(classifyTier(classifyInput({ threeSpotCents: CEILING }))).toBe(
      "test"
    );
    expect(classifyTier(classifyInput({ threeSpotCents: CEILING + 1 }))).toBe(
      "scale"
    );
  });

  it("dollars→cents conversion is correct at the threshold", () => {
    // $20,000 budget → 2,000,000 cents → ceiling 500,000 cents.
    const budgetCents = dollarsToCents(20_000);
    expect(budgetCents).toBe(2_000_000);
    const ceiling = THREE_SPOT_THRESHOLD * budgetCents; // 500_000
    expect(
      classifyTier(
        classifyInput({ testBudgetCents: budgetCents, threeSpotCents: ceiling })
      )
    ).toBe("test");
    expect(
      classifyTier(
        classifyInput({
          testBudgetCents: budgetCents,
          threeSpotCents: ceiling + 1,
        })
      )
    ).toBe("scale");
  });
});

// ---- rollup + campaign-level pass ----

function makeRow(overrides: Partial<ConvictionScoreRow> = {}): ConvictionScoreRow {
  return {
    id: "row-" + Math.round((overrides.composite_score ?? 0) * 1000),
    campaign_pattern_id: "pattern-1",
    show_id: "show-1",
    ring_hypothesis_id: "ring-1",
    created_at: "2026-06-24T00:00:00.000Z",
    audience_fit_score: 50,
    topical_relevance_score: 60,
    purchase_power_score: 50,
    composite_score: 60,
    conviction_band: "medium",
    reasoning: null,
    tier: null,
    per_spot_cents: null,
    three_spot_cents: null,
    cpm_used_cents: null,
    cost_basis: null,
    cost_is_estimate: null,
    needs_quote: null,
    brand_saved: null,
    brand_dismissed: null,
    ...overrides,
  };
}

function makeShow(overrides: Partial<Show> = {}): Show {
  const now = "2026-06-24T00:00:00.000Z";
  return {
    id: "show-1",
    name: "Test Show",
    platform: "podcast",
    description: "",
    categories: [],
    tags: [],
    contact: { name: "", email: "", method: "email" },
    audience_size: 10_000,
    demographics: {},
    audience_interests: [],
    rate_card: { preroll_cpm: 12, midroll_cpm: 20, postroll_cpm: 8 },
    price_type: "cpm",
    ad_formats: ["host_read"],
    episode_cadence: "weekly",
    avg_episode_length_min: 45,
    current_sponsors: [],
    is_claimed: false,
    is_verified: false,
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

describe("rollupShowComposite", () => {
  it("picks the show's highest-composite row across rings", () => {
    const rows = [
      makeRow({ show_id: "show-A", ring_hypothesis_id: "ring-1", composite_score: 40 }),
      makeRow({ show_id: "show-A", ring_hypothesis_id: "ring-2", composite_score: 70 }),
      makeRow({ show_id: "show-A", ring_hypothesis_id: "ring-3", composite_score: 55 }),
    ];
    const rollup = rollupShowComposite(rows);
    expect(rollup.size).toBe(1);
    const entry = rollup.get("show-A")!;
    expect(entry.composite).toBe(70);
    expect(entry.topRow.ring_hypothesis_id).toBe("ring-2");
  });

  it("treats a null composite as below any real score", () => {
    const rows = [
      makeRow({ show_id: "show-A", composite_score: null }),
      makeRow({ show_id: "show-A", composite_score: 10 }),
    ];
    expect(rollupShowComposite(rows).get("show-A")!.composite).toBe(10);
  });
});

/** A pass deps fixture with spies. shows keyed by id; persist records calls. */
function makeDeps(args: {
  rows: ConvictionScoreRow[];
  shows: Show[];
  budgetTotalDollars?: number;
  campaignId?: string | null;
  /** Confirmed ring ids (Layer 3.5). Defaults to every distinct ring present in
   *  the rows, so the filter is a no-op unless a test narrows it deliberately. */
  confirmedRingIds?: string[];
}): {
  deps: TierPortfolioDeps;
  persistCalls: UpdateConvictionTierCostInput[];
  emitted: { eventType: string; entityId: string }[];
} {
  const persistCalls: UpdateConvictionTierCostInput[] = [];
  const emitted: { eventType: string; entityId: string }[] = [];
  const showMap = new Map(args.shows.map((s) => [s.id, s]));
  const confirmedRingIds =
    args.confirmedRingIds ??
    [
      ...new Set(
        args.rows
          .map((r) => r.ring_hypothesis_id)
          .filter((id): id is string => !!id)
      ),
    ];
  const deps: TierPortfolioDeps = {
    loadScores: async () => args.rows,
    loadConfirmedRings: async () =>
      confirmedRingIds.map((id) => ({ id }) as RingHypothesisRow),
    loadCampaignCtx: async () =>
      args.campaignId === null
        ? null
        : {
            campaignId: args.campaignId ?? "campaign-1",
            budgetTotalDollars: args.budgetTotalDollars ?? BUDGET_DOLLARS,
          },
    loadShowsByIds: async (ids) =>
      new Map(ids.filter((id) => showMap.has(id)).map((id) => [id, showMap.get(id)!])),
    persist: async (input) => {
      persistCalls.push(input);
      return true;
    },
    emit: async (input) => {
      emitted.push({ eventType: input.eventType, entityId: input.entityId });
      return null;
    },
  };
  return { deps, persistCalls, emitted };
}

describe("tierCampaignPortfolio — campaign-level pass", () => {
  it("flags test_underfilled when fewer than MIN_TEST_SHOWS land in test", async () => {
    // Two cheap (affordable) shows, composite ≥ floor → 2 test < 3 → underfilled.
    const rows = [
      makeRow({ show_id: "show-A", composite_score: 70 }),
      makeRow({ show_id: "show-B", composite_score: 70 }),
    ];
    const shows = [
      makeShow({ id: "show-A", audience_size: 10_000 }),
      makeShow({ id: "show-B", audience_size: 10_000 }),
    ];
    const { deps } = makeDeps({ rows, shows });
    const result = await tierCampaignPortfolio("pattern-1", deps);

    expect(result.testCount).toBe(2);
    expect(result.scaleCount).toBe(0);
    expect(result.testUnderfilled).toBe(true);
    expect(MIN_TEST_SHOWS).toBe(3);
  });

  it("persists one tier per show (a 2-ring show updates via a single call) and emits portfolio.tiered", async () => {
    // show-A: 2 rings, affordable → test. show-B, show-D: affordable → test.
    // show-C: over-threshold (200K downloads × $35 mid-roll = 3-spot $21,000) → scale.
    const rows = [
      makeRow({ show_id: "show-A", ring_hypothesis_id: "ring-1", composite_score: 55 }),
      makeRow({ show_id: "show-A", ring_hypothesis_id: "ring-2", composite_score: 72 }),
      makeRow({ show_id: "show-B", ring_hypothesis_id: "ring-1", composite_score: 70 }),
      makeRow({ show_id: "show-D", ring_hypothesis_id: "ring-1", composite_score: 65 }),
      makeRow({ show_id: "show-C", ring_hypothesis_id: "ring-1", composite_score: 80 }),
    ];
    const shows = [
      makeShow({ id: "show-A", audience_size: 10_000 }),
      makeShow({ id: "show-B", audience_size: 10_000 }),
      makeShow({ id: "show-D", audience_size: 10_000 }),
      makeShow({
        id: "show-C",
        audience_size: 200_000,
        rate_card: { preroll_cpm: 25, midroll_cpm: 35, postroll_cpm: 18 },
      }),
    ];
    const { deps, persistCalls, emitted } = makeDeps({ rows, shows });
    const result = await tierCampaignPortfolio("pattern-1", deps);

    // One persist call per DISTINCT show (the per-(pattern,show) UPDATE covers
    // all of show-A's ring rows in a single write).
    expect(persistCalls).toHaveLength(4);
    const byShow = new Map(persistCalls.map((c) => [c.showId, c]));
    expect(byShow.get("show-A")!.tier).toBe("test");
    expect(byShow.get("show-B")!.tier).toBe("test");
    expect(byShow.get("show-D")!.tier).toBe("test");
    expect(byShow.get("show-C")!.tier).toBe("scale");

    expect(result.testCount).toBe(3);
    expect(result.scaleCount).toBe(1);
    expect(result.persisted).toBe(4);
    expect(result.showsClassified).toBe(4);
    expect(result.testUnderfilled).toBe(false);

    // Domain event fires once on the campaign entity.
    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toEqual({
      eventType: "portfolio.tiered",
      entityId: "campaign-1",
    });
  });
});

describe("tierCampaignPortfolio — confirmed-ring filter (Layer 3.5)", () => {
  it("drops a rejected-ring-only show, keeps confirmed-ring shows", async () => {
    // show-A scored on a confirmed ring; show-B ONLY on a ring the brand later
    // rejected. Both would be affordable test shows — but show-B must not be
    // classified or persisted (its only ring is gone).
    const rows = [
      makeRow({ show_id: "show-A", ring_hypothesis_id: "ring-confirmed", composite_score: 70 }),
      makeRow({ show_id: "show-B", ring_hypothesis_id: "ring-rejected", composite_score: 90 }),
    ];
    const shows = [
      makeShow({ id: "show-A", audience_size: 10_000 }),
      makeShow({ id: "show-B", audience_size: 10_000 }),
    ];
    const { deps, persistCalls } = makeDeps({
      rows,
      shows,
      confirmedRingIds: ["ring-confirmed"],
    });
    const result = await tierCampaignPortfolio("pattern-1", deps);

    expect(result.showsClassified).toBe(1);
    expect(result.testCount).toBe(1);
    expect(persistCalls.map((c) => c.showId)).toEqual(["show-A"]);
    expect(persistCalls.find((c) => c.showId === "show-B")).toBeUndefined();
  });

  it("rolls a multi-ring show up from the CONFIRMED ring only (not the higher rejected ring)", async () => {
    // One show on two rings: a rejected ring with the higher composite (88 →
    // would be test) and the confirmed ring with a sub-floor composite (40 →
    // dropped). Filtering BEFORE rollup means the confirmed ring governs, so the
    // show is classified 'dropped'. The pre-fix rollup would have picked 88.
    const rows = [
      makeRow({ show_id: "show-A", ring_hypothesis_id: "ring-rejected", composite_score: 88 }),
      makeRow({ show_id: "show-A", ring_hypothesis_id: "ring-confirmed", composite_score: 40 }),
    ];
    const shows = [makeShow({ id: "show-A", audience_size: 10_000 })];
    const { deps, persistCalls } = makeDeps({
      rows,
      shows,
      confirmedRingIds: ["ring-confirmed"],
    });
    const result = await tierCampaignPortfolio("pattern-1", deps);

    expect(result.showsClassified).toBe(1);
    expect(result.testCount).toBe(0);
    expect(result.droppedCount).toBe(1);
    expect(persistCalls).toHaveLength(1);
    expect(persistCalls[0].showId).toBe("show-A");
    expect(persistCalls[0].tier).toBe("dropped");
  });
});
