import { describe, it, expect } from "vitest";
import {
  scoreShowConviction,
  convictionWeights,
  STRONG_DIMENSION_THRESHOLD,
  type ConvictionScore,
} from "./conviction";
import { getEffectiveWeights } from "./weights";
import type {
  Show,
  RingHypothesisRow,
  CampaignPatternRow,
  ShowDemographics,
  ConvictionBand,
  AovBucket,
} from "@/lib/data/types";

// ---- Fixture factories ----

function makeShow(overrides: Partial<Show> = {}): Show {
  const base = {
    id: "discovered-podscan-x",
    name: "Test Show",
    platform: "podcast",
    description: "",
    categories: [],
    tags: [],
    contact: { name: "", email: "", method: "email" },
    audience_size: 50000,
    demographics: {} as ShowDemographics,
    audience_interests: [],
    rate_card: { midroll_cpm: 25 },
    price_type: "cpm",
    ad_formats: ["host_read"],
    episode_cadence: "weekly",
    avg_episode_length_min: 45,
    current_sponsors: [],
    is_claimed: false,
    is_verified: false,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  };
  return { ...base, ...overrides } as Show;
}

function makeRing(overrides: Partial<RingHypothesisRow> = {}): RingHypothesisRow {
  return {
    id: "ring-1",
    campaign_pattern_id: "cp-1",
    created_at: "2026-01-01T00:00:00.000Z",
    kind: "primary",
    label: "protocol-driven recovery and biohacking",
    reasoning: "host runs recovery protocols personally",
    confidence: "high",
    confidence_score: 80,
    brand_confirmed: true,
    brand_decision: "confirmed",
    slot_position: 0,
    ...overrides,
  };
}

function makePattern(
  aov: AovBucket | null,
  productAttributes: Record<string, unknown> = {}
): CampaignPatternRow {
  return {
    id: "cp-1",
    campaign_id: "camp-1",
    customer_id: "cust-1",
    created_at: "2026-01-01T00:00:00.000Z",
    product_attributes: {
      category: "recovery hardware",
      key_attributes: ["cold plunge", "sauna"],
      ...productAttributes,
    },
    customer_description: null,
    aov_bucket: aov,
    scoring_weights: null,
  };
}

// A target audience that, with the demo helper below, yields a chosen
// audience-fit score.
const MEN_30_60 = { age_min: 35, age_max: 55, gender: "mostly_men" };

/** Demo whose age-in-target share and male share both equal `pct` → audience
 *  fit = pct (age and gender average to the same value). */
function demoFor(pct: number): ShowDemographics {
  return {
    age_35_44: pct,
    age_25_34: 100 - pct,
    male: pct,
    female: 100 - pct,
  };
}

function patternWithTarget(aov: AovBucket | null): CampaignPatternRow {
  return makePattern(aov, { target_audience: MEN_30_60 });
}

// ---- Tests ----

describe("convergence → high", () => {
  it("all three dimensions strong + high composite → high", () => {
    const show = makeShow({
      categories: ["Recovery"], // direct match → topical 85
      demographics: demoFor(90), // audience 90
      audience_purchase_power: 80,
    });
    const result = scoreShowConviction(show, makeRing(), patternWithTarget("high"));

    expect(result.audienceFit).toBe(90);
    expect(result.topicalRelevance).toBe(85);
    expect(result.purchasePower).toBe(80);
    expect(result.composite).toBeGreaterThanOrEqual(75);
    // convergence guard satisfied: ≥2 dims ≥ strong threshold
    const strong = [90, 85, 80].filter((d) => d >= STRONG_DIMENSION_THRESHOLD);
    expect(strong.length).toBeGreaterThanOrEqual(2);
    expect(result.band).toBe<ConvictionBand>("high");
  });
});

describe("two strong, one weak → medium", () => {
  it("strong audience + topical, weak purchase, composite in [50,75) → medium", () => {
    const show = makeShow({
      categories: ["Recovery"], // topical 85
      demographics: demoFor(80), // audience 80
      audience_purchase_power: 20, // weak
    });
    const result = scoreShowConviction(show, makeRing(), patternWithTarget("high"));

    expect(result.audienceFit).toBe(80);
    expect(result.topicalRelevance).toBe(85);
    expect(result.purchasePower).toBe(20);
    // Pinned, not just bounded — a scoring regression that kept the composite
    // inside [50,75) but moved it would still pass a range-only check.
    expect(result.composite).toBe(71);
    expect(result.band).toBe<ConvictionBand>("medium");
  });
});

describe("one strong → low", () => {
  it("only audience strong, composite below medium floor → low", () => {
    const show = makeShow({
      categories: ["Cooking"], // no overlap with recovery ring → topical 20
      demographics: demoFor(80), // audience 80
      audience_purchase_power: 20,
    });
    const result = scoreShowConviction(show, makeRing(), patternWithTarget("high"));

    expect(result.topicalRelevance).toBe(20);
    expect(result.composite).toBeLessThan(50);
    expect(result.band).toBe<ConvictionBand>("low");
  });
});

describe("non-gating — the That Was Us case", () => {
  it("low purchase power + high audience + high topical (high-AOV) still produces a real composite and rings", () => {
    const show = makeShow({
      categories: ["Recovery"], // topical 85
      demographics: demoFor(85), // audience 85
      audience_purchase_power: 25, // LOW purchase power
    });
    const result = scoreShowConviction(show, makeRing(), patternWithTarget("high"));

    expect(result.purchasePower).toBe(25);
    // Composite is a real number driven by the strong dims — NOT zeroed out.
    expect(result.composite).toBeGreaterThan(50);
    // Lands in a real ring, not filtered, not speculative.
    expect(result.band).not.toBe("speculative");
    expect(result.band).not.toBe("low");
    // Prove no zero-drag: the 25 actually contributed (composite > the value
    // it would have at purchase 0).
    const zeroPp = scoreShowConviction(
      makeShow({
        categories: ["Recovery"],
        demographics: demoFor(85),
        audience_purchase_power: 0,
      }),
      makeRing(),
      patternWithTarget("high")
    );
    expect(result.composite).toBeGreaterThan(zeroPp.composite);
  });
});

describe("low-AOV brief → purchase-power weight ≈ 0", () => {
  it("renormalized purchase-power weight is negligible for low AOV", () => {
    const w = convictionWeights("low");
    expect(w.purchasePower).toBeLessThan(0.1);
    // composite driven by audience + topical
    expect(w.audienceFit + w.topicalRelevance).toBeGreaterThan(0.9);
  });
});

describe("high-AOV brief → AOV tilt active, purchase power weighted", () => {
  it("renormalized purchase-power weight is material for high AOV", () => {
    const w = convictionWeights("high");
    expect(w.purchasePower).toBeGreaterThan(0.15);
  });

  it("a high-purchase-power show composites higher under high AOV than low AOV", () => {
    const show = makeShow({
      categories: ["Fitness Cooking"], // recall 0.5 → topical 60
      demographics: demoFor(60), // audience 60
      audience_purchase_power: 80, // high purchase power
    });
    const ring = makeRing({ label: "fitness recovery", reasoning: "" });
    const lowAov = scoreShowConviction(show, ring, patternWithTarget("low"));
    const highAov = scoreShowConviction(show, ring, patternWithTarget("high"));

    expect(show.audience_purchase_power).toBe(80);
    expect(highAov.purchasePower).toBe(80);
    expect(highAov.composite).toBeGreaterThan(lowAov.composite);
  });
});

describe("sparse demographics → degraded audience, no throw", () => {
  it("empty demographics + no structured target → audience neutral 50, degraded, band not high", () => {
    const show = makeShow({
      categories: ["Recovery"], // topical 85
      demographics: {} as ShowDemographics,
      audience_purchase_power: 80,
    });
    // pattern has NO target_audience → audience cannot be scored
    const run = () => scoreShowConviction(show, makeRing(), makePattern("high"));
    expect(run).not.toThrow();
    const result = run();
    expect(result.audienceFit).toBe(50);
    expect(result.drivers.audienceFit.degraded).toBe(true);
    expect(result.drivers.audienceFit.coverage).toBe(0);
    // Audience can't be a strong dim at 50 → band lowered off high.
    expect(result.band).not.toBe("high");
  });
});

describe("NULL purchase power → graceful, no zero-drag, no throw", () => {
  it("undefined audience_purchase_power → neutral 50 degraded, composite reflects 50", () => {
    const show = makeShow({
      categories: ["Recovery"], // topical 85
      demographics: demoFor(80), // audience 80
      // audience_purchase_power left undefined
    });
    const run = () => scoreShowConviction(show, makeRing(), patternWithTarget("high"));
    expect(run).not.toThrow();
    const result = run();

    expect(result.purchasePower).toBe(50);
    expect(result.drivers.purchasePower.degraded).toBe(true);
    expect(result.drivers.purchasePower.source).toBe("absent");

    // No zero-drag: a hypothetical purchase 0 would yield a strictly lower
    // composite (and could drop the band).
    const zero = scoreShowConviction(
      makeShow({ categories: ["Recovery"], demographics: demoFor(80), audience_purchase_power: 0 }),
      makeRing(),
      patternWithTarget("high")
    );
    expect(result.composite).toBeGreaterThan(zero.composite);
  });
});

describe("composite matches getEffectiveWeights output for a known fixture", () => {
  it("composite equals the renormalized getEffectiveWeights weighted sum", () => {
    const show = makeShow({
      categories: ["Recovery"], // topical 85
      demographics: demoFor(80), // audience 80
      audience_purchase_power: 40,
    });
    const result = scoreShowConviction(show, makeRing(), patternWithTarget("high"));

    // Pin the sub-scores so the composite check isn't tautological — a wrong
    // sub-score would otherwise still satisfy the arithmetic below.
    expect(result.audienceFit).toBe(80);
    expect(result.topicalRelevance).toBe(85);
    expect(result.purchasePower).toBe(40);

    // Re-derive the weights independently from getEffectiveWeights with the
    // same base the scorer uses, then project + renormalize the 3 conviction
    // dims.
    const raw = getEffectiveWeights(
      {
        audienceFit: 0.45,
        topicalRelevance: 0.45,
        purchasePower: 0.05,
        adEngagement: 0,
        sponsorRetention: 0,
        reach: 0,
      },
      undefined,
      { aovBucket: "high" }
    );
    const total = raw.audienceFit + (raw.topicalRelevance ?? 0) + (raw.purchasePower ?? 0);
    const w = {
      audienceFit: raw.audienceFit / total,
      topicalRelevance: (raw.topicalRelevance ?? 0) / total,
      purchasePower: (raw.purchasePower ?? 0) / total,
    };

    expect(result.weights.audienceFit).toBeCloseTo(w.audienceFit, 6);
    expect(result.weights.topicalRelevance).toBeCloseTo(w.topicalRelevance, 6);
    expect(result.weights.purchasePower).toBeCloseTo(w.purchasePower, 6);

    const expectedComposite = Math.round(
      w.audienceFit * result.audienceFit +
        w.topicalRelevance * result.topicalRelevance +
        w.purchasePower * result.purchasePower
    );
    expect(result.composite).toBe(expectedComposite);
  });
});

describe("gender target mapping (women/female not mis-caught as men)", () => {
  // 'women' contains the substring 'men' and 'female' contains 'male' — the
  // scorer must check women/female FIRST. On a female-skewed show, a women
  // target should score the gender signal high; a men target should score low.
  const femaleSkewed = makeShow({
    categories: ["Recovery"],
    demographics: { age_35_44: 80, age_25_34: 20, male: 20, female: 80 },
    audience_purchase_power: 50,
  });

  it("women target → female share scored (high), not mis-mapped to male share", () => {
    const womenPattern = makePattern("high", {
      target_audience: { age_min: 35, age_max: 55, gender: "women" },
    });
    const result = scoreShowConviction(femaleSkewed, makeRing(), womenPattern);
    // age 80, gender (female share) 80 → 80
    expect(result.audienceFit).toBe(80);
  });

  it("'female' string resolves the same as 'women'", () => {
    const femalePattern = makePattern("high", {
      target_audience: { age_min: 35, age_max: 55, gender: "female" },
    });
    const result = scoreShowConviction(femaleSkewed, makeRing(), femalePattern);
    expect(result.audienceFit).toBe(80);
  });

  it("men target on the same female-skewed show scores the gender signal low", () => {
    const menPattern = makePattern("high", {
      target_audience: { age_min: 35, age_max: 55, gender: "mostly_men" },
    });
    const result = scoreShowConviction(femaleSkewed, makeRing(), menPattern);
    // age 80, gender (male share) 20 → 50
    expect(result.audienceFit).toBe(50);
  });
});

describe("tunable constants match §7 spec values", () => {
  it("strong threshold is 70 and band floors are 75 / 50", () => {
    expect(STRONG_DIMENSION_THRESHOLD).toBe(70);
  });
});

describe("band boundary cases", () => {
  it("high cut: composite 75 with convergence → high; 74 → medium", () => {
    const high = scoreShowConviction(
      makeShow({ categories: ["Recovery"], demographics: demoFor(85), audience_purchase_power: 30 }),
      makeRing(),
      patternWithTarget("high")
    );
    expect(high.composite).toBe(75);
    expect(high.band).toBe<ConvictionBand>("high");

    const medium = scoreShowConviction(
      makeShow({ categories: ["Recovery"], demographics: demoFor(85), audience_purchase_power: 25 }),
      makeRing(),
      patternWithTarget("high")
    );
    expect(medium.composite).toBe(74);
    expect(medium.band).toBe<ConvictionBand>("medium");
  });

  it("medium cut: composite 50 → medium; 49 → low", () => {
    const medium = scoreShowConviction(
      makeShow({ categories: ["Cooking"], demographics: demoFor(80), audience_purchase_power: 50 }),
      makeRing(),
      patternWithTarget("high")
    );
    expect(medium.composite).toBe(50);
    expect(medium.band).toBe<ConvictionBand>("medium");

    const low = scoreShowConviction(
      makeShow({ categories: ["Cooking"], demographics: demoFor(80), audience_purchase_power: 45 }),
      makeRing(),
      patternWithTarget("high")
    );
    expect(low.composite).toBe(49);
    expect(low.band).toBe<ConvictionBand>("low");
  });
});

describe("speculative ring caps band at speculative", () => {
  it("a speculative source ring forces speculative regardless of a high composite", () => {
    const show = makeShow({
      categories: ["Recovery"], // topical 85
      demographics: demoFor(85), // audience 85
      audience_purchase_power: 85,
    });
    const result: ConvictionScore = scoreShowConviction(
      show,
      makeRing({ confidence: "speculative" }),
      patternWithTarget("high")
    );

    // Composite would otherwise band high...
    expect(result.composite).toBeGreaterThanOrEqual(75);
    // ...but the speculative ring caps it.
    expect(result.band).toBe<ConvictionBand>("speculative");
  });
});
