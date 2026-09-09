import { describe, it, expect } from "vitest";

import { isVerifiedPodcastMatch, normalizeShowName } from "./podscan-match";
import type { PodscanPodcast } from "./podscan";

function makePodcast(overrides: Partial<PodscanPodcast> = {}): PodscanPodcast {
  return {
    podcast_id: "pd_1",
    podcast_name: "Recovery Lab",
    ...overrides,
  };
}

describe("normalizeShowName", () => {
  it("lowercases, decodes &amp;, collapses whitespace", () => {
    expect(normalizeShowName("  Health &amp;  Wellness SHOW ")).toBe(
      "health & wellness show"
    );
  });
});

describe("isVerifiedPodcastMatch", () => {
  it("matches on RSS equality, protocol/trailing-slash insensitive", () => {
    expect(
      isVerifiedPodcastMatch(
        { name: "Different Name Entirely", rss_url: "https://feeds.x.com/rec/" },
        makePodcast({ rss_url: "http://feeds.x.com/rec" })
      )
    ).toBe(true);
  });

  it("REJECTS on RSS mismatch even when names are identical (rss is authoritative)", () => {
    expect(
      isVerifiedPodcastMatch(
        { name: "Recovery Lab", rss_url: "https://feeds.x.com/a" },
        makePodcast({ rss_url: "https://feeds.x.com/b" })
      )
    ).toBe(false);
  });

  it("accepts a match against rss_url_normalized too", () => {
    expect(
      isVerifiedPodcastMatch(
        { name: "Other", rss_url: "https://feeds.x.com/rec" },
        makePodcast({ rss_url_normalized: "feeds.x.com/rec" })
      )
    ).toBe(true);
  });

  it("falls back to exact normalized-name equality when either side lacks RSS", () => {
    expect(
      isVerifiedPodcastMatch(
        { name: "recovery lab", rss_url: null },
        makePodcast({ podcast_name: "Recovery  Lab" })
      )
    ).toBe(true);
    expect(
      isVerifiedPodcastMatch(
        { name: "Recovery Lab" },
        makePodcast({ podcast_name: "Recovery Lab", rss_url: "https://feeds.x.com/rec" })
      )
    ).toBe(true);
  });

  it("containment is NOT enough — 'Recovery' must not verify against 'Recovery Lab'", () => {
    expect(
      isVerifiedPodcastMatch({ name: "Recovery" }, makePodcast())
    ).toBe(false);
  });
});
