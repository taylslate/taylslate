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
});
