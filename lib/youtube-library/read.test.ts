import { describe, expect, it, vi } from "vitest";
import {
  MIN_YOUTUBE_AVG_VIEWS,
  MIN_YOUTUBE_AVG_VIEWS_FALLBACK,
  MIN_YOUTUBE_VIDEO_COUNT,
} from "@/lib/discovery/discover-shows";
import { createMemoryYoutubeStore, type YoutubeChannelRecord } from "./store";
import {
  LIBRARY_FLOOR,
  YOUTUBE_LIBRARY_LIVE_BELOW,
  YOUTUBE_LIBRARY_TOP,
  channelPassesLibraryFloors,
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
    expect(
      channelPassesLibraryFloors(
        record({ channel_id: "uploads-under", avg_recent_views: 9999, avg_views_method: "uploads" })
      )
    ).toBe(false);
    expect(
      channelPassesLibraryFloors(
        record({ channel_id: "uploads-ok", avg_recent_views: 10000, avg_views_method: "uploads" })
      )
    ).toBe(true);
    expect(
      channelPassesLibraryFloors(
        record({ channel_id: "estimate-ok", avg_recent_views: 5000, avg_views_method: "estimate" })
      )
    ).toBe(true);
    expect(
      channelPassesLibraryFloors(
        record({ channel_id: "estimate-under", avg_recent_views: 4999, avg_views_method: "estimate" })
      )
    ).toBe(false);
  });
});

describe("library-first discovery read", () => {
  const now = new Date("2026-10-26T00:00:00.000Z");
  const brief = { ringTerms: ["endurance athletes"], interests: ["Health & Wellness"] };

  it("returns the top 60 matches and does not call live when at least 10 match", async () => {
    expect(YOUTUBE_LIBRARY_LIVE_BELOW).toBe(10);
    expect(YOUTUBE_LIBRARY_TOP).toBe(60);
    const store = createMemoryYoutubeStore();
    for (let i = 0; i < 70; i++) {
      await store.saveChannel(
        record({
          channel_id: `c${String(i).padStart(2, "0")}`,
          subscriber_count: i,
          niche_tags: i % 2 === 0 ? ["Health & Wellness"] : ["Music"],
          topic_categories: i % 2 === 0 ? ["endurance athletes"] : ["Music"],
          keywords: [],
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
    await store.saveChannel(record({ channel_id: "lib-3", subscriber_count: 5, niche_tags: ["Music"], topic_categories: ["jazz"], keywords: [] }));
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

  it("scores overlap and ignores a channel with none", () => {
    const rows = [
      record({ channel_id: "fit", niche_tags: ["Health & Wellness"], topic_categories: ["endurance"], keywords: [] }),
      record({ channel_id: "none", niche_tags: ["Music"], topic_categories: ["jazz"], keywords: ["piano"] }),
    ];
    const ranked = rankLibraryMatches(rows, brief);
    expect(ranked.map((match) => match.row.channel_id)).toEqual(["fit"]);
  });

  it("reads nothing when the library is not configured", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    const shows = await readYoutubeLibraryForDiscovery({ ringTerms: ["health"], interests: [] });
    expect(shows).toEqual([]);
    vi.unstubAllEnvs();
  });
});
