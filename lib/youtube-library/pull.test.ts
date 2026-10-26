import { afterEach, describe, expect, it, vi } from "vitest";
import type { YouTubeChannelDetails } from "@/lib/enrichment/youtube";
import { createMemoryYoutubeStore } from "./store";
import { categoryQueueValues } from "./categories";
import {
  createLibraryYoutubeApi,
  runPullQueue,
  scrubYoutubeError,
  seedQueueItems,
  YOUTUBE_LIBRARY_PULL_BUDGET,
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

describe("seed resolution", () => {
  it("resolves a handle without putting the API key in the error", async () => {
    vi.stubEnv("YOUTUBE_API_KEY", "super-secret-key");
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      expect(url.searchParams.get("key")).toBe("super-secret-key");
      if (url.searchParams.get("forHandle") === "HubermanLab") {
        return new Response(JSON.stringify({ items: [{ id: "UCbbbbbbbbbbbbbbbbbbbbbb" }] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(
        JSON.stringify({
          error: { message: "key=super-secret-key", errors: [{ reason: "quotaExceeded" }] },
        }),
        { status: 403, headers: { "content-type": "application/json" } }
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = {
      searchVideos: vi.fn(async () => {
        throw new Error('YouTube API error 403: {"message":"key=super-secret-key"} quotaExceeded');
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
    await expect(api.search("fitness")).rejects.not.toThrow(/super-secret-key/);
    expect(scrubYoutubeError(new Error("YouTube API error 403: key=super-secret-key")).message).not.toContain(
      "super-secret-key"
    );

    const store = createMemoryYoutubeStore();
    await store.enqueue([{ kind: "seed_channel", value: "https://www.youtube.com/@HubermanLab" }]);
    const report = await runPullQueue({ store, api, budget: 10, seed: false, log: () => {} });
    expect(report.upserted).toBe(1);
    expect(store.channels.get("UCbbbbbbbbbbbbbbbbbbbbbb")?.source).toBe("seed");
    expect(JSON.stringify(report)).not.toContain("super-secret-key");
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
