import { describe, expect, it } from "vitest";
import { countKept, decideKeep, summarizeKeeps, type KeepShow } from "./keep";

const fixture: KeepShow[] = [
  { sponsoredLast12m: true, audienceSize: 0 },
  { sponsoredLast12m: true, audienceSize: null },
  { sponsoredLast12m: false, audienceSize: 999 },
  { sponsoredLast12m: false, audienceSize: 1000 },
  { sponsoredLast12m: false, audienceSize: 2500 },
  { sponsoredLast12m: false, audienceSize: 5000 },
  { sponsoredLast12m: false, audienceSize: null },
];

describe("keep rule", () => {
  it("keeps a sponsored show with audience 0 or null", () => {
    expect(decideKeep(fixture[0], 1000)).toEqual({ kept: true, reason: "sponsored" });
    expect(decideKeep(fixture[1], 5000)).toEqual({ kept: true, reason: "sponsored" });
  });

  it("drops a non-sponsored show at 999 from the 1k floor", () => {
    expect(decideKeep(fixture[2], 1000)).toEqual({ kept: false, reason: null });
  });

  it("never lets a missing audience pass the floor", () => {
    expect(decideKeep(fixture[6], 1000).kept).toBe(false);
  });

  it("counts floors exactly", () => {
    expect(summarizeKeeps(fixture)).toEqual({
      sponsored: 2,
      kept: { 1000: 5, 2500: 4, 5000: 3 },
    });
    expect(countKept(fixture, 1000)).toBe(5);
    expect(countKept(fixture, 2500)).toBe(4);
    expect(countKept(fixture, 5000)).toBe(3);
  });
});
