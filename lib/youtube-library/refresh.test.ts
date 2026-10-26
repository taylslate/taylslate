import { describe, expect, it, vi } from "vitest";
import type { YouTubeChannelDetails } from "@/lib/enrichment/youtube";
import { createMemoryYoutubeStore, type YoutubeChannelRecord } from "./store";
import { runRefreshQueue, runYoutubeLibraryRefresh, YOUTUBE_LIBRARY_REFRESH_BUDGET } from "./refresh";

function record(channelId: string, statsRefreshedAt: string, showId: string | null = null): YoutubeChannelRecord {
  return {
    channel_id: channelId,
    title: channelId,
    description: "The channel for your training and your health",
    thumbnail_url: "https://img.example/a.jpg",
    country: "US",
    default_language: "en",
    subscriber_count: 1000,
    video_count: 40,
    total_view_count: 400_000,
    avg_recent_views: 10000,
    avg_views_method: "estimated",
    topic_categories: ["Fitness"],
    keywords: [],
    niche_tags: ["Health & Wellness"],
    niche_tags_version: 1,
    tagged_at: "2026-10-01T00:00:00.000Z",
    passed_market_filter: true,
    brand_flag: null,
    show_id: showId,
    source: "category",
    source_query: "fitness",
    first_seen_at: "2026-01-01T00:00:00.000Z",
    stats_refreshed_at: statsRefreshedAt,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  };
}

function details(channelId: string): YouTubeChannelDetails {
  return {
    channelId,
    title: `${channelId} fresh`,
    description: "The channel for your training and your health",
    publishedAt: "2020-01-01T00:00:00Z",
    subscriberCount: 5000,
    videoCount: 50,
    totalViewCount: 1_000_000,
    topicCategories: ["Fitness"],
    keywords: [],
    country: "US",
    defaultLanguage: "en",
  };
}

describe("refresh", () => {
  it("refreshes the oldest stats first and stays inside 1,000 units", async () => {
    expect(YOUTUBE_LIBRARY_REFRESH_BUDGET).toBe(1000);
    const store = createMemoryYoutubeStore();
    await store.saveChannel(record("newest", "2026-10-20T00:00:00.000Z"));
    await store.saveChannel(record("oldest", "2026-08-01T00:00:00.000Z"));
    await store.saveChannel(record("middle", "2026-09-01T00:00:00.000Z"));
    const list = vi.fn(async (ids: string[]) => ({
      found: ids.map((id) => details(id)),
      missing: [] as string[],
    }));
    const report = await runRefreshQueue({
      store,
      api: { search: async () => [], list, seedLookupCost: () => 0, lookupSeed: async () => ({ channelId: null, notFound: true }) },
      budget: 1,
      now: new Date("2026-10-26T00:00:00.000Z"),
      log: () => {},
    });
    expect(list).toHaveBeenCalledTimes(1);
    expect(list.mock.calls[0][0]).toEqual(["oldest", "middle", "newest"]);
    expect(report.units).toBe(1);
    expect(report.refreshed).toBe(3);
    expect(store.channels.get("oldest")?.title).toBe("oldest fresh");
    expect(store.channels.get("oldest")?.stats_refreshed_at).toBe("2026-10-26T00:00:00.000Z");
    expect(store.channels.get("oldest")?.niche_tags).toEqual(["Health & Wellness"]);
  });

  it("deletes a 404 and nulls or deletes rows older than 30 days that were not refreshed", async () => {
    const store = createMemoryYoutubeStore();
    const now = new Date("2026-10-26T00:00:00.000Z");
    await store.saveChannel(record("gone", "2026-10-20T00:00:00.000Z"));
    await store.saveChannel(record("linked-stale", "2026-08-01T00:00:00.000Z", "show-1"));
    await store.saveChannel(record("free-stale", "2026-08-02T00:00:00.000Z"));
    await store.saveChannel(record("fresh", "2026-10-20T00:00:00.000Z"));

    const list = vi.fn(async (ids: string[]) => {
      if (ids.includes("gone") && ids.length === 1) {
        throw new Error("YouTube API error 404");
      }
      return { found: [] as YouTubeChannelDetails[], missing: [] as string[] };
    });

    // Budget 1 refreshes only the oldest row, which is linked-stale.
    // The 404 path is a separate call below.
    const swept = await runRefreshQueue({
      store,
      api: {
        search: async () => [],
        list: async () => ({ found: [], missing: [] }),
        seedLookupCost: () => 0,
        lookupSeed: async () => ({ channelId: null, notFound: true }),
      },
      budget: 0,
      now,
      log: () => {},
    });
    expect(swept.units).toBe(0);
    expect(store.channels.has("free-stale")).toBe(false);
    expect(store.channels.has("fresh")).toBe(true);
    expect(store.channels.get("fresh")?.title).toBe("fresh");
    const linked = store.channels.get("linked-stale");
    expect(linked?.show_id).toBe("show-1");
    expect(linked?.title).toBeNull();
    expect(linked?.subscriber_count).toBeNull();
    expect(linked?.topic_categories).toEqual([]);
    expect(linked?.niche_tags).toEqual(["Health & Wellness"]);
    expect(linked?.passed_market_filter).toBe(false);
    expect(linked?.stats_refreshed_at).toBe("2026-08-01T00:00:00.000Z");

    const goneStore = createMemoryYoutubeStore();
    await goneStore.saveChannel(record("gone", "2026-10-20T00:00:00.000Z", "show-9"));
    const deleted = await runRefreshQueue({
      store: goneStore,
      api: {
        search: async () => [],
        list,
        seedLookupCost: () => 0,
        lookupSeed: async () => ({ channelId: null, notFound: true }),
      },
      budget: 1,
      now,
      log: () => {},
    });
    expect(deleted.deleted).toBeGreaterThanOrEqual(1);
    expect(goneStore.channels.has("gone")).toBe(false);
  });

  it("omitted channel ids are deleted", async () => {
    const store = createMemoryYoutubeStore();
    await store.saveChannel(record("kept", "2026-10-01T00:00:00.000Z"));
    await store.saveChannel(record("missing", "2026-10-02T00:00:00.000Z"));
    await runRefreshQueue({
      store,
      api: {
        search: async () => [],
        list: async (ids: string[]) => ({
          found: ids.filter((id) => id === "kept").map((id) => details(id)),
          missing: ids.filter((id) => id !== "kept"),
        }),
        seedLookupCost: () => 0,
        lookupSeed: async () => ({ channelId: null, notFound: true }),
      },
      now: new Date("2026-10-26T00:00:00.000Z"),
      log: () => {},
    });
    expect(store.channels.has("kept")).toBe(true);
    expect(store.channels.has("missing")).toBe(false);
  });

  it("runs batch tagging under the cap after refresh", async () => {
    const store = createMemoryYoutubeStore();
    const untagged = record("needs-tags", "2026-10-20T00:00:00.000Z");
    untagged.niche_tags = [];
    untagged.niche_tags_version = 0;
    untagged.tagged_at = null;
    untagged.topic_categories = [];
    await store.saveChannel(untagged);
    const complete = vi.fn(async () =>
      JSON.stringify({ channels: [{ channel_id: "needs-tags", tags: ["Science", "Nope"] }] })
    );
    const report = await runYoutubeLibraryRefresh({
      store,
      api: {
        search: async () => [],
        list: async (ids: string[]) => ({
        found: ids.map((id) => ({ ...details(id), topicCategories: [], keywords: [] })),
        missing: [],
      }),
        seedLookupCost: () => 0,
        lookupSeed: async () => ({ channelId: null, notFound: true }),
      },
      now: new Date("2026-10-26T00:00:00.000Z"),
      completeTags: complete,
      log: () => {},
    });
    expect(report.tagging?.calls).toBe(1);
    expect(report.tagging?.channels).toBe(1);
    expect(store.channels.get("needs-tags")?.niche_tags).toEqual(["Science"]);
    expect(store.channels.get("needs-tags")?.niche_tags_version).toBe(1);
  });
});
