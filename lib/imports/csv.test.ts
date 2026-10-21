import { describe, expect, it } from "vitest";
import { parseCSV, parseCSVLine } from "./csv";

describe("parseCSVLine", () => {
  it("splits a plain line", () => {
    expect(parseCSVLine("Acquired,25,mid-roll")).toEqual(["Acquired", "25", "mid-roll"]);
  });

  it("keeps commas and escaped quotes inside quotes", () => {
    expect(parseCSVLine('"Odd Lots, Bloomberg","He said ""hi"""')).toEqual([
      "Odd Lots, Bloomberg",
      'He said "hi"',
    ]);
  });
});

describe("parseCSV", () => {
  it("keeps newlines inside quotes and strips a BOM", () => {
    const text = '\uFEFFShow,Notes\r\n"Acquired","line1\nline2"\r\n';
    expect(parseCSV(text)).toEqual([
      ["Show", "Notes"],
      ["Acquired", "line1\nline2"],
    ]);
  });

  it("drops blank rows", () => {
    expect(parseCSV("Show,Rate\n\nAcquired,25\n")).toEqual([
      ["Show", "Rate"],
      ["Acquired", "25"],
    ]);
  });
});
