import { describe, it, expect } from "vitest";
import {
  DEFAULT_WEIGHTS,
  getEffectiveWeights,
  redistributeWeights,
} from "./weights";

const close = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) < eps;

describe("DEFAULT_WEIGHTS", () => {
  it("sums to 1.0 across the four legacy dimensions", () => {
    const sum =
      DEFAULT_WEIGHTS.audienceFit +
      DEFAULT_WEIGHTS.adEngagement +
      DEFAULT_WEIGHTS.sponsorRetention +
      DEFAULT_WEIGHTS.reach;
    expect(close(sum, 1.0)).toBe(true);
  });

  it("does not enable the Phase 2 dimensions by default", () => {
    expect(DEFAULT_WEIGHTS.topicalRelevance).toBeUndefined();
    expect(DEFAULT_WEIGHTS.purchasePower).toBeUndefined();
  });
});

describe("getEffectiveWeights", () => {
  it("returns DEFAULT_WEIGHTS unchanged when no overrides or context", () => {
    expect(getEffectiveWeights()).toEqual(DEFAULT_WEIGHTS);
  });

  it("returns the legacy 4-dim shape when Phase 2 dims stay zero", () => {
    const out = getEffectiveWeights(DEFAULT_WEIGHTS, {
      audienceFit: 0.5,
      adEngagement: 0.2,
      sponsorRetention: 0.2,
      reach: 0.1,
    });
    expect(out).toEqual({
      audienceFit: 0.5,
      adEngagement: 0.2,
      sponsorRetention: 0.2,
      reach: 0.1,
    });
    expect(out.topicalRelevance).toBeUndefined();
    expect(out.purchasePower).toBeUndefined();
  });

  it("includes Phase 2 dims once any override sets them non-zero", () => {
    const out = getEffectiveWeights(DEFAULT_WEIGHTS, {
      topicalRelevance: 0.15,
      purchasePower: 0.1,
    });
    expect(out.topicalRelevance).toBe(0.15);
    expect(out.purchasePower).toBe(0.1);
    // Legacy dims pass through unchanged
    expect(out.audienceFit).toBe(0.4);
    expect(out.reach).toBe(0.1);
  });

  it("tilts toward purchase power when aovBucket is 'high'", () => {
    const out = getEffectiveWeights(
      DEFAULT_WEIGHTS,
      { topicalRelevance: 0.1, purchasePower: 0.1 },
      { aovBucket: "high" }
    );
    expect(out.purchasePower).toBe(0.2);
    expect(out.reach).toBe(0.05);
  });

  it("does not tilt for 'low' or 'mid' AOV buckets", () => {
    const low = getEffectiveWeights(
      DEFAULT_WEIGHTS,
      { topicalRelevance: 0.1, purchasePower: 0.1 },
      { aovBucket: "low" }
    );
    expect(low.purchasePower).toBe(0.1);
    expect(low.reach).toBe(0.1);

    const mid = getEffectiveWeights(
      DEFAULT_WEIGHTS,
      { topicalRelevance: 0.1, purchasePower: 0.1 },
      { aovBucket: "mid" }
    );
    expect(mid.purchasePower).toBe(0.1);
    expect(mid.reach).toBe(0.1);
  });
});

describe("redistributeWeights", () => {
  it("returns DEFAULT_WEIGHTS (within float precision) when all 4 legacy dimensions are available", () => {
    const out = redistributeWeights(DEFAULT_WEIGHTS, {
      audienceFit: true,
      adEngagement: true,
      sponsorRetention: true,
      reach: true,
    });
    // The total / divide path introduces sub-epsilon drift even when
    // total === 1.0. Compare per-dimension within tolerance.
    expect(close(out.audienceFit, DEFAULT_WEIGHTS.audienceFit)).toBe(true);
    expect(close(out.adEngagement, DEFAULT_WEIGHTS.adEngagement)).toBe(true);
    expect(close(out.sponsorRetention, DEFAULT_WEIGHTS.sponsorRetention)).toBe(
      true
    );
    expect(close(out.reach, DEFAULT_WEIGHTS.reach)).toBe(true);
    expect(out.topicalRelevance).toBeUndefined();
    expect(out.purchasePower).toBeUndefined();
  });

  it("redistributes proportionally when one legacy dimension is unavailable", () => {
    const out = redistributeWeights(DEFAULT_WEIGHTS, {
      audienceFit: true,
      adEngagement: false,
      sponsorRetention: true,
      reach: true,
    });
    // 0.7 active total → renormalize
    expect(close(out.audienceFit, 0.4 / 0.7)).toBe(true);
    expect(out.adEngagement).toBe(0);
    expect(close(out.sponsorRetention, 0.2 / 0.7)).toBe(true);
    expect(close(out.reach, 0.1 / 0.7)).toBe(true);
    const sum =
      out.audienceFit + out.adEngagement + out.sponsorRetention + out.reach;
    expect(close(sum, 1.0)).toBe(true);
  });

  it("handles available object without topicalRelevance/purchasePower fields (legacy callers)", () => {
    // Existing callers in lib/scoring/index.ts pass only the four legacy
    // booleans. Make sure that shape is still accepted and produces
    // legacy 4-dim output.
    const out = redistributeWeights(DEFAULT_WEIGHTS, {
      audienceFit: true,
      adEngagement: true,
      sponsorRetention: true,
      reach: true,
    });
    expect(out.topicalRelevance).toBeUndefined();
    expect(out.purchasePower).toBeUndefined();
  });

  it("falls back to equal 4-dim weights when nothing is available", () => {
    const out = redistributeWeights(DEFAULT_WEIGHTS, {
      audienceFit: false,
      adEngagement: false,
      sponsorRetention: false,
      reach: false,
    });
    expect(out).toEqual({
      audienceFit: 0.25,
      adEngagement: 0.25,
      sponsorRetention: 0.25,
      reach: 0.25,
    });
  });

  it("normalizes 6-dim weights to sum to 1.0", () => {
    // Mock a Phase 2 base where all six dims contribute. The base does
    // not need to sum to 1 — redistributeWeights normalizes whatever
    // it gets.
    const base = {
      audienceFit: 0.3,
      adEngagement: 0.2,
      sponsorRetention: 0.15,
      reach: 0.05,
      topicalRelevance: 0.2,
      purchasePower: 0.1,
    };
    const out = redistributeWeights(base, {
      audienceFit: true,
      adEngagement: true,
      sponsorRetention: true,
      reach: true,
      topicalRelevance: true,
      purchasePower: true,
    });
    const sum =
      out.audienceFit +
      out.adEngagement +
      out.sponsorRetention +
      out.reach +
      (out.topicalRelevance ?? 0) +
      (out.purchasePower ?? 0);
    expect(close(sum, 1.0)).toBe(true);
    // Phase 2 dims must be present in the output once active.
    expect(out.topicalRelevance).toBeGreaterThan(0);
    expect(out.purchasePower).toBeGreaterThan(0);
  });
});
