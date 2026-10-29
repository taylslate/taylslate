import { describe, expect, it } from "vitest";
import { YOUTUBE_CATEGORY_SETS } from "./categories";
import {
  LIBRARY_CATEGORY_ORDER,
  channelLibraryCategories,
  mapRingToCategories,
} from "./ring-categories";

describe("mapRingToCategories", () => {
  it("maps protein gummies to health plus fitness, nutrition, lifestyle, and women's and mental health", () => {
    const match = mapRingToCategories({ terms: ["protein gummies"] });
    expect(match.primary).toEqual(["health"]);
    expect(match.adjacent).toEqual([
      "fitness",
      "nutrition",
      "lifestyle",
      "womens-health",
      "mental-health",
    ]);
  });

  it("maps a women's daily-wellness routine ring to health, lifestyle, and women's health", () => {
    const match = mapRingToCategories({
      terms: ["women's daily-wellness routine buyers"],
    });
    expect(match.primary).toEqual(["health", "lifestyle", "womens-health"]);
    expect(match.adjacent).toContain("fitness");
    expect(match.adjacent).not.toContain("health");
  });

  it("maps a finance ring to personal finance, with business and investing adjacent", () => {
    const match = mapRingToCategories({ terms: ["personal finance"] });
    expect(match.primary).toEqual(["personal-finance"]);
    expect(match.adjacent).toEqual(["investing", "business"]);
  });

  it("falls back to the brief category when the ring matches nothing", () => {
    const empty = mapRingToCategories({ terms: ["quilted teapot reviews"] });
    expect(empty).toEqual({ primary: [], adjacent: [] });

    const match = mapRingToCategories({
      terms: ["quilted teapot reviews"],
      interests: [],
      category: "Business & Finance",
    });
    expect(match.primary).toEqual(["personal-finance", "business"]);
    expect(match.adjacent).toEqual(["investing"]);
    expect(match).toEqual(
      mapRingToCategories({ terms: [], interests: [], category: "Business & Finance" })
    );
  });

  it("uses interests when the ring label itself matches nothing", () => {
    const match = mapRingToCategories({
      terms: ["quilted teapot reviews"],
      interests: ["Health & Wellness"],
    });
    expect(match.primary).toEqual(["health"]);
    expect(match.adjacent).toContain("fitness");
    expect(match.adjacent).toContain("lifestyle");
  });

  it("is deterministic and only names known categories", () => {
    const input = { terms: ["protein gummies"], interests: ["Health & Wellness"], category: "supplements" };
    expect(mapRingToCategories(input)).toEqual(mapRingToCategories(input));
    const known = new Set(LIBRARY_CATEGORY_ORDER);
    for (const set of YOUTUBE_CATEGORY_SETS) expect(known.has(set.id)).toBe(true);
    expect(known.has("lifestyle")).toBe(true);
    const match = mapRingToCategories(input);
    for (const id of [...match.primary, ...match.adjacent]) expect(known.has(id)).toBe(true);
  });
});

describe("channelLibraryCategories", () => {
  it("reads niche tags and the source category", () => {
    expect(
      channelLibraryCategories({ niche_tags: ["Health & Wellness"], source_query: "gym workout" })
    ).toEqual(["health", "fitness"]);
    expect(channelLibraryCategories({ niche_tags: ["Fashion & Beauty"], source_query: null })).toEqual([
      "lifestyle",
      "beauty",
    ]);
    expect(channelLibraryCategories({ niche_tags: ["Music"], source_query: "jazz piano" })).toEqual([]);
    expect(channelLibraryCategories({ niche_tags: [], source_query: "wellness" })).toEqual(["health"]);
  });
});
