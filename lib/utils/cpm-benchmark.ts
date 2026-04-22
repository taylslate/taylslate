// Market CPM benchmarks by audience tier. Used on the pricing step of
// the show onboarding flow to correct unrealistic expectations with data,
// not judgment. Numbers tie to the domain knowledge in CLAUDE.md:
// Range: $15-$50. Small shows $18-25, mid $25-35, large $30-50.

export interface CpmBenchmark {
  tier: "small" | "mid" | "large" | "premium";
  /** Human-readable range of the tier (e.g. "under 10K"). */
  tierLabel: string;
  /** Low end of realistic CPM for this tier. */
  cpmMin: number;
  /** High end of realistic CPM. */
  cpmMax: number;
  /** Single representative CPM used for the calculation example. */
  realisticCpm: number;
}

/** Return the market benchmark for the given average downloads-per-episode. */
export function getCpmBenchmark(audienceSize: number): CpmBenchmark {
  if (audienceSize >= 200000) {
    return { tier: "premium", tierLabel: "200K+", cpmMin: 35, cpmMax: 50, realisticCpm: 42 };
  }
  if (audienceSize >= 50000) {
    return { tier: "large", tierLabel: "50K-200K", cpmMin: 30, cpmMax: 50, realisticCpm: 40 };
  }
  if (audienceSize >= 10000) {
    return { tier: "mid", tierLabel: "10K-50K", cpmMin: 25, cpmMax: 35, realisticCpm: 28 };
  }
  return { tier: "small", tierLabel: "under 10K", cpmMin: 18, cpmMax: 25, realisticCpm: 22 };
}

/** Ad spot price = (downloads / 1000) × CPM rate. Rounded to whole dollars. */
export function spotPrice(audienceSize: number, cpm: number): number {
  return Math.round((audienceSize / 1000) * cpm);
}

/** "Very low" / "below market" / "in range" / "above market" classification. */
export type CpmVerdict = "below_market" | "in_range" | "above_market";

export function classifyExpectedCpm(
  audienceSize: number,
  expectedCpm: number
): CpmVerdict {
  const bench = getCpmBenchmark(audienceSize);
  if (expectedCpm < bench.cpmMin) return "below_market";
  if (expectedCpm > bench.cpmMax) return "above_market";
  return "in_range";
}
