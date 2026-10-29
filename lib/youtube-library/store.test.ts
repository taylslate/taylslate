import { describe, expect, it } from "vitest";
import type { YouTubeChannelDetails } from "@/lib/enrichment/youtube";
import {
  createMemoryYoutubeStore,
  draftToRecord,
  pickUniqueShowId,
  uploadsStatsAffordable,
  UPLOADS_STATS_UNITS,
  YOUTUBE_LIBRARY_PULL_BUDGET,
  type ChannelDraft,
} from "./store";

const CHANNEL = "UCabcdefghijklmnopqrstuv";

function details(overrides: Partial<YouTubeChannelDetails> = {}): YouTubeChannelDetails {
  return {
    channelId: CHANNEL,
    title: "Huberman Lab",
    description: "The channel for your training and your health",
    publishedAt: "2020-01-01T00:00:00Z",
    subscriberCount: 100000,
    videoCount: 40,
    totalViewCount: 2_000_000,
    topicCategories: ["Physical fitness"],
    keywords: ["workout"],
    country: "US",
    defaultLanguage: "en",
    customUrl: "@HubermanLab",
    ...overrides,
  };
}

function draft(overrides: Partial<ChannelDraft> = {}): ChannelDraft {
  return {
    details: details(),
    passedMarketFilter: true,
    brandFlag: null,
    source: "category",
    sourceQuery: "fitness coach",
    now: "2026-10-26T00:00:00.000Z",
    ...overrides,
  };
}

describe("unique show linking", () => {
  it("links one show and leaves zero or many matches empty", () => {
    const only = pickUniqueShowId(CHANNEL, "@HubermanLab", [
      { id: "show-1", platform: "youtube", youtube_channel_id: CHANNEL, surfaces: null },
    ]);
    expect(only).toBe("show-1");

    const podcast = pickUniqueShowId(CHANNEL, "@HubermanLab", [
      {
        id: "pod-1",
        platform: "podcast",
        youtube_channel_id: null,
        surfaces: { youtube: { links: { channel: "https://www.youtube.com/@HubermanLab" } } },
      },
    ]);
    expect(podcast).toBe("pod-1");

    const sameShowTwice = pickUniqueShowId(CHANNEL, "@HubermanLab", [
      {
        id: "pod-1",
        platform: "podcast",
        youtube_channel_id: CHANNEL,
        surfaces: { youtube: { links: { channel: `https://www.youtube.com/channel/${CHANNEL}` } } },
      },
    ]);
    expect(sameShowTwice).toBe("pod-1");

    expect(pickUniqueShowId(CHANNEL, "@HubermanLab", [])).toBeNull();
    expect(
      pickUniqueShowId(CHANNEL, "@HubermanLab", [
        { id: "a", platform: "youtube", youtube_channel_id: CHANNEL, surfaces: null },
        { id: "b", platform: "youtube", youtube_channel_id: CHANNEL, surfaces: null },
      ])
    ).toBeNull();
    expect(
      pickUniqueShowId(CHANNEL, "@HubermanLab", [
        {
          id: "other",
          platform: "podcast",
          youtube_channel_id: null,
          surfaces: { youtube: { links: { channel: "https://www.youtube.com/@SomeoneElse" } } },
        },
      ])
    ).toBeNull();
  });

  it("stores the link from the show list and does not create a show", async () => {
    const store = createMemoryYoutubeStore([
      { id: "show-1", platform: "youtube", youtube_channel_id: CHANNEL, surfaces: null },
    ]);
    const record = draftToRecord(null, draft(), await store.uniqueShowId(CHANNEL, "@HubermanLab"));
    await store.saveChannel(record);
    expect(store.channels.get(CHANNEL)?.show_id).toBe("show-1");
    expect(store.shows).toHaveLength(1);
    expect(store.channels.get(CHANNEL)?.niche_tags).toEqual(["Health & Wellness"]);
    expect(store.channels.get(CHANNEL)?.passed_market_filter).toBe(true);
  });
});

describe("avg views method", () => {
  it("records recent for a playlist measurement and estimated for the fallback", () => {
    expect(UPLOADS_STATS_UNITS).toBe(2);
    expect(YOUTUBE_LIBRARY_PULL_BUDGET).toBe(8000);
    expect(uploadsStatsAffordable(7998, 8000)).toBe(true);
    expect(uploadsStatsAffordable(7999, 8000)).toBe(false);

    const measured = draftToRecord(null, draft({ averageViews: 12000, viewsMethod: "recent" }), null);
    expect(measured.avg_views_method).toBe("recent");
    expect(measured.avg_recent_views).toBe(12000);

    const fallback = draftToRecord(null, draft({ viewsMethod: "estimated" }), null);
    expect(fallback.avg_views_method).toBe("estimated");
    expect(fallback.avg_recent_views).toBe(50000);

    const untouched = draftToRecord(null, draft(), null);
    expect(untouched.avg_views_method).toBe("estimated");
    expect(untouched.avg_recent_views).toBe(50000);
  });
});

describe("queue dedupe", () => {
  it("inserts one row per kind and value", async () => {
    const store = createMemoryYoutubeStore();
    const first = await store.enqueue([
      { kind: "category_query", value: "health tips" },
      { kind: "category_query", value: "health tips" },
      { kind: "seed_channel", value: "https://www.youtube.com/@HubermanLab" },
    ]);
    const second = await store.enqueue([
      { kind: "category_query", value: "health tips" },
      { kind: "seed_channel", value: "https://www.youtube.com/@HubermanLab" },
    ]);
    expect(first).toBe(2);
    expect(second).toBe(0);
    expect(store.queue).toHaveLength(2);
  });
});
