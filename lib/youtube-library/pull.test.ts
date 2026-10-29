import { afterEach, describe, expect, it, vi } from "vitest";
import type { YouTubeChannelDetails } from "@/lib/enrichment/youtube";
import { createMemoryYoutubeStore, draftToRecord } from "./store";
import { categoryQueueValues } from "./categories";
import {
  createLibraryYoutubeApi,
  mapLimit,
  runPullQueue,
  scrubYoutubeError,
  seedQueueItems,
  uploadsBatchWorstCaseUnits,
  YOUTUBE_LIBRARY_PULL_BUDGET,
  YOUTUBE_LIBRARY_PULL_TIME_BUDGET_MS,
} from "./pull";

function details(channelId: string, overrides: Partial<YouTubeChannelDetails> = {}): YouTubeChannelDetails {
  return {
    channelId,
    title: channelId,
    description: "The channel for your training and your health",
    publishedAt: "2020-01-01T00:00:00Z",
    subscriberCount: 100000,
    videoCount: 40,
    totalViewCount: 2_000_000,
    topicCategories: ["Fitness"],
    keywords: ["workout"],
    country: "US",
    defaultLanguage: "en",
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("pull budget", () => {
  it("stops at the budget and resumes the pending query the next run", async () => {
    expect(YOUTUBE_LIBRARY_PULL_BUDGET).toBe(8000);
    const store = createMemoryYoutubeStore();
    await store.enqueue([
      { kind: "category_query", value: "one" },
      { kind: "category_query", value: "two" },
      { kind: "category_query", value: "three" },
    ]);
    const search = vi.fn(async (query: string) => [`id-${query}`]);
    const list = vi.fn(async (ids: string[]) => ({
      found: ids.map((id) => details(id)),
      missing: [],
    }));
    const api = {
      search,
      list,
      seedLookupCost: () => 0,
      lookupSeed: vi.fn(),
    };

    const first = await runPullQueue({
      store,
      api,
      budget: 250,
      seed: false,
      now: new Date("2026-10-26T00:00:00.000Z"),
      log: () => {},
    });

    expect(first.units).toBe(202);
    expect(first.done).toBe(2);
    expect(first.upserted).toBe(2);
    expect(first.stopped).toBe("budget");
    expect(first.pending).toBe(1);
    expect(search.mock.calls.map((call) => call[0])).toEqual(["one", "two"]);
    expect(store.channels.get("id-one")?.passed_market_filter).toBe(true);
    expect(store.channels.get("id-one")?.niche_tags).toEqual(["Health & Wellness"]);
    expect(store.channels.get("id-one")?.source).toBe("category");
    expect(store.queue.find((row) => row.value === "three")?.status).toBe("pending");

    const second = await runPullQueue({
      store,
      api,
      budget: 250,
      seed: false,
      now: new Date("2026-10-27T00:00:00.000Z"),
      log: () => {},
    });
    expect(second.done).toBe(1);
    expect(second.stopped).toBeNull();
    expect(search.mock.calls.map((call) => call[0])).toEqual(["one", "two", "three"]);
    expect(store.channels.has("id-three")).toBe(true);
    expect(store.queue.every((row) => row.status === "done")).toBe(true);
  });

  it("stores a channel that fails the market filter or the brand check", async () => {
    const store = createMemoryYoutubeStore();
    await store.enqueue([{ kind: "category_query", value: "brands" }]);
    const api = {
      search: async () => ["brand-1", "in-1"],
      list: async (ids: string[]) => ({
        found: [
          details("brand-1", { description: "Visit our official website for the catalog." }),
          details("in-1", {
            country: "IN",
            defaultLanguage: "en",
            title: "Fit Tuber",
            description: "The best fitness channel for your home workouts",
          }),
        ].filter((row) => ids.includes(row.channelId)),
        missing: [],
      }),
      seedLookupCost: () => 0,
      lookupSeed: async () => ({ channelId: null, notFound: true }),
    };
    await runPullQueue({ store, api, budget: 8000, seed: false, log: () => {} });
    expect(store.channels.get("brand-1")?.brand_flag).toBe("official website");
    expect(store.channels.get("brand-1")?.passed_market_filter).toBe(true);
    expect(store.channels.get("in-1")?.passed_market_filter).toBe(false);
  });
});

function apiWith(overrides: {
  search?: (query: string) => Promise<string[]>;
  list?: (ids: string[]) => Promise<{ found: ReturnType<typeof details>[]; missing: string[] }>;
  recentUploadsBatch?: (channelIds: string[]) => Promise<{
    results: { kind: "uploads"; averageViews: number }[] | { kind: "estimate" }[] | { kind: "skip" }[];
    playlistCalls: number;
    videoListCalls: number;
  }>;
  lookupSeed?: (value: string) => Promise<{ channelId: string | null; notFound: boolean }>;
  seedLookupCost?: (value: string) => number;
}) {
  return {
    search: overrides.search ?? (async () => ["a"]),
    list:
      overrides.list ??
      (async (ids: string[]) => ({
        found: ids.map((id) => details(id)),
        missing: [] as string[],
      })),
    seedLookupCost: overrides.seedLookupCost ?? (() => 0),
    lookupSeed: overrides.lookupSeed ?? (async () => ({ channelId: null, notFound: true })),
    recentUploadsBatch: overrides.recentUploadsBatch,
  };
}

describe("uploads stats budget", () => {
  it("counts real playlist and videos.list calls and stops when the worst case does not fit", async () => {
    expect(YOUTUBE_LIBRARY_PULL_BUDGET).toBe(8000);
    expect(uploadsBatchWorstCaseUnits(2)).toBe(3);
    expect(uploadsBatchWorstCaseUnits(0)).toBe(0);
    const store = createMemoryYoutubeStore();
    await store.enqueue([{ kind: "category_query", value: "one" }]);
    const recentUploadsBatch = vi.fn(async (channelIds: string[]) => ({
      results: channelIds.map((id) => ({
        kind: "uploads" as const,
        averageViews: id === "a" ? 12000 : 8000,
      })),
      playlistCalls: channelIds.length,
      videoListCalls: 1,
    }));
    const stopped = await runPullQueue({
      store,
      api: apiWith({
        search: async () => ["a", "b"],
        recentUploadsBatch,
      }),
      budget: 103,
      seed: false,
      log: () => {},
    });
    expect(stopped.units).toBe(101);
    expect(stopped.units).toBeLessThanOrEqual(YOUTUBE_LIBRARY_PULL_BUDGET);
    expect(stopped.stopped).toBe("budget");
    expect(recentUploadsBatch).not.toHaveBeenCalled();
    expect(store.channels.size).toBe(0);
    expect(store.queue[0]?.status).toBe("pending");

    const storeAll = createMemoryYoutubeStore();
    await storeAll.enqueue([{ kind: "category_query", value: "one" }]);
    const measured = await runPullQueue({
      store: storeAll,
      api: apiWith({
        search: async () => ["a", "b"],
        recentUploadsBatch,
      }),
      budget: 8000,
      seed: false,
      log: () => {},
    });
    expect(measured.units).toBe(104);
    expect(measured.units).toBeLessThanOrEqual(8000);
    expect(measured.stopped).toBeNull();
    expect(recentUploadsBatch).toHaveBeenCalledTimes(1);
    expect(recentUploadsBatch.mock.calls[0][0]).toEqual(["a", "b"]);
    expect(storeAll.channels.get("a")?.avg_views_method).toBe("recent");
    expect(storeAll.channels.get("a")?.avg_recent_views).toBe(12000);
    expect(storeAll.channels.get("b")?.avg_views_method).toBe("recent");
    expect(measured.searched).toBe(1);
    expect(measured.chunks).toBe(1);
    expect(measured.elapsedMs).toBeGreaterThanOrEqual(0);
  });

  it("never reports more than 8000 units", async () => {
    const store = createMemoryYoutubeStore();
    await store.enqueue(
      Array.from({ length: 90 }, (_, index) => ({ kind: "category_query" as const, value: `q${index}` }))
    );
    const recentUploadsBatch = vi.fn(async (channelIds: string[]) => ({
      results: channelIds.map(() => ({ kind: "uploads" as const, averageViews: 1000 })),
      playlistCalls: channelIds.length,
      videoListCalls: 1,
    }));
    const lines: string[] = [];
    const report = await runPullQueue({
      store,
      api: apiWith({
        search: async () => ["same-a", "same-b"],
        recentUploadsBatch,
      }),
      budget: 8000,
      seed: false,
      log: (line) => lines.push(line),
    });
    expect(report.units).toBeLessThanOrEqual(8000);
    expect(report.stopped).toBe("budget");
    expect(report.pending).toBeGreaterThan(0);
    expect(lines.join("\n")).toMatch(/elapsedMs=\d+ searched=\d+ chunks=\d+/);
    expect(lines.join("\n")).not.toContain("TESTKEY");
  });

  it("keeps the channel on the estimate when stats time out and redacts key=TESTKEY", async () => {
    const store = createMemoryYoutubeStore();
    await store.enqueue([
      { kind: "category_query", value: "secret" },
      { kind: "category_query", value: "stats" },
    ]);
    const lines: string[] = [];
    const report = await runPullQueue({
      store,
      api: apiWith({
        search: async (query: string) => {
          if (query === "secret") throw new Error("lookup failed key=TESTKEY");
          return ["a"];
        },
        recentUploadsBatch: async () => {
          throw new Error("YouTube call timed out");
        },
      }),
      budget: 8000,
      seed: false,
      log: (line) => lines.push(line),
    });
    expect(report.stopped).toBeNull();
    expect(report.units).toBeLessThanOrEqual(8000);
    expect(store.queue.find((row) => row.value === "secret")?.status).toBe("pending");
    expect(store.queue.find((row) => row.value === "secret")?.last_error).toBe("lookup failed key=[redacted]");
    expect(store.channels.get("a")?.avg_views_method).toBe("estimated");
    expect(store.channels.get("a")?.avg_recent_views).toBe(50000);
    const logged = lines.join("\n");
    expect(logged).toContain("key=[redacted]");
    expect(logged).not.toContain("TESTKEY");
    expect(logged).toMatch(/elapsedMs=\d+ searched=\d+ chunks=\d+/);
    expect(JSON.stringify(report)).not.toContain("TESTKEY");
    expect(store.queue.find((row) => row.value === "secret")?.last_error).not.toContain("TESTKEY");
  });
});

describe("time budget", () => {
  it("stops on the clock with the current row pending and earlier rows done", async () => {
    expect(YOUTUBE_LIBRARY_PULL_TIME_BUDGET_MS).toBe(240_000);
    const store = createMemoryYoutubeStore();
    await store.enqueue([
      { kind: "category_query", value: "done-first" },
      { kind: "category_query", value: "cut" },
    ]);
    const start = Date.parse("2026-10-29T12:00:00.000Z");
    let nowMs = start;
    const cutIds = Array.from({ length: 15 }, (_, index) => `c${index}`);
    const recentUploadsBatch = vi.fn(async (channelIds: string[]) => ({
      results: channelIds.map(() => ({ kind: "uploads" as const, averageViews: 11000 })),
      playlistCalls: channelIds.length,
      videoListCalls: 1,
    }));
    const originalSave = store.saveChannel.bind(store);
    let saves = 0;
    store.saveChannel = async (record, existing) => {
      const result = await originalSave(record, existing);
      saves += 1;
      if (saves >= 11) nowMs = start + 1000;
      return result;
    };
    const api = apiWith({
      search: async (query: string) => (query === "done-first" ? ["later"] : cutIds),
      recentUploadsBatch,
    });
    const first = await runPullQueue({
      store,
      api,
      budget: 8000,
      seed: false,
      now: new Date(start),
      deadlineMs: start + 1000,
      clock: () => nowMs,
      log: () => {},
    });

    expect(first.stopped).toBe("time");
    expect(first.done).toBe(1);
    expect(first.pending).toBe(1);
    expect(first.elapsedMs).toBeLessThanOrEqual(1000);
    expect(store.queue.find((row) => row.value === "done-first")?.status).toBe("done");
    expect(store.queue.find((row) => row.value === "cut")?.status).toBe("pending");
    expect(store.channels.size).toBe(11);
    expect(store.channels.has("c10")).toBe(false);
    expect(recentUploadsBatch.mock.calls.map((call) => call[0])).toEqual([
      ["later"],
      cutIds.slice(0, 10),
    ]);

    const callsAfterFirst = recentUploadsBatch.mock.calls.length;
    nowMs = start + 60_000;
    const second = await runPullQueue({
      store,
      api,
      budget: 8000,
      seed: false,
      now: new Date(start + 60_000),
      deadlineMs: nowMs + YOUTUBE_LIBRARY_PULL_TIME_BUDGET_MS,
      clock: () => nowMs,
      log: () => {},
    });
    expect(second.stopped).toBeNull();
    expect(second.done).toBe(1);
    expect(store.channels.size).toBe(16);
    expect(store.queue.every((row) => row.status === "done")).toBe(true);
    const resumedIds = recentUploadsBatch.mock.calls.slice(callsAfterFirst).flatMap((call) => call[0] as string[]);
    expect(resumedIds).toEqual(["c10", "c11", "c12", "c13", "c14"]);
    expect(store.channels.get("c0")?.stats_refreshed_at).toBe(new Date(start).toISOString());
    expect(store.channels.get("c0")?.first_seen_at).toBe(new Date(start).toISOString());
    expect(store.channels.get("c0")?.source).toBe("category");
    expect(second.units).toBe(107);
  });

  it("skips uploads stats units when the channel was refreshed in the last 24 hours", async () => {
    const store = createMemoryYoutubeStore();
    const start = Date.parse("2026-10-29T12:00:00.000Z");
    const fresh = draftToRecord(
      null,
      {
        details: details("fresh"),
        passedMarketFilter: true,
        brandFlag: null,
        source: "seed",
        sourceQuery: "https://www.youtube.com/channel/fresh",
        averageViews: 15000,
        viewsMethod: "recent",
        now: new Date(start - 23 * 60 * 60 * 1000).toISOString(),
      },
      null
    );
    const stale = draftToRecord(
      null,
      {
        details: details("stale"),
        passedMarketFilter: true,
        brandFlag: null,
        source: "seed",
        sourceQuery: "old",
        averageViews: 9000,
        viewsMethod: "recent",
        now: new Date(start - 25 * 60 * 60 * 1000).toISOString(),
      },
      null
    );
    const unmeasured = draftToRecord(
      null,
      {
        details: details("plain"),
        passedMarketFilter: true,
        brandFlag: null,
        source: "category",
        sourceQuery: "one",
        now: new Date(start - 60 * 60 * 1000).toISOString(),
      },
      null
    );
    unmeasured.avg_views_method = null;
    unmeasured.stats_refreshed_at = new Date(start - 60 * 60 * 1000).toISOString();
    await store.saveChannel(fresh);
    await store.saveChannel(stale);
    await store.saveChannel(unmeasured);
    await store.enqueue([{ kind: "category_query", value: "one" }]);
    const recentUploadsBatch = vi.fn(async (channelIds: string[]) => ({
      results: channelIds.map(() => ({ kind: "uploads" as const, averageViews: 42000 })),
      playlistCalls: channelIds.length,
      videoListCalls: 1,
    }));
    const report = await runPullQueue({
      store,
      api: apiWith({
        search: async () => ["fresh", "stale", "plain"],
        recentUploadsBatch,
      }),
      budget: 8000,
      seed: false,
      now: new Date(start),
      clock: () => start,
      log: () => {},
    });
    expect(recentUploadsBatch.mock.calls[0][0]).toEqual(["stale", "plain"]);
    expect(report.units).toBe(104);
    expect(store.channels.get("fresh")?.avg_recent_views).toBe(15000);
    expect(store.channels.get("fresh")?.avg_views_method).toBe("recent");
    expect(store.channels.get("fresh")?.stats_refreshed_at).toBe(fresh.stats_refreshed_at);
    expect(store.channels.get("fresh")?.source).toBe("seed");
    expect(store.channels.get("fresh")?.first_seen_at).toBe(fresh.first_seen_at);
    expect(store.channels.get("fresh")?.created_at).toBe(fresh.created_at);
    expect(store.channels.get("stale")?.avg_recent_views).toBe(42000);
    expect(store.channels.size).toBe(3);
  });

  it("returns done 0 when nothing is pending", async () => {
    const store = createMemoryYoutubeStore();
    const report = await runPullQueue({
      store,
      api: apiWith({}),
      seed: false,
      log: () => {},
    });
    expect(report.done).toBe(0);
    expect(report.stopped).toBeNull();
    expect(report.upserted).toBe(0);
    expect(report.searched).toBe(0);
    expect(report.chunks).toBe(0);
  });
});

describe("mapLimit", () => {
  it("never has more than 4 in flight and keeps input order", async () => {
    let inFlight = 0;
    let max = 0;
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const items = Array.from({ length: 12 }, (_, index) => index);
    const pending = mapLimit(items, 4, async (value) => {
      inFlight += 1;
      max = Math.max(max, inFlight);
      await gate;
      inFlight -= 1;
      return value * 2;
    });
    expect(inFlight).toBe(4);
    expect(max).toBeLessThanOrEqual(4);
    release();
    await expect(pending).resolves.toEqual(items.map((value) => value * 2));
    expect(max).toBe(4);
  });
});

describe("quota and list batches", () => {
  it("stops cleanly on quotaExceeded and keeps the row pending", async () => {
    const store = createMemoryYoutubeStore();
    await store.enqueue([
      { kind: "category_query", value: "one" },
      { kind: "category_query", value: "two" },
    ]);
    const report = await runPullQueue({
      store,
      api: apiWith({
        search: async (query: string) => {
          if (query === "two") throw new Error("YouTube API error 403: quotaExceeded");
          return ["a"];
        },
      }),
      seed: false,
      log: () => {},
    });
    expect(report.stopped).toBe("quota");
    expect(report.done).toBe(1);
    expect(report.units).toBeLessThanOrEqual(8000);
    expect(store.queue.find((row) => row.value === "one")?.status).toBe("done");
    expect(store.queue.find((row) => row.value === "two")?.status).toBe("pending");
    expect(store.channels.has("a")).toBe(true);
  });

  it("calls list with at most 50 ids", async () => {
    const store = createMemoryYoutubeStore();
    await store.enqueue([{ kind: "category_query", value: "wide" }]);
    const ids = Array.from({ length: 51 }, (_, index) => `id-${index}`);
    const list = vi.fn(async (slice: string[]) => ({
      found: slice.map((id) => details(id)),
      missing: [] as string[],
    }));
    await runPullQueue({
      store,
      api: apiWith({
        search: async () => ids,
        list,
      }),
      seed: false,
      log: () => {},
    });
    expect(list.mock.calls.map((call) => call[0].length)).toEqual([50, 1]);
    expect(store.channels.size).toBe(51);
  });

  it("leaves a timed out search pending and continues the queue", async () => {
    const store = createMemoryYoutubeStore();
    await store.enqueue([
      { kind: "category_query", value: "one" },
      { kind: "category_query", value: "two" },
    ]);
    const report = await runPullQueue({
      store,
      api: apiWith({
        search: async (query: string) => {
          if (query === "one") throw new Error("YouTube call timed out");
          return ["b"];
        },
      }),
      seed: false,
      log: () => {},
    });
    expect(report.stopped).toBeNull();
    expect(store.queue.find((row) => row.value === "one")?.status).toBe("pending");
    expect(store.queue.find((row) => row.value === "one")?.attempts).toBe(1);
    expect(store.queue.find((row) => row.value === "one")?.last_error).toBe("YouTube call timed out");
    expect(store.queue.find((row) => row.value === "two")?.status).toBe("done");
  });
});

describe("seed resolution", () => {
  it("resolves a handle without putting the API key in the error", async () => {
    vi.stubEnv("YOUTUBE_API_KEY", "TESTKEY");
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      expect(url.searchParams.get("key")).toBe("TESTKEY");
      if (url.searchParams.get("forHandle") === "HubermanLab") {
        return new Response(JSON.stringify({ items: [{ id: "UCbbbbbbbbbbbbbbbbbbbbbb" }] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(
        JSON.stringify({
          error: { message: "key=TESTKEY", errors: [{ reason: "quotaExceeded" }] },
        }),
        { status: 403, headers: { "content-type": "application/json" } }
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = {
      searchVideos: vi.fn(async () => {
        throw new Error('YouTube API error 403: {"message":"key=TESTKEY"} quotaExceeded');
      }),
      getMultipleChannelDetails: vi.fn(async (ids: string[]) => ids.map((id) => details(id))),
    };
    const api = createLibraryYoutubeApi(client as never);

    expect(api.seedLookupCost("https://www.youtube.com/@HubermanLab")).toBe(1);
    expect(api.seedLookupCost("UCaaaaaaaaaaaaaaaaaaaaaa")).toBe(0);
    await expect(api.lookupSeed("https://www.youtube.com/@HubermanLab")).resolves.toEqual({
      channelId: "UCbbbbbbbbbbbbbbbbbbbbbb",
      notFound: false,
    });

    await expect(api.search("fitness")).rejects.toThrow(/YouTube API error 403: quotaExceeded/);
    await expect(api.search("fitness")).rejects.not.toThrow(/TESTKEY/);
    expect(scrubYoutubeError(new Error("YouTube API error 403: key=TESTKEY")).message).not.toContain("TESTKEY");

    const store = createMemoryYoutubeStore();
    await store.enqueue([{ kind: "seed_channel", value: "https://www.youtube.com/@HubermanLab" }]);
    const report = await runPullQueue({ store, api, budget: 10, seed: false, log: () => {} });
    expect(report.upserted).toBe(1);
    expect(store.channels.get("UCbbbbbbbbbbbbbbbbbbbbbb")?.source).toBe("seed");
    expect(JSON.stringify(report)).not.toContain("TESTKEY");
  });

  it("queues categories and the csv once", async () => {
    const csv = "channel_url,channel_id\nhttps://www.youtube.com/@HubermanLab,\n";
    const items = seedQueueItems(csv);
    const store = createMemoryYoutubeStore();
    expect(await store.enqueue(items)).toBe(categoryQueueValues().length + 1);
    expect(await store.enqueue(items)).toBe(0);
    expect(store.queue.filter((row) => row.kind === "seed_channel")).toHaveLength(1);
  });
});
