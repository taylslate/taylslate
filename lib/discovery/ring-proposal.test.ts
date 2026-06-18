import { describe, it, expect } from "vitest";
import { parseProposedRing } from "./ring-proposal";

function ring(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    ring_label: "van-life & overlanding",
    confidence: "medium",
    reasoning: "Vehicle-based recovery buyers the brand flagged.",
    analog_campaigns: ["HeatWorks"],
    ...overrides,
  });
}

describe("parseProposedRing", () => {
  it("parses a well-formed ring (fenced or not)", () => {
    const result = parseProposedRing("```json\n" + ring() + "\n```");
    expect("ring" in result).toBe(true);
    if ("ring" in result) {
      expect(result.ring.ring_label).toBe("van-life & overlanding");
      expect(result.ring.confidence).toBe("medium");
      expect(result.ring.reasoning).toContain("Vehicle-based");
      expect(result.ring.analog_campaigns).toEqual(["HeatWorks"]);
    }
  });

  it("accepts an explicit 'speculative' confidence", () => {
    const result = parseProposedRing(ring({ confidence: "speculative" }));
    expect("ring" in result).toBe(true);
  });

  it("rejects non-JSON as malformed", () => {
    expect(parseProposedRing("not json")).toEqual({ error: "malformed" });
  });

  it("rejects a missing/empty ring_label as malformed", () => {
    expect(parseProposedRing(ring({ ring_label: "" }))).toEqual({
      error: "malformed",
    });
    expect(parseProposedRing(JSON.stringify({ confidence: "high", reasoning: "x" }))).toEqual(
      { error: "malformed" }
    );
  });

  it("rejects a missing confidence as malformed (no silent default)", () => {
    const noConfidence = JSON.stringify({
      ring_label: "x",
      reasoning: "some reasoning",
    });
    expect(parseProposedRing(noConfidence)).toEqual({ error: "malformed" });
  });

  it("rejects a garbage confidence value as malformed", () => {
    expect(parseProposedRing(ring({ confidence: "very-high" }))).toEqual({
      error: "malformed",
    });
  });

  it("rejects empty / whitespace reasoning as malformed", () => {
    expect(parseProposedRing(ring({ reasoning: "" }))).toEqual({
      error: "malformed",
    });
    expect(parseProposedRing(ring({ reasoning: "   " }))).toEqual({
      error: "malformed",
    });
  });
});
