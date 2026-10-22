import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { applyPostAirLift, POST_AIR_SCORE_CAP } from "./post-air-lift";
import {
  applyImportLift,
  IMPORT_BRAND_LIFT_POINTS,
  IMPORT_POOL_LIFT_POINTS,
  IMPORT_POOL_MIN_BRANDS,
  type ImportBrandSignal,
  type ImportPooledPrior,
} from "./import-lift";

const signal = (conversions: number): ImportBrandSignal => ({
  records: 2,
  conversions,
  spend: 500,
  downloads: 10000,
});

const prior = (
  median: number | null,
  brandCount = IMPORT_POOL_MIN_BRANDS
): ImportPooledPrior => ({
  brandCount,
  recordCount: brandCount,
  medianCpm: 25,
  medianConversionsPer1kDownloads: median,
});

describe("applyImportLift", () => {
  it("returns delta 0 when there is no signal and no prior", () => {
    expect(applyImportLift(70, null, null)).toEqual({
      delta: 0,
      adjusted: 70,
      reasoningLine: null,
    });
  });

  it("does not lift on spend or downloads without conversions", () => {
    const quiet: ImportBrandSignal = {
      records: 4,
      conversions: 0,
      spend: 9000,
      downloads: 50000,
    };
    expect(applyImportLift(70, quiet, null)).toEqual({
      delta: 0,
      adjusted: 70,
      reasoningLine: null,
    });
  });

  it("lifts this brand's own converting imports and says so", () => {
    const lift = applyImportLift(70, signal(4), null);
    expect(lift.delta).toBe(IMPORT_BRAND_LIFT_POINTS);
    expect(lift.adjusted).toBe(70 + IMPORT_BRAND_LIFT_POINTS);
    expect(lift.reasoningLine).toBe(
      `From your past campaigns: 4 conversions. Score lifted +${IMPORT_BRAND_LIFT_POINTS}.`
    );
  });

  it("uses the singular when the brand reported one conversion", () => {
    const lift = applyImportLift(70, signal(1), null);
    expect(lift.reasoningLine).toContain("1 conversion.");
    expect(lift.reasoningLine).not.toContain("1 conversions");
  });

  it("adds a smaller nudge when a pooled group has a positive median", () => {
    expect(IMPORT_POOL_LIFT_POINTS).toBeGreaterThan(0);
    expect(IMPORT_POOL_LIFT_POINTS).toBeLessThan(IMPORT_BRAND_LIFT_POINTS);
    const lift = applyImportLift(70, null, prior(12));
    expect(lift.delta).toBe(IMPORT_POOL_LIFT_POINTS);
    expect(lift.adjusted).toBe(70 + IMPORT_POOL_LIFT_POINTS);
    expect(lift.reasoningLine).toBe(
      `Pattern across brands. Score lifted +${IMPORT_POOL_LIFT_POINTS}.`
    );
    expect(lift.reasoningLine).not.toContain("From your past campaigns");
  });

  it("stacks the brand signal and the pool, then stops at the shared cap", () => {
    const lift = applyImportLift(70, signal(3), prior(8));
    expect(lift.delta).toBe(IMPORT_BRAND_LIFT_POINTS + IMPORT_POOL_LIFT_POINTS);
    expect(lift.adjusted).toBe(70 + lift.delta);
    expect(lift.reasoningLine).toBe(
      `From your past campaigns: 3 conversions. Pattern across brands. Score lifted +${lift.delta}.`
    );

    const nearCap = applyImportLift(97, signal(3), prior(8));
    expect(nearCap.adjusted).toBe(POST_AIR_SCORE_CAP);
    expect(nearCap.delta).toBe(POST_AIR_SCORE_CAP - 97);
    expect(nearCap.delta).toBeGreaterThanOrEqual(0);

    const capped = applyImportLift(100, signal(3), prior(8));
    expect(capped.delta).toBe(0);
    expect(capped.adjusted).toBe(100);
    expect(capped.reasoningLine).toContain("Score held at 100");
    expect(capped.reasoningLine).toContain("From your past campaigns");
    expect(capped.reasoningLine).toContain("Pattern across brands");
  });

  it("counts the post-air lift toward the same cap", () => {
    const post = applyPostAirLift(95, 4);
    const next = applyImportLift(post.adjusted, signal(2), prior(6));
    expect(post.adjusted).toBe(100);
    expect(next.adjusted).toBe(100);
    expect(next.delta).toBe(0);

    const room = applyPostAirLift(80, 4);
    const stacked = applyImportLift(room.adjusted, signal(2), prior(6));
    expect(room.adjusted).toBe(88);
    expect(stacked.adjusted).toBe(88 + IMPORT_BRAND_LIFT_POINTS + IMPORT_POOL_LIFT_POINTS);
    expect(stacked.adjusted).toBeLessThanOrEqual(POST_AIR_SCORE_CAP);
  });

  it("does not nudge a group that is too small or has no conversion rate", () => {
    expect(applyImportLift(70, null, prior(4, 4)).delta).toBe(0);
    expect(applyImportLift(70, null, prior(0)).reasoningLine).toBeNull();
    expect(applyImportLift(70, null, prior(null)).delta).toBe(0);
  });

  it("does not invent a score when the composite is missing", () => {
    const lift = applyImportLift(null, signal(5), prior(9));
    expect(lift).toEqual({ delta: 0, adjusted: null, reasoningLine: null });
  });

  it("never returns a lower score", () => {
    const cases: Array<[number | null, ImportBrandSignal | null, ImportPooledPrior | null]> = [
      [40, null, null],
      [40, signal(0), null],
      [40, signal(3), null],
      [40, null, prior(2)],
      [40, signal(3), prior(2)],
      [100, signal(3), prior(2)],
      [null, signal(3), prior(2)],
      [0, signal(1), null],
    ];
    for (const [composite, brand, pool] of cases) {
      const lift = applyImportLift(composite, brand, pool);
      expect(lift.delta).toBeGreaterThanOrEqual(0);
      if (composite == null) {
        expect(lift.adjusted).toBeNull();
      } else if (lift.adjusted != null) {
        expect(lift.adjusted).toBeGreaterThanOrEqual(composite);
        expect(lift.adjusted).toBeLessThanOrEqual(POST_AIR_SCORE_CAP);
      }
    }
  });
});

describe("import lift copy", () => {
  it("has no em dash and does not mention podscan", () => {
    const src = readFileSync(join(process.cwd(), "lib/scoring/import-lift.ts"), "utf8");
    expect(src).not.toContain("\u2014");
    expect(src).not.toContain("podscan_id");
  });
});
