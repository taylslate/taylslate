import { describe, expect, it } from "vitest";
import { planQueueRefill, refillYoutubeQueue, rotateHighScoringSample } from "./refill";
import { createMemoryYoutubeStore, draftToRecord, type ChannelDraft } from "./store";
import type { YouTubeChannelDetails } from "@/lib/enrichment/youtube";

function channel(overrides: Partial<YouTubeChannelDetails> = {}): YouTubeChannelDetails {
  return {
    channelId: "UCaaaaaaaaaaaaaaaaaaaaaa",
    title: "Fit",
    description: "training",
    publishedAt: "2020-01-01T00:00:00.000Z",
    subscriberCount: 1000,
    videoCount: 20,
    totalViewCount: 200_000,
    topicCategories: ["Home workout"],
    keywords: ["strength training", "gym"],
    country: "US",
    defaultLanguage: "en",
    ...overrides,
  };
}

function draft(details: YouTubeChannelDetails, views: number): ChannelDraft {
  return {
    details,
    passedMarketFilter: true,
    brandFlag: null,
    source: "category",
    sourceQuery: "fitness coach",
    averageViews: views,
    viewsMethod: "recent",
    now: "2026-11-02T00:00:00.000Z",
  };
}

describe("queue refill", () => {
  it("rotates the high-scoring window instead of repeating the same top slice", () => {
    const pool = ["a", "b", "c", "d", "e"];
    expect(rotateHighScoringSample(pool, 0, 2)).toEqual(["a", "b"]);
    expect(rotateHighScoringSample(pool, 1, 2)).toEqual(["c", "d"]);
    expect(rotateHighScoringSample(pool, 2, 2)).toEqual(["e"]);
    expect(rotateHighScoringSample(pool, 3, 2)).toEqual(["a", "b"]);
    expect(rotateHighScoringSample(pool, 0, 40)).toEqual(pool);
  });

  it("pages finished queries and adds keywords from high-scoring channels", () => {
    const planned = planQueueRefill({
      queue: [
        {
          kind: "category_query",
          value: "home workout",
          status: "done",
          page_token: "",
          next_page_token: "page:NEXT",
        },
        {
          kind: "category_query",
          value: "strength training",
          status: "done",
          page_token: "",
          next_page_token: null,
        },
      ],
      channels: [
        {
          keywords: ["strength training", "meal prep"],
          niche_tags: ["Health & Wellness"],
          topic_categories: ["Home workout"],
          avg_recent_views: 20_000,
          passed_market_filter: true,
          brand_flag: null,
        },
        {
          keywords: ["brand catalog"],
          niche_tags: [],
          topic_categories: [],
          avg_recent_views: 90_000,
          passed_market_filter: true,
          brand_flag: "official website",
        },
      ],
    });
    const keys = planned.items.map((item) => `${item.value}|${item.page_token}`);
    expect(keys).toContain("home workout|page:NEXT");
    expect(keys).toContain("home workout|order:date");
    expect(keys).toContain("home workout|order:viewCount");
    expect(keys).toContain("strength training|order:date");
    expect(keys).toContain("meal prep|");
    expect(keys).toContain("health and wellness|");
    expect(keys.some((key) => key.startsWith("brand catalog"))).toBe(false);
    expect(keys.filter((key) => key === "strength training|")).toEqual([]);
    expect(planned.pages).toBeGreaterThan(0);
    expect(planned.keywords).toBeGreaterThan(0);
  });

  it("does not add rows while work is still pending, and dedupes", async () => {
    const store = createMemoryYoutubeStore();
    await store.enqueue([{ kind: "category_query", value: "home workout" }]);
    const blocked = await refillYoutubeQueue(store);
    expect(blocked.added).toBe(0);
    expect(store.queue).toHaveLength(1);

    store.queue[0].status = "done";
    store.queue[0].next_page_token = "page:NEXT";
    await store.saveChannel(
      draftToRecord(
        null,
        draft(channel({ keywords: ["meal prep"], topicCategories: [], channelId: "UCbbbbbbbbbbbbbbbbbbbbbb" }), 12_000),
        null
      )
    );
    const first = await refillYoutubeQueue(store);
    expect(first.added).toBeGreaterThan(0);
    const count = store.queue.length;
    const again = await refillYoutubeQueue(store);
    expect(again.added).toBe(0);
    expect(store.queue).toHaveLength(count);
    const duplicate = await store.enqueue([
      { kind: "category_query", value: "home workout", page_token: "page:NEXT" },
    ]);
    expect(duplicate).toBe(0);
    expect(store.queue).toHaveLength(count);
    const pages = store.queue.filter((row) => row.value === "home workout").map((row) => row.page_token);
    expect(pages).toContain("");
    expect(pages).toContain("page:NEXT");
    expect(new Set(pages).size).toBe(pages.length);
  });
});
