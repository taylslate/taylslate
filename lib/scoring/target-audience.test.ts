import { describe, it, expect } from "vitest";

import { buildTargetAudience } from "./target-audience";

describe("buildTargetAudience", () => {
  it("maps a fully-set profile, passing gender through verbatim", () => {
    expect(
      buildTargetAudience({
        target_age_min: 25,
        target_age_max: 44,
        target_gender: "mostly_women",
      })
    ).toEqual({ age_min: 25, age_max: 44, gender: "mostly_women" });
  });

  it.each(["mostly_men", "mostly_women", "mixed"] as const)(
    "passes %s through (normalizeGenderTarget handles the source value)",
    (gender) => {
      expect(buildTargetAudience({ target_gender: gender })).toEqual({ gender });
    }
  );

  it("OMITS gender for no_preference — a stated no-preference must not reward balanced shows", () => {
    expect(
      buildTargetAudience({
        target_age_min: 30,
        target_age_max: 55,
        target_gender: "no_preference",
      })
    ).toEqual({ age_min: 30, age_max: 55 });
  });

  it("returns null when no_preference is the only field set (nothing to target)", () => {
    expect(buildTargetAudience({ target_gender: "no_preference" })).toBeNull();
  });

  it("handles a partial age range (min only / max only)", () => {
    expect(buildTargetAudience({ target_age_min: 35 })).toEqual({ age_min: 35 });
    expect(buildTargetAudience({ target_age_max: 54 })).toEqual({ age_max: 54 });
  });

  it("ignores null age fields", () => {
    expect(
      buildTargetAudience({
        target_age_min: null,
        target_age_max: null,
        target_gender: "mixed",
      })
    ).toEqual({ gender: "mixed" });
  });

  it("returns null for a null profile or an empty one", () => {
    expect(buildTargetAudience(null)).toBeNull();
    expect(buildTargetAudience({})).toBeNull();
    expect(
      buildTargetAudience({
        target_age_min: null,
        target_age_max: null,
        target_gender: null,
      })
    ).toBeNull();
  });
});
