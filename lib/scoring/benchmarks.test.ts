import { describe, it, expect } from "vitest";
import { purchaseRateGuidance, type GenreBenchmark } from "./benchmarks";

const TRUE_CRIME: GenreBenchmark = {
  genre: "True Crime",
  metric: "purchase_rate",
  value: 0.04,
  source: "Example Publisher, 2024 listener study",
  as_of: "2024-06-01",
};

const COMEDY: GenreBenchmark = {
  genre: "Comedy",
  metric: "purchase_rate",
  value: 0.01,
  source: "Example Publisher, 2024 listener study",
  as_of: "2024-06-01",
};

describe("purchaseRateGuidance", () => {
  it("quotes one cited rate and does not move the score", () => {
    const result = purchaseRateGuidance(["True Crime"], [TRUE_CRIME]);
    expect(result.delta).toBe(0);
    expect(result.line).toBe(
      "True Crime purchase-rate benchmark: 4% (Example Publisher, 2024 listener study, as of 2024-06-01). Guidance only."
    );
  });

  it("nudges within ±4 only when two cited genres can be compared", () => {
    const high = purchaseRateGuidance(["True Crime"], [TRUE_CRIME, COMEDY]);
    const low = purchaseRateGuidance(["Comedy"], [TRUE_CRIME, COMEDY]);
    expect(high.delta).toBe(4);
    expect(low.delta).toBe(-4);
  });

  it("treats a null value as no benchmark, not as zero", () => {
    const result = purchaseRateGuidance(
      ["True Crime"],
      [{ genre: "True Crime", metric: "purchase_rate", value: null, source: "unpublished" }]
    );
    expect(result).toEqual({ line: null, delta: 0 });
  });

  it("ignores a genre that has no row", () => {
    expect(purchaseRateGuidance(["News"], [TRUE_CRIME, COMEDY])).toEqual({
      line: null,
      delta: 0,
    });
  });

  it("reads a percent stored above 1 as a percent, not a fraction", () => {
    const result = purchaseRateGuidance(
      ["News"],
      [{ genre: "News", metric: "purchase_rate", value: 2.4, source: "Cited report", as_of: "2023-01-01" }]
    );
    expect(result.line).toContain("2.4%");
    expect(result.delta).toBe(0);
  });

  it("does nothing with an empty table", () => {
    expect(purchaseRateGuidance(["Comedy"], [])).toEqual({ line: null, delta: 0 });
    expect(purchaseRateGuidance(["Comedy"], null)).toEqual({ line: null, delta: 0 });
  });
});
