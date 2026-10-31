import { describe, expect, it, vi } from "vitest";
import type { YouTubeChannelDetails } from "@/lib/enrichment/youtube";
import { createMemoryYoutubeStore, type YoutubeChannelRecord } from "./store";
import { UPLOADS_STATS_UNITS } from "./store";
import { uploadsBatchWorstCaseUnits } from "./pull";
import {
  runRefreshQueue,
  runYoutubeLibraryRefresh,
  YOUTUBE_LIBRARY_REFRESH_BUDGET,
  YOUTUBE_LIBRARY_REFRESH_PASS_BUDGET_MS,
  YOUTUBE_LIBRARY_REFRESH_TIME_BUDGET_MS,
} from "./refresh";

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
      budget: 1000,
      now,
      log: () => {},
    });
    expect(swept.units).toBe(1);
    expect(swept.stopped).toBeNull();
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

  it("counts 2 units per uploads read and leaves the rest on the estimate", async () => {
    expect(YOUTUBE_LIBRARY_REFRESH_BUDGET).toBe(1000);
    expect(UPLOADS_STATS_UNITS).toBe(2);
    const store = createMemoryYoutubeStore();
    await store.saveChannel(record("newest", "2026-10-20T00:00:00.000Z"));
    await store.saveChannel(record("oldest", "2026-08-01T00:00:00.000Z"));
    await store.saveChannel(record("middle", "2026-09-01T00:00:00.000Z"));
    const recentUploads = vi.fn(async (channelId: string) => {
      if (channelId === "middle") {
        throw new Error("YouTube API error 403: key=TESTKEY");
      }
      return { kind: "uploads" as const, averageViews: 12000 };
    });
    const lines: string[] = [];
    const report = await runRefreshQueue({
      store,
      api: {
        search: async () => [],
        list: async (ids: string[]) => ({
          found: ids.map((id) => details(id)),
          missing: [],
        }),
        seedLookupCost: () => 0,
        lookupSeed: async () => ({ channelId: null, notFound: true }),
        recentUploads,
      },
      budget: 1 + UPLOADS_STATS_UNITS * 2,
      now: new Date("2026-10-26T00:00:00.000Z"),
      log: (line) => lines.push(line),
    });
    expect(report.units).toBe(5);
    expect(report.refreshed).toBe(2);
    expect(report.stopped).toBe("budget");
    expect(recentUploads.mock.calls.map((call) => call[0])).toEqual(["oldest", "middle"]);
    expect(store.channels.get("oldest")?.avg_views_method).toBe("recent");
    expect(store.channels.get("oldest")?.avg_recent_views).toBe(12000);
    expect(store.channels.get("middle")?.avg_views_method).toBe("estimated");
    expect(store.channels.get("middle")?.avg_recent_views).toBe(20000);
    expect(store.channels.get("newest")?.stats_refreshed_at).toBe("2026-10-20T00:00:00.000Z");
    const logged = lines.join("\n");
    expect(logged).toContain("key=[redacted]");
    expect(logged).not.toContain("TESTKEY");
    expect(JSON.stringify(report)).not.toContain("TESTKEY");
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
    expect(report.elapsedMs).toBeGreaterThanOrEqual(0);
    expect(report.chunks).toBe(1);
  });
});

function api(list: (ids: string[]) => Promise<{ found: YouTubeChannelDetails[]; missing: string[] }>, extra: Record<string, unknown> = {}) {
  return {
    search: async () => [] as string[],
    list,
    seedLookupCost: () => 0,
    lookupSeed: async () => ({ channelId: null, notFound: true }),
    ...extra,
  };
}

describe("refresh time budget", () => {
  it("stops before the next channels.list and the next run continues from the oldest rows", async () => {
    expect(YOUTUBE_LIBRARY_REFRESH_TIME_BUDGET_MS).toBe(240_000);
    expect(YOUTUBE_LIBRARY_REFRESH_PASS_BUDGET_MS).toBe(200_000);
    const store = createMemoryYoutubeStore();
    const stamp = "2026-01-01T00:00:00.000Z";
    for (let index = 0; index < 60; index += 1) {
      const id = `c${String(index).padStart(2, "0")}`;
      await store.saveChannel(record(id, stamp, index === 59 ? "show-stale" : null));
    }
    let nowMs = 0;
    let saves = 0;
    let armClock = true;
    const realSave = store.saveChannel.bind(store);
    store.saveChannel = async (row, existing) => {
      const result = await realSave(row, existing);
      saves += 1;
      if (armClock && saves >= 50) nowMs = 1_000;
      return result;
    };
    const list = vi.fn(async (ids: string[]) => ({
      found: ids.map((id) => details(id)),
      missing: [] as string[],
    }));
    const lines: string[] = [];
    const first = await runRefreshQueue({
      store,
      api: api(list),
      now: new Date("2026-10-26T00:00:00.000Z"),
      clock: () => nowMs,
      deadlineMs: 1_000,
      log: (line) => lines.push(line),
    });
    expect(first.stopped).toBe("time");
    expect(first.refreshed).toBe(50);
    expect(list).toHaveBeenCalledTimes(1);
    expect(list.mock.calls[0][0]).toHaveLength(50);
    expect(store.channels.size).toBe(60);
    expect(store.channels.get("c50")?.stats_refreshed_at).toBe(stamp);
    expect(store.channels.get("c50")?.title).toBe("c50");
    expect(store.channels.get("c59")?.title).toBe("c59");
    expect(store.channels.get("c59")?.show_id).toBe("show-stale");
    expect(store.channels.get("c59")?.subscriber_count).toBe(1000);
    expect(store.channels.get("c00")?.stats_refreshed_at).toBe("2026-10-26T00:00:00.000Z");
    expect(lines.join("\n")).toContain("refresh sweep skipped: time");

    nowMs = 0;
    saves = 0;
    armClock = false;
    const second = await runRefreshQueue({
      store,
      api: api(list),
      now: new Date("2026-10-27T00:00:00.000Z"),
      clock: () => nowMs,
      deadlineMs: 1_000,
      log: () => {},
    });
    expect(store.channels.size).toBe(60);
    expect(list.mock.calls[1][0].slice(0, 10)).toEqual(
      Array.from({ length: 10 }, (_, index) => `c${String(50 + index).padStart(2, "0")}`)
    );
    expect(store.channels.get("c50")?.stats_refreshed_at).toBe("2026-10-27T00:00:00.000Z");
    expect(store.channels.get("c59")?.stats_refreshed_at).toBe("2026-10-27T00:00:00.000Z");
    expect(second.refreshed).toBeGreaterThanOrEqual(10);
    expect(second.stopped).toBeNull();
  });

  it("does not sweep when the unit budget stops the pass", async () => {
    const store = createMemoryYoutubeStore();
    await store.saveChannel(record("old-free", "2026-01-01T00:00:00.000Z"));
    await store.saveChannel(record("old-linked", "2026-01-02T00:00:00.000Z", "show-1"));
    const report = await runRefreshQueue({
      store,
      api: api(async () => ({ found: [], missing: [] })),
      budget: 0,
      now: new Date("2026-10-26T00:00:00.000Z"),
      log: () => {},
    });
    expect(report.stopped).toBe("budget");
    expect(report.deleted).toBe(0);
    expect(report.nulled).toBe(0);
    expect(store.channels.get("old-free")?.title).toBe("old-free");
    expect(store.channels.get("old-linked")?.title).toBe("old-linked");
    expect(store.channels.get("old-linked")?.subscriber_count).toBe(1000);
  });
});

describe("refresh stats chunks", () => {
  it("stores a mean of 0 or a mean above lifetime views as estimated, and a good mean as recent", async () => {
    const store = createMemoryYoutubeStore();
    await store.saveChannel(record("zero", "2026-08-01T00:00:00.000Z"));
    await store.saveChannel(record("high", "2026-08-02T00:00:00.000Z"));
    await store.saveChannel(record("ok", "2026-08-03T00:00:00.000Z"));
    const report = await runRefreshQueue({
      store,
      api: api(
        async (ids) => ({ found: ids.map((id) => details(id)), missing: [] }),
        {
          recentUploadsBatch: async (ids: string[]) => ({
            results: ids.map((id) => {
              if (id === "zero") return { kind: "uploads" as const, averageViews: 0 };
              if (id === "high") return { kind: "uploads" as const, averageViews: 5_000_000 };
              return { kind: "uploads" as const, averageViews: 12_000 };
            }),
            playlistCalls: ids.length,
            videoListCalls: 1,
          }),
        }
      ),
      now: new Date("2026-10-26T00:00:00.000Z"),
      log: () => {},
    });
    expect(report.units).toBe(1 + 3 + 1);
    expect(store.channels.get("zero")?.avg_views_method).toBe("estimated");
    expect(store.channels.get("zero")?.avg_recent_views).toBe(20_000);
    expect(store.channels.get("zero")?.avg_recent_views).not.toBe(0);
    expect(store.channels.get("high")?.avg_views_method).toBe("estimated");
    expect(store.channels.get("high")?.avg_recent_views).toBe(20_000);
    expect(store.channels.get("ok")?.avg_views_method).toBe("recent");
    expect(store.channels.get("ok")?.avg_recent_views).toBe(12_000);
    for (const row of store.channels.values()) {
      expect(row.avg_views_method === null || row.avg_views_method === "recent" || row.avg_views_method === "estimated").toBe(true);
    }
  });

  it("cuts a stalled stats batch and stores estimated", async () => {
    vi.useFakeTimers();
    try {
      const start = Date.now();
      const store = createMemoryYoutubeStore();
      await store.saveChannel(record("stall", "2026-01-01T00:00:00.000Z"));
      const recentUploadsBatch = vi.fn(
        (_ids: string[], _options?: { deadlineMs?: number; clock?: () => number }): Promise<never> =>
          new Promise(() => {})
      );
      const pending = runRefreshQueue({
        store,
        api: api(async (ids) => ({ found: ids.map((id) => details(id)), missing: [] }), { recentUploadsBatch }),
        now: new Date("2026-10-26T00:00:00.000Z"),
        clock: () => Date.now(),
        deadlineMs: start + YOUTUBE_LIBRARY_REFRESH_PASS_BUDGET_MS,
        log: () => {},
      });
      await vi.advanceTimersByTimeAsync(50_000);
      const report = await pending;
      expect(report.elapsedMs).toBeLessThanOrEqual(50_000);
      expect(report.elapsedMs).toBeLessThan(300_000);
      expect(store.channels.get("stall")?.avg_views_method).toBe("estimated");
      expect(store.channels.get("stall")?.avg_recent_views).not.toBe(0);
      expect(recentUploadsBatch.mock.calls[0]?.[1]?.deadlineMs).toBe(start + 40_000);
    } finally {
      vi.useRealTimers();
    }
  });

  it("cuts a stats batch that starts with 10 seconds left", async () => {
    vi.useFakeTimers();
    try {
      const start = Date.now();
      const near = start + 10_000;
      vi.setSystemTime(near);
      const store = createMemoryYoutubeStore();
      await store.saveChannel(record("late", "2026-01-01T00:00:00.000Z"));
      const recentUploadsBatch = vi.fn(
        (_ids: string[], _options?: { deadlineMs?: number; clock?: () => number }): Promise<never> =>
          new Promise(() => {})
      );
      const pending = runRefreshQueue({
        store,
        api: api(async (ids) => ({ found: ids.map((id) => details(id)), missing: [] }), { recentUploadsBatch }),
        now: new Date("2026-10-26T00:00:00.000Z"),
        clock: () => Date.now(),
        deadlineMs: near + 10_000,
        log: () => {},
      });
      await vi.advanceTimersByTimeAsync(20_000);
      const report = await pending;
      expect(report.elapsedMs).toBeLessThanOrEqual(20_000);
      expect(store.channels.get("late")?.avg_views_method).toBe("estimated");
      expect(recentUploadsBatch.mock.calls[0]?.[1]?.deadlineMs).toBe(near + 10_000);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps at most 4 show lookups and saves in flight, in input order", async () => {
    const store = createMemoryYoutubeStore();
    for (let index = 0; index < 8; index += 1) {
      await store.saveChannel(record(`c${index}`, `2026-08-0${index + 1}T00:00:00.000Z`));
    }
    let inFlight = 0;
    let max = 0;
    store.uniqueShowId = async (channelId: string) => {
      inFlight += 1;
      max = Math.max(max, inFlight);
      await new Promise((resolve) => setTimeout(resolve, channelId === "c0" ? 30 : 5));
      inFlight -= 1;
      return `show-${channelId}`;
    };
    let saveFlight = 0;
    let saveMax = 0;
    const realSave = store.saveChannel.bind(store);
    store.saveChannel = async (row, existing) => {
      saveFlight += 1;
      saveMax = Math.max(saveMax, saveFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      saveFlight -= 1;
      return realSave(row, existing);
    };
    await runRefreshQueue({
      store,
      api: api(async (ids) => ({ found: ids.map((id) => details(id)), missing: [] })),
      now: new Date("2026-10-26T00:00:00.000Z"),
      log: () => {},
    });
    expect(max).toBe(4);
    expect(max).toBeLessThanOrEqual(4);
    expect(saveMax).toBe(4);
    expect(saveMax).toBeLessThanOrEqual(4);
    for (let index = 0; index < 8; index += 1) {
      expect(store.channels.get(`c${index}`)?.show_id).toBe(`show-c${index}`);
    }
  });

  it("passes the existing row to saveChannel and does not read each channel again", async () => {
    const store = createMemoryYoutubeStore();
    await store.saveChannel(record("a", "2026-08-01T00:00:00.000Z"));
    await store.saveChannel(record("b", "2026-08-02T00:00:00.000Z"));
    let reads = 0;
    const realGet = store.getChannel.bind(store);
    store.getChannel = async (id) => {
      reads += 1;
      return realGet(id);
    };
    let bulkReads = 0;
    const realGets = store.getChannels.bind(store);
    store.getChannels = async (ids) => {
      bulkReads += 1;
      return realGets(ids);
    };
    const seenExisting: string[] = [];
    const realSave = store.saveChannel.bind(store);
    store.saveChannel = async (row, existing) => {
      seenExisting.push(existing?.channel_id ?? "");
      return realSave(row, existing);
    };
    await runRefreshQueue({
      store,
      api: api(async (ids) => ({ found: ids.map((id) => details(id)), missing: [] })),
      now: new Date("2026-10-26T00:00:00.000Z"),
      log: () => {},
    });
    expect(reads).toBe(0);
    expect(bulkReads).toBe(1);
    expect(seenExisting.sort()).toEqual(["a", "b"]);
  });

  it("counts real batch calls and stops at 1,000 units", async () => {
    expect(YOUTUBE_LIBRARY_REFRESH_BUDGET).toBe(1000);
    const store = createMemoryYoutubeStore();
    for (let index = 0; index < 20; index += 1) {
      await store.saveChannel(record(`n${String(index).padStart(2, "0")}`, `2026-01-${String(index + 1).padStart(2, "0")}T00:00:00.000Z`));
    }
    const batchSizes: number[] = [];
    const report = await runRefreshQueue({
      store,
      api: api(
        async (ids) => ({ found: ids.map((id) => details(id)), missing: [] }),
        {
          recentUploadsBatch: async (ids: string[]) => {
            batchSizes.push(ids.length);
            return {
              results: ids.map(() => ({ kind: "uploads" as const, averageViews: 1000 })),
              playlistCalls: 990,
              videoListCalls: 9,
            };
          },
        }
      ),
      budget: 1000,
      now: new Date("2026-10-26T00:00:00.000Z"),
      log: () => {},
    });
    expect(uploadsBatchWorstCaseUnits(10)).toBe(13);
    expect(batchSizes).toEqual([10]);
    expect(report.units).toBe(1000);
    expect(report.stopped).toBe("budget");
    expect(report.refreshed).toBe(10);
    expect(store.channels.get("n10")?.stats_refreshed_at).toBe("2026-01-11T00:00:00.000Z");
  });

  it("never sends more than 50 ids to channels.list or 10 channels to a stats batch", async () => {
    const store = createMemoryYoutubeStore();
    for (let index = 0; index < 60; index += 1) {
      await store.saveChannel(record(`p${String(index).padStart(2, "0")}`, "2026-08-01T00:00:00.000Z"));
    }
    const listSizes: number[] = [];
    const batchSizes: number[] = [];
    await runRefreshQueue({
      store,
      api: api(
        async (ids) => {
          listSizes.push(ids.length);
          return { found: ids.map((id) => details(id)), missing: [] };
        },
        {
          recentUploadsBatch: async (ids: string[]) => {
            batchSizes.push(ids.length);
            return {
              results: ids.map(() => ({ kind: "estimate" as const })),
              playlistCalls: ids.length,
              videoListCalls: 1,
            };
          },
        }
      ),
      now: new Date("2026-10-26T00:00:00.000Z"),
      log: () => {},
    });
    expect(listSizes).toEqual([50, 10]);
    expect(Math.max(...listSizes)).toBeLessThanOrEqual(50);
    expect(batchSizes.every((size) => size <= 10)).toBe(true);
    expect(batchSizes).toHaveLength(6);
  });

  it("stops on quotaExceeded without deleting the rows it did not refresh", async () => {
    const store = createMemoryYoutubeStore();
    await store.saveChannel(record("kept", "2026-01-01T00:00:00.000Z"));
    const lines: string[] = [];
    const report = await runRefreshQueue({
      store,
      api: api(async () => {
        throw new Error("YouTube API error 403: quotaExceeded key=TESTKEY");
      }),
      now: new Date("2026-10-26T00:00:00.000Z"),
      log: (line) => lines.push(line),
    });
    expect(report.stopped).toBe("quota");
    expect(store.channels.get("kept")?.title).toBe("kept");
    expect(lines.join("\n")).toContain("refresh sweep skipped: quota");
    expect(lines.join("\n")).not.toContain("TESTKEY");
    expect(JSON.stringify(report)).not.toContain("TESTKEY");
  });

  it("redacts a list error that contains key=TESTKEY", async () => {
    const store = createMemoryYoutubeStore();
    await store.saveChannel(record("kept", "2026-10-01T00:00:00.000Z"));
    const lines: string[] = [];
    const report = await runRefreshQueue({
      store,
      api: api(async () => {
        throw new Error("YouTube API error 500: key=TESTKEY");
      }),
      now: new Date("2026-10-26T00:00:00.000Z"),
      log: (line) => lines.push(line),
    });
    expect(report.stopped).toBe("error");
    expect(lines.join("\n")).not.toContain("TESTKEY");
    expect(lines.join("\n")).toContain("YouTube API error 500");
    expect(JSON.stringify(report)).not.toContain("TESTKEY");
    expect(store.channels.has("kept")).toBe(true);
  });

  it("deletes stale rows in batches of 50 and stops the sweep on the clock", async () => {
    const store = createMemoryYoutubeStore();
    for (let index = 0; index < 51; index += 1) {
      await store.saveChannel(record(`s${String(index).padStart(2, "0")}`, "2026-01-01T00:00:00.000Z"));
    }
    const sizes: number[] = [];
    const realDelete = store.deleteChannels.bind(store);
    let nowMs = 0;
    store.deleteChannels = async (ids) => {
      sizes.push(ids.length);
      await realDelete(ids);
      nowMs = 500_000;
    };
    const report = await runRefreshQueue({
      store,
      api: api(async () => ({ found: [], missing: [] })),
      now: new Date("2026-10-26T00:00:00.000Z"),
      clock: () => nowMs,
      deadlineMs: 200_000,
      timeDeadlineMs: 240_000,
      log: () => {},
    });
    expect(sizes).toEqual([50]);
    expect(report.stopped).toBe("time");
    expect(report.deleted).toBe(50);
    expect(store.channels.size).toBe(1);
  });
});
