import { describe, expect, it } from "vitest";
import {
  MAX_YOUTUBE_SEARCHES,
  buildDiscoveryQueries,
  buildYouTubeQueries,
} from "./category-mapping";

describe("buildYouTubeQueries", () => {
  it("builds one query per ring from that ring's own terms, capped at 4", () => {
    expect(MAX_YOUTUBE_SEARCHES).toBe(4);
    const queries = buildYouTubeQueries({
      target_interests: ["Health & Wellness"],
      keywords: ["sauna", "cold plunge"],
      ring_terms: [
        "endurance athletes",
        "busy parents",
        "strength training",
        "home cooking shows",
        "this fifth ring is dropped",
      ],
    });
    expect(queries).toEqual([
      "endurance athletes",
      "busy parents",
      "strength training",
      "home cooking shows",
    ]);
    expect(queries).toHaveLength(MAX_YOUTUBE_SEARCHES);
    expect(queries.join(" ")).not.toContain("sauna");
    expect(queries.join(" ")).not.toContain("fifth");
  });

  it("collapses duplicate ring labels before the cap", () => {
    const queries = buildYouTubeQueries({
      target_interests: [],
      keywords: [],
      ring_terms: [
        "Endurance Athletes",
        "endurance athletes",
        "busy parents",
        "strength training",
        "home cooking",
      ],
    });
    expect(queries).toEqual([
      "Endurance Athletes",
      "busy parents",
      "strength training",
      "home cooking",
    ]);
  });

  it("keeps at most 8 words of a long ring label", () => {
    const queries = buildYouTubeQueries({
      target_interests: [],
      keywords: [],
      ring_terms: ["one two three four five six seven eight nine ten"],
    });
    expect(queries).toEqual(["one two three four five six seven eight"]);
  });

  it("falls back to one interest query when there are no ring terms", () => {
    const queries = buildYouTubeQueries({
      target_interests: ["Health & Wellness"],
      keywords: ["sauna"],
    });
    expect(queries).toEqual(["fitness workout sauna"]);
  });

  it("skips blank ring labels", () => {
    const queries = buildYouTubeQueries({
      target_interests: ["Health & Wellness"],
      keywords: ["sauna"],
      ring_terms: ["  ", "endurance athletes"],
    });
    expect(queries).toEqual(["endurance athletes"]);
  });
});

describe("buildDiscoveryQueries (podcast, unchanged)", () => {
  it("still builds the interest and keyword queries for a health brief", () => {
    const queries = buildDiscoveryQueries({
      target_interests: ["Health & Wellness"],
      keywords: ["sauna", "recovery"],
      platforms: ["podcast"],
    });
    expect(queries.map((q) => q.query)).toEqual([
      "sauna recovery",
      "fitness workout wellness",
      "self improvement motivation science research",
      "sauna recovery fitness",
      "health wellness podcast",
    ]);
    expect(queries[0].perPage).toBe(25);
    expect(queries[4].hasSponsors).toBe(true);
    expect(queries[4].perPage).toBe(15);
  });
});
