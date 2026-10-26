import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/enrichment/youtube", async () => {
  const actual = await vi.importActual<typeof import("@/lib/enrichment/youtube")>(
    "@/lib/enrichment/youtube"
  );
  return {
    ...actual,
    getYouTubeClientSafe: vi.fn(),
  };
});

vi.mock("@/lib/enrichment/podscan", async () => {
  const actual = await vi.importActual<typeof import("@/lib/enrichment/podscan")>(
    "@/lib/enrichment/podscan"
  );
  return {
    ...actual,
    getPodscanClientSafe: () => null,
  };
});

import { getYouTubeClientSafe, type YouTubeChannelDetails } from "@/lib/enrichment/youtube";
import {
  YOUTUBE_DISCOVERY_QUOTA,
  discoverFromYoutube,
  discoverShows,
  excludeDeadYouTube,
  isDeadYouTube,
  passesYouTubeMarketFilter,
  youtubeInterestRetry,
} from "./discover-shows";
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

describe("passesYouTubeMarketFilter", () => {
  const english = "The best fitness channel for your home workouts";
  const spanish = "Recetas para todos los dias con la familia";
  const hindi = "यह फिटनेस चैनल है";

  it("keeps a US channel", () => {
    expect(
      passesYouTubeMarketFilter({
        country: "US",
        defaultLanguage: "hi",
        title: "Fit",
        description: hindi,
      })
    ).toBe(true);
    expect(passesYouTubeMarketFilter({ country: "us", title: "Fit", description: english })).toBe(
      true
    );
  });

  it("drops a channel whose country is IN", () => {
    expect(
      passesYouTubeMarketFilter({
        country: "IN",
        defaultLanguage: "en",
        title: "Fit Tuber",
        description: english,
      })
    ).toBe(false);
  });

  it("keeps a channel with no country when the language is English", () => {
    expect(
      passesYouTubeMarketFilter({
        country: "",
        defaultLanguage: "en-US",
        title: "चैनल",
        description: hindi,
      })
    ).toBe(true);
    expect(
      passesYouTubeMarketFilter({
        country: undefined,
        title: "Huberman Lab",
        description: english,
      })
    ).toBe(true);
  });

  it("drops a channel with no country when the language is not English", () => {
    expect(
      passesYouTubeMarketFilter({
        defaultLanguage: "hi",
        title: "Fit",
        description: hindi,
      })
    ).toBe(false);
    expect(
      passesYouTubeMarketFilter({
        title: "Cocina",
        description: spanish,
      })
    ).toBe(false);
    expect(passesYouTubeMarketFilter({ title: "", description: "" })).toBe(false);
  });
});

describe("YouTube discovery quota", () => {
  it("documents 4 x 100 channel searches plus detail calls", () => {
    expect(YOUTUBE_DISCOVERY_QUOTA.channelSearch).toBe(400);
    expect(YOUTUBE_DISCOVERY_QUOTA.channelDetailsWorstCase).toBe(2);
    expect(YOUTUBE_DISCOVERY_QUOTA.recentVideoStats).toBe(303);
    expect(YOUTUBE_DISCOVERY_QUOTA.worstCase).toBe(
      YOUTUBE_DISCOVERY_QUOTA.channelSearch +
        YOUTUBE_DISCOVERY_QUOTA.channelDetailsWorstCase +
        YOUTUBE_DISCOVERY_QUOTA.recentVideoStats
    );
    expect(YOUTUBE_DISCOVERY_QUOTA.worstCase).toBe(705);
  });
});

function detail(
  overrides: Partial<YouTubeChannelDetails> & { channelId: string }
): YouTubeChannelDetails {
  return {
    title: overrides.channelId,
    description: "The channel for your training and your health",
    publishedAt: "2020-01-01T00:00:00Z",
    subscriberCount: 100000,
    videoCount: 40,
    totalViewCount: 2_000_000,
    topicCategories: ["Fitness"],
    keywords: [],
    country: "US",
    defaultLanguage: "en",
    ...overrides,
  };
}

describe("discoverShows YouTube rings", () => {
  beforeEach(() => {
    vi.mocked(getYouTubeClientSafe).mockReset();
  });

  it("dedupes ring searches, caps at 4, and drops channels the market filter rejects", async () => {
    const rows = new Map<string, YouTubeChannelDetails>([
      ["US1", detail({ channelId: "US1", subscriberCount: 400000, country: "US" })],
      ["SHARED", detail({ channelId: "SHARED", subscriberCount: 300000, country: "US" })],
      [
        "IN1",
        detail({
          channelId: "IN1",
          country: "IN",
          defaultLanguage: "en",
          title: "Fit Tuber",
          description: "The best fitness channel for your home workouts",
        }),
      ],
      [
        "EN1",
        detail({
          channelId: "EN1",
          subscriberCount: 200000,
          country: undefined,
          defaultLanguage: "en",
          title: "English Lab",
          description: "यह फिटनेस चैनल है",
        }),
      ],
      [
        "ES1",
        detail({
          channelId: "ES1",
          country: undefined,
          defaultLanguage: undefined,
          title: "Cocina",
          description: "Recetas para todos los dias con la familia",
        }),
      ],
      [
        "SHORT",
        detail({
          channelId: "SHORT",
          country: "US",
          videoCount: 3,
          subscriberCount: 900000,
        }),
      ],
    ]);

    const searchChannels = vi.fn(async (query: string, _maxResults?: number) => {
      if (query === "endurance athletes") {
        return [
          { channelId: "US1", title: "US One", description: "a" },
          { channelId: "SHARED", title: "Shared", description: "a" },
        ];
      }
      if (query === "busy parents") {
        return [
          { channelId: "SHARED", title: "Shared", description: "a" },
          { channelId: "IN1", title: "Fit Tuber", description: "a" },
          { channelId: "EN1", title: "English Lab", description: "a" },
          { channelId: "ES1", title: "Cocina", description: "a" },
          { channelId: "SHORT", title: "Short", description: "a" },
        ];
      }
      return [];
    });
    const getMultipleChannelDetails = vi.fn(async (ids: string[]) =>
      ids.map((id) => rows.get(id)).filter((row): row is YouTubeChannelDetails => !!row)
    );
    const getRecentVideoStats = vi.fn(async () => ({
      videos: [],
      averageViews: 50000,
      averageLikes: 0,
      averageComments: 0,
      totalVideosAnalyzed: 5,
    }));
    vi.mocked(getYouTubeClientSafe).mockReturnValue({
      searchChannels,
      getMultipleChannelDetails,
      getRecentVideoStats,
    } as never);

    const result = await discoverShows({
      target_interests: ["Health & Wellness"],
      keywords: ["sauna"],
      platforms: ["youtube"],
      ring_terms: [
        "endurance athletes",
        "busy parents",
        "strength training",
        "home cooking",
        "fifth ring dropped",
      ],
    });

    expect(searchChannels.mock.calls.map((call) => call[0])).toEqual([
      "endurance athletes",
      "busy parents",
      "strength training",
      "home cooking",
    ]);
    expect(searchChannels.mock.calls.every((call) => call[1] === 25)).toBe(true);
    expect(getMultipleChannelDetails).toHaveBeenCalledTimes(1);
    expect(getMultipleChannelDetails.mock.calls[0][0]).toEqual([
      "US1",
      "SHARED",
      "IN1",
      "EN1",
      "ES1",
      "SHORT",
    ]);

    const ids = result.discovered.map((show) => show.youtube_channel_id);
    expect(ids).toEqual(["US1", "SHARED", "EN1"]);
    expect(result.sources.youtube).toBe(3);
    expect(result.discovered.find((show) => show.youtube_channel_id === "US1")?.categories).toEqual([
      "Fitness",
    ]);
  });

  it("batches channel detail calls at 50 ids", async () => {
    const ids = Array.from({ length: 51 }, (_, i) => `ch-${i}`);
    const searchChannels = vi.fn(async () =>
      ids.map((channelId) => ({ channelId, title: "T", description: "" }))
    );
    const getMultipleChannelDetails = vi.fn(async (_ids: string[]) => [] as YouTubeChannelDetails[]);
    vi.mocked(getYouTubeClientSafe).mockReturnValue({
      searchChannels,
      getMultipleChannelDetails,
      getRecentVideoStats: vi.fn(),
    } as never);

    const result = await discoverShows({
      target_interests: [],
      keywords: [],
      platforms: ["youtube"],
      ring_terms: ["endurance athletes"],
    });

    expect(result.discovered).toEqual([]);
    expect(getMultipleChannelDetails).toHaveBeenCalledTimes(2);
    expect(getMultipleChannelDetails.mock.calls[0][0]).toHaveLength(50);
    expect(getMultipleChannelDetails.mock.calls[1][0]).toEqual(["ch-50"]);
  });

  it("does not search YouTube for a podcast-only brief", async () => {
    vi.mocked(getYouTubeClientSafe).mockReturnValue(null);
    const result = await discoverShows({
      target_interests: ["Health & Wellness"],
      keywords: ["sauna"],
      platforms: ["podcast"],
      ring_terms: ["endurance athletes"],
    });
    expect(getYouTubeClientSafe).not.toHaveBeenCalled();
    expect(result.sources).toEqual({ podscan: 0, youtube: 0 });
  });

  it("keeps a failed ring search from dropping the other rings", async () => {
    const searchChannels = vi.fn(async (query: string) => {
      if (query === "endurance athletes") throw new Error("quotaExceeded");
      return [{ channelId: "US1", title: "US One", description: "a" }];
    });
    const getMultipleChannelDetails = vi.fn(async (ids: string[]) =>
      ids.map((id) => detail({ channelId: id }))
    );
    vi.mocked(getYouTubeClientSafe).mockReturnValue({
      searchChannels,
      getMultipleChannelDetails,
      getRecentVideoStats: vi.fn(async () => ({
        videos: [],
        averageViews: 50000,
        averageLikes: 0,
        averageComments: 0,
        totalVideosAnalyzed: 5,
      })),
    } as never);

    const result = await discoverShows({
      target_interests: [],
      keywords: [],
      platforms: ["youtube"],
      ring_terms: ["endurance athletes", "busy parents"],
    });

    expect(result.errors.some((line) => line.includes("quotaExceeded"))).toBe(true);
    expect(result.discovered.map((show) => show.youtube_channel_id)).toEqual(["US1"]);
  });

  it("searches the normalized label, the interest query, and the shorter tail for one ring", async () => {
    const searchChannels = vi.fn(async () => []);
    vi.mocked(getYouTubeClientSafe).mockReturnValue({
      searchChannels,
      getMultipleChannelDetails: vi.fn(),
      getRecentVideoStats: vi.fn(),
    } as never);

    const result = await discoverShows({
      target_interests: ["Health & Wellness"],
      keywords: [],
      platforms: ["youtube"],
      ring_terms: ["ingredient-literate women's wellness"],
    });

    expect(result.discovered).toEqual([]);
    expect(searchChannels.mock.calls.map((call) => call[0])).toEqual([
      "ingredient literate women wellness",
      "fitness workout",
      "literate womens wellness",
      "womens wellness",
    ]);
    expect(searchChannels.mock.calls.filter((call) => call[0] === "fitness workout")).toHaveLength(
      1
    );
  });

  it("does not add a fifth search when 4 ring searches all return 0 channels", async () => {
    const searchChannels = vi.fn(async () => []);
    vi.mocked(getYouTubeClientSafe).mockReturnValue({
      searchChannels,
      getMultipleChannelDetails: vi.fn(),
      getRecentVideoStats: vi.fn(),
    } as never);

    await discoverShows({
      target_interests: ["Health & Wellness"],
      keywords: ["sauna"],
      platforms: ["youtube"],
      ring_terms: [
        "endurance athletes",
        "busy parents",
        "strength training",
        "home cooking",
      ],
    });

    expect(searchChannels.mock.calls.map((call) => call[0])).toEqual([
      "endurance athletes",
      "busy parents",
      "strength training",
      "home cooking",
    ]);
    expect(youtubeInterestRetry(
      ["endurance athletes", "busy parents", "strength training", "home cooking"],
      [0, 0, 0, 0],
      "fitness workout sauna"
    )).toBeNull();
  });
});

describe("YouTube interest retry on empty", () => {
  beforeEach(() => {
    vi.mocked(getYouTubeClientSafe).mockReset();
  });

  it("runs the interest fallback once when every search returns 0 and the cap has room", async () => {
    const searchChannels = vi.fn(async () => []);
    const getMultipleChannelDetails = vi.fn();
    vi.mocked(getYouTubeClientSafe).mockReturnValue({
      searchChannels,
      getMultipleChannelDetails,
      getRecentVideoStats: vi.fn(),
    } as never);

    const errors: string[] = [];
    const result = await discoverFromYoutube(
      ["ingredient literate women wellness"],
      errors,
      "fitness workout"
    );

    expect(result).toEqual([]);
    expect(errors).toEqual([]);
    expect(searchChannels.mock.calls.map((call) => call[0])).toEqual([
      "ingredient literate women wellness",
      "fitness workout",
    ]);
    expect(getMultipleChannelDetails).not.toHaveBeenCalled();
  });

  it("does not run the interest fallback twice, past the cap, or after a hit", () => {
    expect(youtubeInterestRetry(["endurance athletes"], [0], "fitness workout")).toBe(
      "fitness workout"
    );
    expect(youtubeInterestRetry(["fitness workout"], [0], "fitness workout")).toBeNull();
    expect(youtubeInterestRetry(["Fitness Workout"], [0], "fitness workout")).toBeNull();
    expect(
      youtubeInterestRetry(
        ["one", "two", "three", "four"],
        [0, 0, 0, 0],
        "fitness workout"
      )
    ).toBeNull();
    expect(youtubeInterestRetry(["endurance athletes"], [3], "fitness workout")).toBeNull();
    expect(youtubeInterestRetry(["endurance athletes"], [0], "  ")).toBeNull();
  });

  it("keeps channels found by the empty retry and sends them through the market filter", async () => {
    const searchChannels = vi.fn(async (query: string) => {
      if (query === "fitness workout") {
        return [{ channelId: "US1", title: "US One", description: "a" }];
      }
      return [];
    });
    const getMultipleChannelDetails = vi.fn(async (ids: string[]) =>
      ids.map((id) => detail({ channelId: id }))
    );
    vi.mocked(getYouTubeClientSafe).mockReturnValue({
      searchChannels,
      getMultipleChannelDetails,
      getRecentVideoStats: vi.fn(async () => ({
        videos: [],
        averageViews: 50000,
        averageLikes: 0,
        averageComments: 0,
        totalVideosAnalyzed: 5,
      })),
    } as never);

    const result = await discoverFromYoutube(["narrow label"], [], "fitness workout");

    expect(searchChannels.mock.calls.map((call) => call[0])).toEqual([
      "narrow label",
      "fitness workout",
    ]);
    expect(getMultipleChannelDetails).toHaveBeenCalledTimes(1);
    expect(result.map((show) => show.youtube_channel_id)).toEqual(["US1"]);
  });

  it("does not retry when a planned search already returned channels", async () => {
    const searchChannels = vi.fn(async () => [
      { channelId: "US1", title: "US One", description: "a" },
    ]);
    vi.mocked(getYouTubeClientSafe).mockReturnValue({
      searchChannels,
      getMultipleChannelDetails: vi.fn(async (ids: string[]) =>
        ids.map((id) => detail({ channelId: id }))
      ),
      getRecentVideoStats: vi.fn(async () => ({
        videos: [],
        averageViews: 50000,
        averageLikes: 0,
        averageComments: 0,
        totalVideosAnalyzed: 5,
      })),
    } as never);

    const result = await discoverFromYoutube(["endurance athletes"], [], "fitness workout");
    expect(searchChannels.mock.calls.map((call) => call[0])).toEqual(["endurance athletes"]);
    expect(result.map((show) => show.youtube_channel_id)).toEqual(["US1"]);
  });
});
