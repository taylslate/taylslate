import { describe, expect, it } from "vitest";
import { parseArgs } from "./args";

describe("parseArgs", () => {
  it("defaults to a dry run", () => {
    expect(parseArgs([])).toEqual({
      commit: false,
      dryRunExplicit: false,
      floor: null,
      confirm: null,
      sample: null,
      maxPodscanCalls: 4500,
      activeDays: 365,
      language: "en",
      region: null,
    });
  });

  it("reads equals and space forms", () => {
    expect(parseArgs(["--commit", "--floor", "2500", "--confirm=12", "--region", "us"]).floor).toBe(2500);
    expect(parseArgs(["--confirm=0"]).confirm).toBe(0);
    expect(parseArgs(["--language=en", "--active-days=30", "--max-podscan-calls=10", "--sample=25"])).toMatchObject({
      language: "en",
      activeDays: 30,
      maxPodscanCalls: 10,
      sample: 25,
    });
  });

  it("rejects a bad flag", () => {
    expect(() => parseArgs(["--floor"])).toThrow("Missing a flag value.");
    expect(() => parseArgs(["--nope=1"])).toThrow("Unknown flag.");
    expect(() => parseArgs(["--floor=1.5"])).toThrow("Bad number.");
  });
});
