import { describe, it, expect } from "vitest";
import { excludeDeadYouTube, isDeadYouTube } from "./discover-shows";
import {
  podscanPodcastToShow,
  youtubeChannelToShow,
} from "./format-discovered-show";

// Build a YouTube Show through the real formatter so audience_size is set
// the way discovery sets it (averageViews) — no hand-rolled fixture.
function ytShow(averageViews: number) {
  return youtubeChannelToShow(
    {
      channelId: `yt-${averageViews}`,
      title: "Tube",
      description: "",
      publishedAt: "2020-01-01T00:00:00Z",
      subscriberCount: 100000,
      videoCount: 50,
      totalViewCount: 0,
      topicCategories: [],
    },
    {
      videos: [],
      averageViews,
      averageLikes: 0,
      averageComments: 0,
      totalVideosAnalyzed: 0,
    }
  );
}

describe("excludeDeadYouTube (Phase 2C Layer 1b zero-view YouTube filter)", () => {
  it("excludes a zero-view YouTube channel from the scored universe", () => {
    const dead = ytShow(0);
    expect(isDeadYouTube(dead)).toBe(true);
    expect(excludeDeadYouTube([dead])).toHaveLength(0);
  });

  it("retains a YouTube channel that has views", () => {
    const live = ytShow(50000);
    expect(isDeadYouTube(live)).toBe(false);
    expect(excludeDeadYouTube([live])).toEqual([live]);
  });

  it("does NOT touch podcasts: a 0-download podcast is kept (→ needs_quote, not dropped)", () => {
    const pod = podscanPodcastToShow({
      podcast_id: "p0",
      podcast_name: "Live Pod",
      reach: { audience_size: 0 },
    });
    expect(isDeadYouTube(pod)).toBe(false);
    expect(excludeDeadYouTube([pod])).toEqual([pod]);
  });
});
