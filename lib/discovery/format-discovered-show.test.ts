import { describe, it, expect } from "vitest";

import {
  podscanPodcastToShow,
  podscanDemographicsToShowDemographics,
} from "./format-discovered-show";
import type { PodscanDemographics, PodscanPodcast } from "@/lib/enrichment/podscan";

function makePodcast(overrides: Partial<PodscanPodcast> = {}): PodscanPodcast {
  return {
    podcast_id: "pd_abc123",
    podcast_name: "Recovery Lab",
    podcast_description: "A show about recovery",
    reach: { audience_size: 50000 },
    ...overrides,
  };
}

describe("podscanPodcastToShow", () => {
  it("carries podscan_id onto the Show (not just the temp id)", () => {
    const show = podscanPodcastToShow(makePodcast());
    expect(show.podscan_id).toBe("pd_abc123");
    expect(show.id).toBe("discovered-podscan-pd_abc123");
  });
});

describe("podscanDemographicsToShowDemographics", () => {
  it("maps the 7 Podscan age buckets onto 5: drops 0-18, folds 55-64 + 65+ into age_55_plus", () => {
    const demo = podscanDemographicsToShowDemographics({
      age_distribution: [
        { age: "0-18", percentage: 4 },
        { age: "18-24", percentage: 10 },
        { age: "25-34", percentage: 30 },
        { age: "35-44", percentage: 26 },
        { age: "45-54", percentage: 15 },
        { age: "55-64", percentage: 10 },
        { age: "65+", percentage: 5 },
      ],
    });
    expect(demo).toMatchObject({
      age_18_24: 10,
      age_25_34: 30,
      age_35_44: 26,
      age_45_54: 15,
      age_55_plus: 15, // 10 + 5
    });
    expect("age_0_18" in demo).toBe(false);
  });

  it("prefers real age_gender_distribution sums over the categorical skew", () => {
    const demo = podscanDemographicsToShowDemographics({
      gender_skew: "heavily_male", // would anchor 85/15 — must be ignored
      age_gender_distribution: [
        { age: "25-34", gender: "male", percentage: 30 },
        { age: "35-44", gender: "male", percentage: 25 },
        { age: "25-34", gender: "female", percentage: 28 },
        { age: "35-44", gender: "female", percentage: 17 },
      ],
    });
    expect(demo.male).toBe(55);
    expect(demo.female).toBe(45);
  });

  it.each([
    ["heavily_male", 85, 15],
    ["mostly_male", 70, 30],
    ["leaning_male", 60, 40],
    ["balanced", 50, 50],
    ["diverse", 50, 50],
    ["mixed", 50, 50],
    ["leaning_female", 40, 60],
    ["mostly_female", 30, 70],
    ["heavily_female", 15, 85],
  ])("falls back to gender_skew %s → male %d / female %d", (skew, male, female) => {
    const demo = podscanDemographicsToShowDemographics({ gender_skew: skew });
    expect(demo.male).toBe(male);
    expect(demo.female).toBe(female);
  });

  it("unknown gender_skew leaves male/female unset", () => {
    const demo = podscanDemographicsToShowDemographics({
      gender_skew: "something_new",
    });
    expect(demo.male).toBeUndefined();
    expect(demo.female).toBeUndefined();
  });

  it("null/absent sections produce an empty object (scorer degrades honestly)", () => {
    expect(
      podscanDemographicsToShowDemographics({
        age_distribution: null,
        age_gender_distribution: null,
        gender_skew: null,
      })
    ).toEqual({});
    expect(podscanDemographicsToShowDemographics({} as PodscanDemographics)).toEqual({});
  });

  it("skips malformed entries (missing percentage / unknown bucket) without throwing", () => {
    const demo = podscanDemographicsToShowDemographics({
      age_distribution: [
        { age: "25-34", percentage: 40 },
        { age: "18ish", percentage: 10 }, // unknown bucket
        { age: "35-44" } as unknown as { age: string; percentage: number },
      ],
    });
    expect(demo).toEqual({ age_25_34: 40 });
  });
});
