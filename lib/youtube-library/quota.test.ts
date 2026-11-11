import { describe, expect, it } from "vitest";
import { YOUTUBE_LIBRARY_REFRESH_BUDGET } from "./refresh";
import {
  YOUTUBE_DAILY_QUOTA_CAP_DEFAULT,
  YOUTUBE_REFRESH_QUOTA_RESERVE,
  createMemoryQuotaLedger,
  openLibraryQuota,
  pacificDay,
  quotaLogLine,
  readDailyQuotaCap,
} from "./quota";
import { createMemoryYoutubeStore } from "./store";

describe("Pacific YouTube quota day", () => {
  it("rolls the day at midnight Pacific, including daylight time", () => {
    expect(pacificDay(new Date("2026-11-02T07:59:00.000Z"))).toBe("2026-11-01");
    expect(pacificDay(new Date("2026-11-02T08:00:00.000Z"))).toBe("2026-11-02");
    expect(pacificDay(new Date("2026-07-02T06:59:00.000Z"))).toBe("2026-07-01");
    expect(pacificDay(new Date("2026-07-02T07:00:00.000Z"))).toBe("2026-07-02");
  });

  it("defaults the cap to 80 percent of 10,000 units", () => {
    expect(YOUTUBE_DAILY_QUOTA_CAP_DEFAULT).toBe(8000);
    expect(readDailyQuotaCap(null)).toBe(8000);
    expect(readDailyQuotaCap("5000")).toBe(5000);
    expect(readDailyQuotaCap("0")).toBe(0);
    expect(readDailyQuotaCap("nope")).toBe(8000);
    expect(readDailyQuotaCap("8000.5")).toBe(8000);
    const previous = process.env.YOUTUBE_DAILY_QUOTA_CAP;
    delete process.env.YOUTUBE_DAILY_QUOTA_CAP;
    expect(readDailyQuotaCap()).toBe(8000);
    process.env.YOUTUBE_DAILY_QUOTA_CAP = "6400";
    expect(readDailyQuotaCap()).toBe(6400);
    if (previous === undefined) delete process.env.YOUTUBE_DAILY_QUOTA_CAP;
    else process.env.YOUTUBE_DAILY_QUOTA_CAP = previous;
    expect(YOUTUBE_REFRESH_QUOTA_RESERVE).toBe(YOUTUBE_LIBRARY_REFRESH_BUDGET);
  });

  it("stops at the cap and starts again the next day", async () => {
    const ledger = createMemoryQuotaLedger();
    expect(await ledger.commit("2026-11-02", 100, "pull", 150)).toEqual({ accepted: 100, total: 100 });
    expect(await ledger.commit("2026-11-02", 100, "pull", 150)).toEqual({ accepted: 50, total: 150 });
    expect(await ledger.commit("2026-11-02", 10, "refresh", 150)).toEqual({ accepted: 0, total: 150 });
    expect(await ledger.used("2026-11-02")).toBe(150);
    expect(await ledger.used("2026-11-03")).toBe(0);
    expect(await ledger.commit("2026-11-03", 40, "email_backfill", 150)).toEqual({
      accepted: 40,
      total: 40,
    });
    expect(ledger.log.map((row) => row.units)).toEqual([100, 50, 40]);
    const line = quotaLogLine(
      {
        ledger,
        day: "2026-11-02",
        cap: 150,
        spendCap: 150,
        job: "pull",
        emailReserve: 0,
        refreshReserve: 0,
      },
      150
    );
    expect(line).toBe("[youtube-library] quota day=2026-11-02 job=pull total=150 cap=150");
    expect(line).not.toMatch(/key=|@|eyJ/i);
  });

  it("holds back refresh and email units while video scans are pending", async () => {
    const store = createMemoryYoutubeStore();
    await store.saveChannel({
      channel_id: "UCaaaaaaaaaaaaaaaaaaaaaa",
      title: "Fit",
      description: "ads@show.com",
      thumbnail_url: null,
      country: "US",
      default_language: "en",
      subscriber_count: 10,
      video_count: 10,
      total_view_count: 1000,
      avg_recent_views: 100,
      avg_views_method: "recent",
      topic_categories: [],
      keywords: [],
      niche_tags: [],
      niche_tags_version: 1,
      tagged_at: "2026-11-02T00:00:00.000Z",
      passed_market_filter: true,
      brand_flag: null,
      show_id: null,
      source: "category",
      source_query: "fitness",
      first_seen_at: "2026-11-02T00:00:00.000Z",
      stats_refreshed_at: "2026-11-02T00:00:00.000Z",
      created_at: "2026-11-02T00:00:00.000Z",
      updated_at: "2026-11-02T00:00:00.000Z",
    });
    const pull = await openLibraryQuota(store, new Date("2026-11-02T18:00:00.000Z"), "pull");
    expect(pull?.cap).toBe(8000);
    expect(pull?.emailReserve).toBe(2000);
    expect(pull?.refreshReserve).toBe(1000);
    expect(pull?.spendCap).toBe(5000);
    await store.markVideoEmailsChecked("UCaaaaaaaaaaaaaaaaaaaaaa", "2026-11-02T00:00:00.000Z");
    const done = await openLibraryQuota(store, new Date("2026-11-02T18:00:00.000Z"), "pull");
    expect(done?.emailReserve).toBe(0);
    expect(done?.spendCap).toBe(7000);
  });

  it("keeps today's spend caps when there is no aircheck reserve", async () => {
    const store = createMemoryYoutubeStore();
    await savePendingChannel(store);
    expect(store.aircheckReserve).toBeUndefined();
    const pull = await openLibraryQuota(store, new Date("2026-11-02T18:00:00.000Z"), "pull");
    expect(pull?.cap).toBe(8000);
    expect(pull?.spendCap).toBe(5000);
    store.aircheckReserve = async () => 0;
    const zero = await openLibraryQuota(store, new Date("2026-11-02T18:00:00.000Z"), "pull");
    expect(zero?.cap).toBe(8000);
    expect(zero?.spendCap).toBe(5000);
  });

  it("lowers the library cap when caption checks have reserved units", async () => {
    const store = createMemoryYoutubeStore();
    await savePendingChannel(store);
    store.aircheckReserve = async () => 3000;
    const pull = await openLibraryQuota(store, new Date("2026-11-02T18:00:00.000Z"), "pull");
    expect(pull?.cap).toBe(6800);
    expect(pull?.spendCap).toBe(3800);
  });

  it("uses 1,800 when the reserve read fails and keeps today's caps", async () => {
    const store = createMemoryYoutubeStore();
    await savePendingChannel(store);
    store.aircheckReserve = async () => {
      throw new Error("read failed");
    };
    const pull = await openLibraryQuota(store, new Date("2026-11-02T18:00:00.000Z"), "pull");
    expect(pull?.cap).toBe(8000);
    expect(pull?.emailReserve).toBe(2000);
    expect(pull?.refreshReserve).toBe(1000);
    expect(pull?.spendCap).toBe(5000);
  });

  it("respects an env cap above 8,000 after the reserve", async () => {
    const store = createMemoryYoutubeStore();
    await savePendingChannel(store);
    store.aircheckReserve = async () => 1000;
    const previous = process.env.YOUTUBE_DAILY_QUOTA_CAP;
    process.env.YOUTUBE_DAILY_QUOTA_CAP = "9800";
    try {
      const pull = await openLibraryQuota(store, new Date("2026-11-02T18:00:00.000Z"), "pull");
      expect(pull?.cap).toBe(8800);
    } finally {
      if (previous === undefined) delete process.env.YOUTUBE_DAILY_QUOTA_CAP;
      else process.env.YOUTUBE_DAILY_QUOTA_CAP = previous;
    }
  });
});

async function savePendingChannel(store: ReturnType<typeof createMemoryYoutubeStore>) {
  await store.saveChannel({
    channel_id: "UCaaaaaaaaaaaaaaaaaaaaaa",
    title: "Fit",
    description: "ads@show.com",
    thumbnail_url: null,
    country: "US",
    default_language: "en",
    subscriber_count: 10,
    video_count: 10,
    total_view_count: 1000,
    avg_recent_views: 100,
    avg_views_method: "recent",
    topic_categories: [],
    keywords: [],
    niche_tags: [],
    niche_tags_version: 1,
    tagged_at: "2026-11-02T00:00:00.000Z",
    passed_market_filter: true,
    brand_flag: null,
    show_id: null,
    source: "category",
    source_query: "fitness",
    first_seen_at: "2026-11-02T00:00:00.000Z",
    stats_refreshed_at: "2026-11-02T00:00:00.000Z",
    created_at: "2026-11-02T00:00:00.000Z",
    updated_at: "2026-11-02T00:00:00.000Z",
  });
}
