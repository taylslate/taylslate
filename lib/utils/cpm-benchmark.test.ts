import { describe, it, expect } from "vitest";
import {
  classifyExpectedCpm,
  getCpmBenchmark,
  spotPrice,
} from "./cpm-benchmark";

describe("getCpmBenchmark", () => {
  it("returns the small tier for audiences under 10K", () => {
    expect(getCpmBenchmark(0).tier).toBe("small");
    expect(getCpmBenchmark(5000).tier).toBe("small");
    expect(getCpmBenchmark(9999).tier).toBe("small");
  });

  it("returns the mid tier at 10K and up to 50K", () => {
    expect(getCpmBenchmark(10000).tier).toBe("mid");
    expect(getCpmBenchmark(49999).tier).toBe("mid");
  });

  it("returns the large tier at 50K and up to 200K", () => {
    expect(getCpmBenchmark(50000).tier).toBe("large");
    expect(getCpmBenchmark(150000).tier).toBe("large");
  });

  it("returns the premium tier at 200K+", () => {
    expect(getCpmBenchmark(200000).tier).toBe("premium");
    expect(getCpmBenchmark(1_000_000).tier).toBe("premium");
  });

  it("keeps ranges in the CLAUDE.md $15-$50 band", () => {
    for (const size of [1000, 25000, 100000, 500000]) {
      const b = getCpmBenchmark(size);
      expect(b.cpmMin).toBeGreaterThanOrEqual(15);
      expect(b.cpmMax).toBeLessThanOrEqual(50);
      expect(b.realisticCpm).toBeGreaterThanOrEqual(b.cpmMin);
      expect(b.realisticCpm).toBeLessThanOrEqual(b.cpmMax);
    }
  });
});

describe("spotPrice", () => {
  it("matches the formula Ad Spot Price = (Downloads ÷ 1000) × CPM", () => {
    expect(spotPrice(10000, 25)).toBe(250);
    expect(spotPrice(50000, 30)).toBe(1500);
    expect(spotPrice(200, 20)).toBe(4); // (200/1000)*20 = 4
  });

  it("rounds to whole dollars", () => {
    expect(spotPrice(1500, 23)).toBe(Math.round((1500 / 1000) * 23));
  });
});

describe("classifyExpectedCpm", () => {
  it("returns in_range when inside tier bounds", () => {
    expect(classifyExpectedCpm(5000, 22)).toBe("in_range");
    expect(classifyExpectedCpm(25000, 30)).toBe("in_range");
  });

  it("returns below_market when beneath the tier floor", () => {
    expect(classifyExpectedCpm(5000, 10)).toBe("below_market");
  });

  it("returns above_market when above the tier ceiling", () => {
    // A 200-download show asking $100 CPM is the classic Podcorn failure mode.
    expect(classifyExpectedCpm(200, 100)).toBe("above_market");
  });
});
