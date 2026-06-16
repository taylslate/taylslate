import { describe, it, expect } from "vitest";
import { parseExclusions } from "./parse-exclusions";

describe("parseExclusions", () => {
  it("splits on commas, semicolons, and newlines", () => {
    expect(
      parseExclusions("Plunge, Therabody; Big Sauna\nHigher Dose\r\nColdCo")
    ).toEqual(["Plunge", "Therabody", "Big Sauna", "Higher Dose", "ColdCo"]);
  });

  it("trims entries and drops empties", () => {
    expect(parseExclusions("  Plunge ,, ;\n , Therabody  ")).toEqual([
      "Plunge",
      "Therabody",
    ]);
  });

  it("dedupes case-insensitively, keeping the first casing", () => {
    expect(parseExclusions("Plunge, plunge; PLUNGE, Therabody")).toEqual([
      "Plunge",
      "Therabody",
    ]);
  });

  it("returns [] for empty or whitespace-only input", () => {
    expect(parseExclusions("")).toEqual([]);
    expect(parseExclusions("   \n ; , ")).toEqual([]);
  });

  it("passes through separator-free text as a single entry", () => {
    expect(parseExclusions("No competitor sauna brands.")).toEqual([
      "No competitor sauna brands.",
    ]);
  });

  it("keeps a comma inside a quoted brand name as one entry", () => {
    expect(parseExclusions('"Athletic Greens, Inc.", Plunge')).toEqual([
      "Athletic Greens, Inc.",
      "Plunge",
    ]);
  });

  it("handles multiple quoted names with internal delimiters", () => {
    expect(
      parseExclusions('"Athletic Greens, Inc.", "Liquid I.V.; Health", Plunge')
    ).toEqual(["Athletic Greens, Inc.", "Liquid I.V.; Health", "Plunge"]);
  });

  it("treats curly double quotes as grouping quotes", () => {
    expect(parseExclusions("“Athletic Greens, Inc.”, Plunge")).toEqual([
      "Athletic Greens, Inc.",
      "Plunge",
    ]);
  });

  it("preserves apostrophes — single quotes are not grouping quotes", () => {
    expect(parseExclusions("Trader Joe's, Plunge")).toEqual([
      "Trader Joe's",
      "Plunge",
    ]);
  });

  it("flushes an unterminated quote as the final entry (no data loss)", () => {
    expect(parseExclusions('Plunge, "Athletic Greens, Inc.')).toEqual([
      "Plunge",
      "Athletic Greens, Inc.",
    ]);
  });

  it("dedupes case-insensitively across quoted entries, keeping first casing", () => {
    expect(
      parseExclusions('"Athletic Greens, Inc.", "athletic greens, inc."')
    ).toEqual(["Athletic Greens, Inc."]);
  });
});
