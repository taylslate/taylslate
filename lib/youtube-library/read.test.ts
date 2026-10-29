import { describe, expect, it, vi } from "vitest";
import {
  MIN_YOUTUBE_AVG_VIEWS,
  MIN_YOUTUBE_AVG_VIEWS_FALLBACK,
  MIN_YOUTUBE_VIDEO_COUNT,
} from "@/lib/discovery/discover-shows";
import { createMemoryYoutubeStore, type YoutubeChannelRecord } from "./store";
import {
  LIBRARY_FLOOR,
  YOUTUBE_LIBRARY_CAP,
  YOUTUBE_LIBRARY_LIVE_BELOW,
  channelPassesLibraryFloors,
  libraryMatchScore,
  mergeLibraryFirst,
  rankLibraryMatches,
  readYoutubeLibraryForDiscovery,
  takeLibraryThenLive,
} from "./read";

function record(overrides: Partial<YoutubeChannelRecord> & { channel_id: string }): YoutubeChannelRecord {
  return {
    title: overrides.channel_id,
    description: "Training and health",
    thumbnail_url: null,
    country: "US",
    default_language: "en",
    subscriber_count: 1000,
    video_count: 40,
    total_view_count: 2_000_000,
    avg_recent_views: 50000,
    avg_views_method: "estimated",
    topic_categories: ["Fitness"],
    keywords: ["workout"],
    niche_tags: ["Health & Wellness"],
    niche_tags_version: 1,
    tagged_at: "2026-10-01T00:00:00.000Z",
    passed_market_filter: true,
    brand_flag: null,
    show_id: null,
    source: "category",
    source_query: "fitness",
    first_seen_at: "2026-01-01T00:00:00.000Z",
    stats_refreshed_at: "2026-10-20T00:00:00.000Z",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-10-20T00:00:00.000Z",
    ...overrides,
  };
}

describe("library floors", () => {
  it("uses the same video and view floors as discovery", () => {
    expect(LIBRARY_FLOOR.videoCount).toBe(MIN_YOUTUBE_VIDEO_COUNT);
    expect(LIBRARY_FLOOR.recentViews).toBe(MIN_YOUTUBE_AVG_VIEWS);
    expect(LIBRARY_FLOOR.fallbackViews).toBe(MIN_YOUTUBE_AVG_VIEWS_FALLBACK);
    expect(channelPassesLibraryFloors(record({ channel_id: "low", video_count: 9 }))).toBe(false);
    expect(
      channelPassesLibraryFloors(
        record({ channel_id: "edge", video_count: 10, avg_recent_views: 5000, avg_views_method: "estimated" })
      )
    ).toBe(true);
    expect(
      channelPassesLibraryFloors(
        record({ channel_id: "under", video_count: 10, avg_recent_views: 4999, avg_views_method: "estimated" })
      )
    ).toBe(false);
    expect(
      channelPassesLibraryFloors(
        record({ channel_id: "recent-under", avg_recent_views: 9999, avg_views_method: "recent" })
      )
    ).toBe(false);
    expect(
      channelPassesLibraryFloors(
        record({ channel_id: "recent-ok", avg_recent_views: 10000, avg_views_method: "recent" })
      )
    ).toBe(true);
  });
});

describe("library-first discovery read", () => {
  const now = new Date("2026-10-26T00:00:00.000Z");
  const brief = { ringTerms: ["endurance athletes"], interests: ["Health & Wellness"] };

  it("returns every category match and does not call live when at least 10 match", async () => {
    expect(YOUTUBE_LIBRARY_LIVE_BELOW).toBe(10);
    expect(YOUTUBE_LIBRARY_CAP).toBe(500);
    const store = createMemoryYoutubeStore();
    for (let i = 0; i < 70; i++) {
      await store.saveChannel(
        record({
          channel_id: `c${String(i).padStart(2, "0")}`,
          subscriber_count: i,
          niche_tags: i % 2 === 0 ? ["Health & Wellness"] : ["Music"],
          topic_categories: i % 2 === 0 ? ["endurance athletes"] : ["Music"],
          keywords: [],
          source_query: i % 2 === 0 ? "health tips" : "jazz piano",
        })
      );
    }
    await store.saveChannel(
      record({
        channel_id: "stale",
        stats_refreshed_at: "2026-08-01T00:00:00.000Z",
        topic_categories: ["endurance athletes"],
      })
    );
    await store.saveChannel(
      record({
        channel_id: "brand",
        brand_flag: "official website",
        topic_categories: ["endurance athletes"],
      })
    );
    await store.saveChannel(
      record({
        channel_id: "off-market",
        passed_market_filter: false,
        topic_categories: ["endurance athletes"],
      })
    );

    const live = vi.fn(async () => []);
    const shows = await takeLibraryThenLive({ ...brief, store, now, live });
    expect(live).not.toHaveBeenCalled();
    expect(shows).toHaveLength(35);
    expect(shows.map((show) => show.youtube_channel_id)).not.toContain("stale");
    expect(shows.map((show) => show.youtube_channel_id)).not.toContain("brand");
    expect(shows.map((show) => show.youtube_channel_id)).not.toContain("off-market");
    expect(shows[0].platform).toBe("youtube");
    expect(shows[0].youtube_channel_id).toBe("c68");
  });

  it("runs the live search when fewer than 10 match and keeps library shows first", async () => {
    const store = createMemoryYoutubeStore();
    await store.saveChannel(record({ channel_id: "lib-1", subscriber_count: 10 }));
    await store.saveChannel(record({ channel_id: "lib-2", subscriber_count: 20 }));
    await store.saveChannel(
      record({
        channel_id: "lib-3",
        subscriber_count: 5,
        niche_tags: ["Music"],
        topic_categories: ["jazz"],
        keywords: [],
        source_query: "jazz piano",
      })
    );
    const liveShow = {
      ...record({ channel_id: "live-1" }),
    };
    const { libraryRowToShow } = await import("./read");
    const live = vi.fn(async () => [
      libraryRowToShow(record({ channel_id: "lib-1" })),
      libraryRowToShow(record({ channel_id: "live-9", title: "Live Nine" })),
    ]);
    const shows = await takeLibraryThenLive({ ...brief, store, now, live });
    expect(live).toHaveBeenCalledOnce();
    expect(shows.map((show) => show.youtube_channel_id)).toEqual(["lib-2", "lib-1", "live-9"]);
    expect(liveShow.channel_id).toBe("live-1");
  });

  it("merges an empty library as the live list unchanged", () => {
    const live = [{ youtube_channel_id: "only" }] as never;
    expect(mergeLibraryFirst([], live)).toBe(live);
  });

  it("keeps a category match that has no keyword overlap and drops a channel with none", () => {
    const rows = [
      record({
        channel_id: "fit",
        niche_tags: [],
        topic_categories: ["lifting"],
        keywords: [],
        source_query: "gym workout",
      }),
      record({
        channel_id: "none",
        niche_tags: ["Music"],
        topic_categories: ["jazz"],
        keywords: ["piano"],
        source_query: "jazz piano",
      }),
    ];
    const ranked = rankLibraryMatches(rows, brief);
    expect(libraryMatchScore(rows[0], { ringTerms: brief.ringTerms, interests: brief.interests })).toBe(0);
    expect(ranked.map((match) => match.row.channel_id)).toEqual(["fit"]);
    expect(ranked[0].matchLevel).toBe("adjacent");
  });

  it("reads nothing when the library is not configured", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    const shows = await readYoutubeLibraryForDiscovery({ ringTerms: ["health"], interests: [] });
    expect(shows).toEqual([]);
    vi.unstubAllEnvs();
  });
});

describe("library rings combined", () => {
  const now = new Date("2026-10-26T00:00:00.000Z");

  it("returns health, wellness, fitness, and lifestyle channels for protein gummies", () => {
    const rows = [
      record({
        channel_id: "health",
        niche_tags: ["Health & Wellness"],
        source_query: "health tips",
        avg_recent_views: 20000,
      }),
      record({
        channel_id: "wellness",
        niche_tags: [],
        source_query: "wellness",
        avg_recent_views: 19000,
      }),
      record({
        channel_id: "fitness",
        niche_tags: [],
        source_query: "gym workout",
        avg_recent_views: 80000,
      }),
      record({
        channel_id: "lifestyle",
        niche_tags: ["Fashion & Beauty"],
        source_query: "makeup tutorial",
        avg_recent_views: 70000,
      }),
      record({
        channel_id: "music",
        niche_tags: ["Music"],
        source_query: "jazz piano",
        topic_categories: ["Music"],
        keywords: ["piano"],
      }),
    ];
    const ranked = rankLibraryMatches(rows, { ringTerms: ["protein gummies"], interests: [] });
    expect(ranked.map((match) => match.row.channel_id)).toEqual([
      "health",
      "wellness",
      "fitness",
      "lifestyle",
    ]);
    expect(ranked.filter((match) => match.matchLevel === "primary").map((match) => match.row.channel_id)).toEqual([
      "health",
      "wellness",
    ]);
    expect(ranked.filter((match) => match.matchLevel === "adjacent").map((match) => match.row.channel_id)).toEqual([
      "fitness",
      "lifestyle",
    ]);
  });

  it("combines rings, dedupes a channel, and sorts primary ahead of a higher-view adjacent", () => {
    const shared = record({
      channel_id: "shared",
      niche_tags: ["Health & Wellness"],
      source_query: "health tips",
      subscriber_count: 10,
      avg_recent_views: 11000,
    });
    const rows = [
      shared,
      record({ ...shared, channel_id: "shared" }),
      record({
        channel_id: "money",
        niche_tags: [],
        source_query: "personal finance",
        subscriber_count: 1,
        avg_recent_views: 12000,
      }),
      record({
        channel_id: "startup",
        niche_tags: [],
        source_query: "entrepreneurship",
        subscriber_count: 99,
        avg_recent_views: 90000,
      }),
    ];
    const ranked = rankLibraryMatches(rows, {
      rings: [
        { id: "protein gummies", terms: ["protein gummies"] },
        { id: "personal finance", terms: ["personal finance"] },
      ],
    });
    expect(ranked.map((match) => match.row.channel_id)).toEqual(["money", "shared", "startup"]);
    const hit = ranked.find((match) => match.row.channel_id === "shared");
    expect(hit?.rings.map((ring) => ring.id)).toEqual(["protein gummies"]);
    expect(hit?.matchLevel).toBe("primary");
    const money = ranked.find((match) => match.row.channel_id === "money");
    expect(money?.matchLevel).toBe("primary");
    expect(money?.rings.map((ring) => `${ring.id}:${ring.level}`)).toEqual(["personal finance:primary"]);
    expect(ranked.find((match) => match.row.channel_id === "startup")?.matchLevel).toBe("adjacent");
    expect(ranked.filter((match) => match.row.channel_id === "shared")).toHaveLength(1);
  });

  it("records both rings when one channel matches each", () => {
    const rows = [
      record({
        channel_id: "both",
        niche_tags: ["Health & Wellness", "Business & Finance"],
        source_query: "health tips",
      }),
    ];
    const ranked = rankLibraryMatches(rows, {
      rings: [
        { id: "protein gummies", terms: ["protein gummies"] },
        { id: "personal finance", terms: ["personal finance"] },
      ],
    });
    expect(ranked).toHaveLength(1);
    expect(ranked[0].rings.map((ring) => ring.id)).toEqual(["protein gummies", "personal finance"]);
    expect(ranked[0].matchLevel).toBe("primary");
  });

  it("stops at the safety cap", () => {
    const rows = Array.from({ length: YOUTUBE_LIBRARY_CAP + 10 }, (_, i) =>
      record({
        channel_id: `h${String(i).padStart(4, "0")}`,
        niche_tags: ["Health & Wellness"],
        source_query: "health tips",
        subscriber_count: i,
        avg_recent_views: 20000,
      })
    );
    const ranked = rankLibraryMatches(rows, { ringTerms: ["protein gummies"] });
    expect(ranked).toHaveLength(YOUTUBE_LIBRARY_CAP);
    expect(ranked[0].row.channel_id).toBe(`h${String(YOUTUBE_LIBRARY_CAP + 9).padStart(4, "0")}`);
    expect(ranked.at(-1)?.row.channel_id).toBe("h0010");
  });

  it("runs the live top-up only when the combined total is under 10", async () => {
    const store = createMemoryYoutubeStore();
    for (let i = 0; i < 10; i++) {
      await store.saveChannel(
        record({
          channel_id: `p${i}`,
          niche_tags: ["Health & Wellness"],
          source_query: "health tips",
          subscriber_count: i,
        })
      );
    }
    const live = vi.fn(async () => []);
    const ten = await takeLibraryThenLive({
      ringTerms: ["protein gummies"],
      store,
      now,
      live,
    });
    expect(live).not.toHaveBeenCalled();
    expect(ten).toHaveLength(10);

    await store.saveChannel(
      record({
        channel_id: "p0",
        passed_market_filter: false,
      })
    );
    const nine = await takeLibraryThenLive({
      ringTerms: ["protein gummies"],
      store,
      now,
      live,
    });
    expect(live).toHaveBeenCalledOnce();
    expect(nine).toHaveLength(9);
  });
});
