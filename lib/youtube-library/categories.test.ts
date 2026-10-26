import { describe, expect, it } from "vitest";
import { YOUTUBE_CATEGORY_SETS, categoryQueueValues } from "./categories";

describe("youtube category queue", () => {
  it("lists 20 sets of 4 to 6 phrases and queues each phrase once", () => {
    expect(YOUTUBE_CATEGORY_SETS).toHaveLength(20);
    const values = categoryQueueValues();
    expect(new Set(values).size).toBe(values.length);
    expect(values.length).toBeGreaterThanOrEqual(80);
    expect(values.length).toBeLessThanOrEqual(120);
    for (const set of YOUTUBE_CATEGORY_SETS) {
      expect(set.phrases.length).toBeGreaterThanOrEqual(4);
      expect(set.phrases.length).toBeLessThanOrEqual(6);
      for (const phrase of set.phrases) {
        expect(phrase.trim()).toBe(phrase);
        expect(phrase.length).toBeGreaterThan(0);
      }
    }
    expect(values).toContain("mental health");
    expect(values).toContain("personal finance");
    expect(values).toContain("true crime");
  });
});
