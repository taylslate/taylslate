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

  it("normalizes hyphens, slashes, possessive 's, and punctuation, and keeps 5 words", () => {
    expect(
      buildYouTubeQueries({
        target_interests: [],
        keywords: ["keep"],
        ring_terms: ["ingredient-literate women's wellness"],
      })[0]
    ).toBe("ingredient literate women wellness");

    expect(
      buildYouTubeQueries({
        target_interests: [],
        keywords: ["keep"],
        ring_terms: ["mom/dad routines"],
      })[0]
    ).toBe("mom dad routines");

    expect(
      buildYouTubeQueries({
        target_interests: [],
        keywords: ["keep"],
        ring_terms: ["wellness, recovery!"],
      })[0]
    ).toBe("wellness recovery");

    expect(
      buildYouTubeQueries({
        target_interests: [],
        keywords: ["keep"],
        ring_terms: ["one two three four five six seven eight nine ten"],
      })[0]
    ).toBe("one two three four five");

    expect(
      buildYouTubeQueries({
        target_interests: [],
        keywords: ["keep"],
        ring_terms: ["ingredient-literate women’s wellness"],
      })[0]
    ).toBe("ingredient literate women wellness");
  });

  it("tops up a single narrow ring with the interest query and a shorter tail", () => {
    const queries = buildYouTubeQueries({
      target_interests: ["Health & Wellness"],
      keywords: [],
      ring_terms: ["ingredient-literate women's wellness"],
    });
    expect(queries.length).toBeGreaterThanOrEqual(2);
    expect(queries.length).toBeLessThanOrEqual(MAX_YOUTUBE_SEARCHES);
    expect(queries).toEqual([
      "ingredient literate women wellness",
      "fitness workout",
      "literate womens wellness",
      "womens wellness",
    ]);
  });

  it("does not top up when 4 ring queries already fill the cap", () => {
    const queries = buildYouTubeQueries({
      target_interests: ["Health & Wellness"],
      keywords: ["sauna"],
      ring_terms: [
        "endurance athletes",
        "busy parents",
        "strength training",
        "home cooking",
      ],
    });
    expect(queries).toEqual([
      "endurance athletes",
      "busy parents",
      "strength training",
      "home cooking",
    ]);
    expect(queries.join(" ")).not.toContain("fitness");
    expect(queries.join(" ")).not.toContain("sauna");
  });

  it("stops at 4 when interest and shorter tails would otherwise exceed the cap", () => {
    const queries = buildYouTubeQueries({
      target_interests: ["Health & Wellness"],
      keywords: [],
      ring_terms: ["alpha beta gamma delta", "epsilon zeta eta theta"],
    });
    expect(queries).toEqual([
      "alpha beta gamma delta",
      "epsilon zeta eta theta",
      "fitness workout",
      "beta gamma delta",
    ]);
    expect(queries).toHaveLength(MAX_YOUTUBE_SEARCHES);
    expect(queries).not.toContain("gamma delta");
    expect(queries).not.toContain("eta theta");
  });

  it("falls back to one interest query when there are no ring terms", () => {
    const queries = buildYouTubeQueries({
      target_interests: ["Health & Wellness"],
      keywords: ["sauna"],
    });
    expect(queries).toEqual(["fitness workout sauna"]);
  });

  it("skips blank ring labels and still tops up under the cap", () => {
    const queries = buildYouTubeQueries({
      target_interests: ["Health & Wellness"],
      keywords: ["sauna"],
      ring_terms: ["  ", "endurance athletes"],
    });
    expect(queries).toEqual(["endurance athletes", "fitness workout sauna"]);
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
