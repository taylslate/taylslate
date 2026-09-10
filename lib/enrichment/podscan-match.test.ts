import { describe, it, expect } from "vitest";

import {
  isRssVerifiedMatch,
  isVerifiedPodcastMatch,
  normalizeShowName,
} from "./podscan-match";
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

describe("isRssVerifiedMatch", () => {
  it("verifies on exact normalized feed equality (protocol/slash insensitive)", () => {
    expect(
      isRssVerifiedMatch(
        { rss_url: "https://feeds.x.com/rec/" },
        makePodcast({ rss_url: "http://feeds.x.com/rec" })
      )
    ).toBe(true);
    expect(
      isRssVerifiedMatch(
        { rss_url: "https://feeds.x.com/rec" },
        makePodcast({ rss_url_normalized: "feeds.x.com/rec" })
      )
    ).toBe(true);
  });

  it("never verifies without our rss_url — identical names are not consulted", () => {
    expect(isRssVerifiedMatch({ rss_url: null }, makePodcast())).toBe(false);
    expect(isRssVerifiedMatch({}, makePodcast())).toBe(false);
    expect(isRssVerifiedMatch({ rss_url: "  " }, makePodcast())).toBe(false);
  });

  it("never verifies when the podcast has no feed, and rejects mismatched feeds", () => {
    expect(
      isRssVerifiedMatch({ rss_url: "https://feeds.x.com/rec" }, makePodcast())
    ).toBe(false);
    expect(
      isRssVerifiedMatch(
        { rss_url: "https://feeds.x.com/a" },
        makePodcast({ rss_url: "https://feeds.x.com/b" })
      )
    ).toBe(false);
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
