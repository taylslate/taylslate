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
    getPodscanClientSafe: vi.fn(() => null),
  };
});

import { getYouTubeClientSafe, type YouTubeChannelDetails } from "@/lib/enrichment/youtube";
import { getPodscanClientSafe } from "@/lib/enrichment/podscan";
import { convictionWeights, scoreShowConviction, topicalRelevanceInputs } from "@/lib/scoring/conviction";
import type { CampaignPatternRow, RingHypothesisRow } from "@/lib/data/types";
import { createMemoryYoutubeStore, type YoutubeChannelRecord } from "@/lib/youtube-library/store";
import {
  YOUTUBE_DISCOVERY_QUOTA,
  applyYoutubeLibraryTopicalInput,
  discoverFromYoutube,
  discoverShows,
  excludeDeadYouTube,
  isDeadYouTube,
  passesYouTubeMarketFilter,
  youtubeBrandMatch,
  youtubeInterestRetry,
  youtubeLibraryTopicalInput,
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
  it("documents 4 x 100 video searches, detail calls, and uploads stats for every candidate", () => {
    expect(YOUTUBE_DISCOVERY_QUOTA.videoSearch).toBe(400);
    expect(YOUTUBE_DISCOVERY_QUOTA.channelDetailsWorstCase).toBe(4);
    // Worst case 200 market survivors x (playlistItems.list 1 + videos.list 1) = 400.
    // Video search 400 + channel details 4 = 404. 400 + 404 = 804.
    expect(YOUTUBE_DISCOVERY_QUOTA.recentVideoStats).toBe(400);
    expect(YOUTUBE_DISCOVERY_QUOTA.worstCase).toBe(
      YOUTUBE_DISCOVERY_QUOTA.videoSearch +
        YOUTUBE_DISCOVERY_QUOTA.channelDetailsWorstCase +
        YOUTUBE_DISCOVERY_QUOTA.recentVideoStats
    );
    expect(YOUTUBE_DISCOVERY_QUOTA.worstCase).toBe(804);
    expect(YOUTUBE_DISCOVERY_QUOTA.worstCase).toBeLessThan(1414);
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

    const searchVideos = vi.fn(async (query: string, _maxResults?: number, _order?: string) => {
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
      searchVideos,
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

    expect(searchVideos.mock.calls.map((call) => call[0])).toEqual([
      "endurance athletes",
      "busy parents",
      "strength training",
      "home cooking",
    ]);
    expect(searchVideos.mock.calls.every((call) => call[1] === 50)).toBe(true);
    expect(searchVideos.mock.calls.every((call) => call[2] === "relevance")).toBe(true);
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

  it("turns 4 queries of 50 videos into deduped channel ids and holds the 4-search cap", async () => {
    const queries = ["endurance athletes", "busy parents", "strength training", "home cooking"];
    const searchVideos = vi.fn(async (query: string, _maxResults?: number) => {
      const queryIndex = queries.indexOf(query);
      return Array.from({ length: 50 }, (_, i) => {
        const channelId =
          i === 0 || (queryIndex === 0 && i === 1) ? "SHARED" : `c-${queryIndex}-${i}`;
        return {
          channelId,
          videoId: `${queryIndex}-${i}`,
          title: "Video",
          description: "",
        };
      });
    });
    const searchChannels = vi.fn();
    const getMultipleChannelDetails = vi.fn(async (_ids: string[]) => [] as YouTubeChannelDetails[]);
    vi.mocked(getYouTubeClientSafe).mockReturnValue({
      searchVideos,
      searchChannels,
      getMultipleChannelDetails,
      getRecentVideoStats: vi.fn(),
    } as never);

    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const result = await discoverShows({
        target_interests: ["Health & Wellness"],
        keywords: ["sauna"],
        platforms: ["youtube"],
        ring_terms: [...queries, "fifth ring dropped"],
      });

      expect(result.discovered).toEqual([]);
      expect(searchChannels).not.toHaveBeenCalled();
      expect(searchVideos).toHaveBeenCalledTimes(4);
      expect(searchVideos.mock.calls.map((call) => call[0])).toEqual(queries);
      expect(searchVideos.mock.calls.every((call) => call[1] === 50)).toBe(true);

      const ids = getMultipleChannelDetails.mock.calls.flatMap((call) => call[0] as string[]);
      const expected = ["SHARED"];
      for (let i = 2; i <= 49; i++) expected.push(`c-0-${i}`);
      for (let queryIndex = 1; queryIndex <= 3; queryIndex++) {
        for (let i = 1; i <= 49; i++) expected.push(`c-${queryIndex}-${i}`);
      }
      expect(ids).toEqual(expected);
      expect(new Set(ids).size).toBe(196);
      expect(getMultipleChannelDetails).toHaveBeenCalledTimes(4);
      expect(getMultipleChannelDetails.mock.calls[0][0]).toHaveLength(50);
      expect(getMultipleChannelDetails.mock.calls[3][0]).toHaveLength(46);

      const lines = log.mock.calls.map((call) => String(call[0]));
      expect(lines).toContain(`[discovery] YouTube query 1 "endurance athletes" → 49 channels`);
      expect(lines).toContain(`[discovery] YouTube query 2 "busy parents" → 50 channels`);
      expect(lines).toContain(`[discovery] YouTube query 3 "strength training" → 50 channels`);
      expect(lines).toContain(`[discovery] YouTube query 4 "home cooking" → 50 channels`);
      expect(lines).toContain(`[discovery] YouTube unique channels: 196`);
    } finally {
      log.mockRestore();
    }
  });

  it("batches channel detail calls at 50 ids", async () => {
    const ids = Array.from({ length: 51 }, (_, i) => `ch-${i}`);
    const searchVideos = vi.fn(async () =>
      ids.map((channelId) => ({ channelId, title: "T", description: "" }))
    );
    const getMultipleChannelDetails = vi.fn(async (_ids: string[]) => [] as YouTubeChannelDetails[]);
    vi.mocked(getYouTubeClientSafe).mockReturnValue({
      searchVideos,
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
    const searchVideos = vi.fn(async (query: string) => {
      if (query === "endurance athletes") throw new Error("quotaExceeded");
      return [{ channelId: "US1", title: "US One", description: "a" }];
    });
    const getMultipleChannelDetails = vi.fn(async (ids: string[]) =>
      ids.map((id) => detail({ channelId: id }))
    );
    vi.mocked(getYouTubeClientSafe).mockReturnValue({
      searchVideos,
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
    const searchVideos = vi.fn(async (_query: string, _maxResults?: number) => []);
    vi.mocked(getYouTubeClientSafe).mockReturnValue({
      searchVideos,
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
    expect(searchVideos.mock.calls.map((call) => call[0])).toEqual([
      "ingredient literate women wellness",
      "fitness workout",
      "literate womens wellness",
      "womens wellness",
    ]);
    expect(searchVideos.mock.calls.filter((call) => call[0] === "fitness workout")).toHaveLength(
      1
    );
  });

  it("does not add a fifth search when 4 ring searches all return 0 channels", async () => {
    const searchVideos = vi.fn(async (_query: string, _maxResults?: number) => []);
    vi.mocked(getYouTubeClientSafe).mockReturnValue({
      searchVideos,
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

    expect(searchVideos.mock.calls.map((call) => call[0])).toEqual([
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
    const searchVideos = vi.fn(async (_query: string, _maxResults?: number) => []);
    const getMultipleChannelDetails = vi.fn();
    vi.mocked(getYouTubeClientSafe).mockReturnValue({
      searchVideos,
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
    expect(searchVideos.mock.calls.map((call) => call[0])).toEqual([
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
    const searchVideos = vi.fn(async (query: string) => {
      if (query === "fitness workout") {
        return [{ channelId: "US1", title: "US One", description: "a" }];
      }
      return [];
    });
    const getMultipleChannelDetails = vi.fn(async (ids: string[]) =>
      ids.map((id) => detail({ channelId: id }))
    );
    vi.mocked(getYouTubeClientSafe).mockReturnValue({
      searchVideos,
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

    expect(searchVideos.mock.calls.map((call) => call[0])).toEqual([
      "narrow label",
      "fitness workout",
    ]);
    expect(getMultipleChannelDetails).toHaveBeenCalledTimes(1);
    expect(result.map((show) => show.youtube_channel_id)).toEqual(["US1"]);
  });

  it("does not retry when a planned search already returned channels", async () => {
    const searchVideos = vi.fn(async (_query: string, _maxResults?: number) => [
      { channelId: "US1", title: "US One", description: "a" },
    ]);
    vi.mocked(getYouTubeClientSafe).mockReturnValue({
      searchVideos,
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
    expect(searchVideos.mock.calls.map((call) => call[0])).toEqual(["endurance athletes"]);
    expect(result.map((show) => show.youtube_channel_id)).toEqual(["US1"]);
  });
});

function recentStats(averageViews: number) {
  return {
    videos: [],
    averageViews,
    meanViews: averageViews,
    medianViews: averageViews,
    averageLikes: 0,
    averageComments: 0,
    totalVideosAnalyzed: 5,
    uploadCount: 5,
    method: "uploads" as const,
  };
}

describe("youtubeBrandMatch", () => {
  it("keeps shop-my and merch-store lines, and a bare shop or store", () => {
    expect(youtubeBrandMatch({ title: "The Dr. Gundry Podcast", description: "shop my favorites" })).toBe(
      null
    );
    expect(
      youtubeBrandMatch({ title: "Jordan Dorn | Zuma Nutrition", description: "merch store" })
    ).toBe(null);
    expect(youtubeBrandMatch({ title: "Lab", description: "a shop for lifters and your training" })).toBe(
      null
    );
    expect(youtubeBrandMatch({ title: "Lab", description: "the store for your training" })).toBe(null);
    expect(youtubeBrandMatch({ title: "Lab", description: "SHOP MY FAVORITES" })).toBe(null);
    expect(youtubeBrandMatch({ title: "Lab", description: "Merch Store" })).toBe(null);
  });

  it("does not treat shop or store as a substring of another word", () => {
    expect(youtubeBrandMatch({ title: "Lab", description: "restore your workshop" })).toBe(null);
    expect(youtubeBrandMatch({ title: "Costco", description: "training for your health" })).toBe(null);
    expect(youtubeBrandMatch({ title: "Shop Talk", description: "training for your health" })).toBe(null);
    expect(youtubeBrandMatch({ title: "Official Gear", description: "training for your health" })).toBe(
      null
    );
  });

  it("drops a strong commercial phrase when the description has no creator signal", () => {
    expect(
      youtubeBrandMatch({
        title: "Supplement Brand",
        description: "Visit our official website and use code SAVE",
      })
    ).toBe("official website");
    expect(youtubeBrandMatch({ title: "Brand", description: "see our products for your training" })).toBe(
      "our products"
    );
    expect(youtubeBrandMatch({ title: "Brand", description: "buy now for your plan" })).toBe("buy now");
    expect(youtubeBrandMatch({ title: "Brand", description: "free shipping on every order" })).toBe(
      "free shipping"
    );
    expect(youtubeBrandMatch({ title: "Brand", description: "use code SAVE at checkout" })).toBe(
      "use code"
    );
    expect(youtubeBrandMatch({ title: "Brand", description: "contact customer service" })).toBe(
      "customer service"
    );
    expect(youtubeBrandMatch({ title: "Brand", description: "order now for delivery" })).toBe("order now");
  });

  it("does not match a commercial phrase inside a longer word", () => {
    expect(youtubeBrandMatch({ title: "Brand", description: "buy nowadays" })).toBe(null);
    expect(youtubeBrandMatch({ title: "Brand", description: "use codec in your edit" })).toBe(null);
    expect(youtubeBrandMatch({ title: "Brand", description: "unofficial website" })).toBe(null);
    expect(youtubeBrandMatch({ title: "Brand", description: "our production notes" })).toBe(null);
  });

  it("keeps a commercial phrase when the description has a creator signal", () => {
    expect(
      youtubeBrandMatch({
        title: "Dr. Gundry",
        description: "I'm a host. Visit our official website and use code GUNDRY. Shop my favorites.",
      })
    ).toBe(null);
    expect(
      youtubeBrandMatch({
        title: "Trainer",
        description: "use code FIT on my merch store",
      })
    ).toBe(null);
  });

  it("drops a title that ends with a company marker even when the description is a creator", () => {
    expect(
      youtubeBrandMatch({ title: "Maker Co", description: "shop my favorites" })
    ).toBe("Co");
    expect(youtubeBrandMatch({ title: "Maker Co.", description: "the channel for your training" })).toBe(
      "Co"
    );
    expect(youtubeBrandMatch({ title: "Acme, Inc.", description: "the channel for your training" })).toBe(
      "Inc"
    );
    expect(youtubeBrandMatch({ title: "Acme LLC", description: "the channel for your training" })).toBe(
      "LLC"
    );
    expect(youtubeBrandMatch({ title: "Nike Official", description: "the channel for your training" })).toBe(
      "Official"
    );
    expect(youtubeBrandMatch({ title: "Gear Store", description: "the channel for your training" })).toBe(
      "Store"
    );
    expect(youtubeBrandMatch({ title: "Gear Shop", description: "shop my favorites" })).toBe("Shop");
  });

  it("does not drop old substring keywords that are not a strong phrase or a title marker", () => {
    expect(
      youtubeBrandMatch({
        title: "Founded Brand",
        description: "Founded in 2014. We manufacture home gym equipment. Shop now. Discount code inside.",
      })
    ).toBe(null);
  });
});

describe("YouTube post-filter stage logs", () => {
  beforeEach(() => {
    vi.mocked(getYouTubeClientSafe).mockReset();
  });

  it("keeps creator lines and applies both video-count and average-view floors", async () => {
    const tenStats = recentStats(20_000);
    const shopStats = recentStats(15_000);
    const merchStats = recentStats(12_000);
    const recentEdgeStats = recentStats(10_000);
    const channels = [
      detail({
        channelId: "IN1",
        title: "Fit Tuber",
        country: "IN",
        subscriberCount: 1_000_000,
        videoCount: 100,
        totalViewCount: 9_000_000,
        description: "The best fitness channel for your home workouts",
      }),
      detail({
        channelId: "FEW",
        title: "Few Videos",
        subscriberCount: 900_000,
        videoCount: 9,
        totalViewCount: 5_000_000,
      }),
      detail({
        channelId: "TEN",
        title: "Ten Videos",
        subscriberCount: 800_000,
        videoCount: 10,
        totalViewCount: 60_000,
      }),
      detail({
        channelId: "SHOP_MY",
        title: "The Dr. Gundry Podcast",
        subscriberCount: 700_000,
        videoCount: 19,
        totalViewCount: 1_900_000,
        description: "shop my favorites",
      }),
      detail({
        channelId: "MERCH",
        title: "Jordan Dorn | Zuma Nutrition",
        subscriberCount: 600_000,
        videoCount: 40,
        totalViewCount: 2_000_000,
        description: "merch store",
      }),
      detail({
        channelId: "COMMERCIAL",
        title: "Supplement Brand",
        subscriberCount: 500_000,
        videoCount: 80,
        totalViewCount: 8_000_000,
        description: "Visit our official website and use code SAVE",
      }),
      detail({
        channelId: "TITLE_CO",
        title: "Maker Co",
        subscriberCount: 400_000,
        videoCount: 80,
        totalViewCount: 8_000_000,
        description: "We manufacture home gym equipment for your training",
      }),
      detail({
        channelId: "RECENT_MID",
        title: "Recent Mid",
        subscriberCount: 300_000,
        videoCount: 40,
        totalViewCount: 2_000_000,
      }),
      detail({
        channelId: "RECENT_EDGE",
        title: "Recent Edge",
        subscriberCount: 250_000,
        videoCount: 40,
        totalViewCount: 40_000,
      }),
      detail({
        channelId: "RECENT_LOW",
        title: "Recent Low",
        subscriberCount: 200_000,
        videoCount: 40,
        totalViewCount: 2_000_000,
      }),
      detail({
        channelId: "FALLBACK_MID",
        title: "Catalog Mid",
        subscriberCount: 80_000,
        videoCount: 40,
        totalViewCount: 240_000,
      }),
      detail({
        channelId: "FALLBACK_EDGE",
        title: "Catalog Edge",
        subscriberCount: 50_000,
        videoCount: 40,
        totalViewCount: 200_000,
      }),
      detail({
        channelId: "FALLBACK_LOW",
        title: "Catalog Low",
        subscriberCount: 40_000,
        videoCount: 40,
        totalViewCount: 199_960,
      }),
    ];
    const byId = new Map(channels.map((channel) => [channel.channelId, channel]));
    const statsById: Record<string, ReturnType<typeof recentStats> | null> = {
      FEW: recentStats(90_000),
      TEN: tenStats,
      SHOP_MY: shopStats,
      MERCH: merchStats,
      COMMERCIAL: recentStats(50_000),
      TITLE_CO: recentStats(70_000),
      RECENT_MID: recentStats(6_000),
      RECENT_EDGE: recentEdgeStats,
      RECENT_LOW: recentStats(9_999),
      FALLBACK_MID: null,
    };
    const recentUploadsStats = vi.fn(async (channelId: string) => {
      if (!(channelId in statsById)) {
        throw new Error(`unexpected stats fetch ${channelId}`);
      }
      return statsById[channelId];
    });
    const getRecentVideoStats = vi.fn();

    vi.mocked(getYouTubeClientSafe).mockReturnValue({
      searchVideos: vi.fn(async () =>
        channels.map((channel) => ({
          channelId: channel.channelId,
          title: channel.title,
          description: channel.description,
        }))
      ),
      getMultipleChannelDetails: vi.fn(async (ids: string[]) =>
        ids.map((id) => byId.get(id)).filter((row): row is YouTubeChannelDetails => !!row)
      ),
      recentUploadsStats,
      getRecentVideoStats,
    } as never);

    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-26T20:00:00.000Z"));
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const expected = [
        youtubeChannelToShow(byId.get("TEN")!, tenStats),
        youtubeChannelToShow(byId.get("SHOP_MY")!, shopStats),
        youtubeChannelToShow(byId.get("MERCH")!, merchStats),
        youtubeChannelToShow(byId.get("RECENT_EDGE")!, recentEdgeStats),
        youtubeChannelToShow(byId.get("FALLBACK_MID")!),
        youtubeChannelToShow(byId.get("FALLBACK_EDGE")!),
      ];
      const errors: string[] = [];
      const result = await discoverFromYoutube(["endurance athletes"], errors);

      expect(result).toEqual(expected);
      expect(errors).toEqual([]);
      expect(getRecentVideoStats).not.toHaveBeenCalled();
      expect(recentUploadsStats.mock.calls.map((call) => call[0])).toEqual([
        "FEW",
        "TEN",
        "SHOP_MY",
        "MERCH",
        "COMMERCIAL",
        "TITLE_CO",
        "RECENT_MID",
        "RECENT_EDGE",
        "RECENT_LOW",
        "FALLBACK_MID",
        "FALLBACK_EDGE",
        "FALLBACK_LOW",
      ]);
      expect(recentUploadsStats.mock.calls.map((call) => call[0])).not.toContain("IN1");
      expect(log.mock.calls.map((call) => call[0])).toEqual([
        `[discovery] Running 1 YouTube queries...`,
        `[discovery] YouTube query 1 "endurance athletes" → 13 channels`,
        `[discovery] YouTube unique channels: 13`,
        `[discovery] YouTube after market filter: 12 of 13`,
        `[discovery] YouTube dropped videoCount < 10: 1`,
        `[discovery] YouTube dropped brand keyword: 2; first 2: "Supplement Brand" matched "official website"; "Maker Co" matched "Co"`,
        `[discovery] YouTube dropped avgViews: 3 (recent < 10000: 2, fallback < 5000: 1)`,
        `[discovery] YouTube avgViews method: recent=6 fallback=3`,
        `[discovery] YouTube survivor median avgViews: 11000`,
        `[discovery] YouTube returned: 6`,
      ]);
    } finally {
      log.mockRestore();
      vi.useRealTimers();
    }
  });

  it("names only the first 5 brand-keyword channels and returns none", async () => {
    const cases = [
      {
        title: "Brand 1",
        description: "Visit our official website for your training",
        keyword: "official website",
      },
      { title: "Brand 2", description: "see our products for your training", keyword: "our products" },
      { title: "Brand 3", description: "buy now for your training plan", keyword: "buy now" },
      { title: "Brand 4", description: "free shipping on your training gear", keyword: "free shipping" },
      { title: "Brand 5", description: "use code SAVE for your training", keyword: "use code" },
      { title: "Brand 6", description: "contact customer service for your training", keyword: "customer service" },
    ];
    const channels = cases.map((row, index) =>
      detail({
        channelId: `BR${index + 1}`,
        title: row.title,
        description: row.description,
        subscriberCount: (cases.length - index) * 100_000,
        videoCount: 40,
        totalViewCount: 4_000_000,
      })
    );

    vi.mocked(getYouTubeClientSafe).mockReturnValue({
      searchVideos: vi.fn(async () =>
        channels.map((channel) => ({
          channelId: channel.channelId,
          title: channel.title,
          description: channel.description,
        }))
      ),
      getMultipleChannelDetails: vi.fn(async () => channels),
      getRecentVideoStats: vi.fn(async () => recentStats(50_000)),
    } as never);

    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const result = await discoverFromYoutube(["endurance athletes"], []);
      expect(result).toEqual([]);
      const lines = log.mock.calls.map((call) => String(call[0]));
      expect(lines).toContain(
        `[discovery] YouTube dropped brand keyword: 6; first 5: ${cases
          .slice(0, 5)
          .map((row) => `"${row.title}" matched "${row.keyword}"`)
          .join("; ")}`
      );
      expect(lines).toContain(`[discovery] YouTube dropped videoCount < 10: 0`);
      expect(lines).toContain(
        `[discovery] YouTube dropped avgViews: 0 (recent < 10000: 0, fallback < 5000: 0)`
      );
      expect(lines).toContain(`[discovery] YouTube avgViews method: recent=0 fallback=0`);
      expect(lines).toContain(`[discovery] YouTube survivor median avgViews: n/a`);
      expect(lines).toContain(`[discovery] YouTube returned: 0`);
    } finally {
      log.mockRestore();
    }
  });

  it("logs a swallowed YouTube failure and still returns no shows", async () => {
    const boom = new Error(
      "YouTube API error 400: https://www.googleapis.com/youtube/v3/channels?key=SECRETVALUE&part=snippet"
    );
    vi.mocked(getYouTubeClientSafe).mockReturnValue({
      searchVideos: vi.fn(async () => [{ channelId: "US1", title: "US One", description: "a" }]),
      getMultipleChannelDetails: vi.fn(async () => {
        throw boom;
      }),
      getRecentVideoStats: vi.fn(),
    } as never);

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const errors: string[] = [];
      const result = await discoverFromYoutube(["endurance athletes"], errors);
      expect(result).toEqual([]);
      expect(errors).toEqual([
        "YouTube discovery failed: YouTube API error 400: https://www.googleapis.com/youtube/v3/channels?key=[redacted]&part=snippet",
      ]);
      expect(errors.join("\n")).not.toContain("SECRETVALUE");
      expect(errorSpy).toHaveBeenCalledTimes(1);
      const logged = errorSpy.mock.calls[0].map((part) => String(part)).join("\n");
      expect(logged).toContain("YouTube discovery failed:");
      expect(logged).toContain("YouTube API error 400:");
      expect(logged).toContain("key=[redacted]");
      expect(logged).not.toContain("SECRETVALUE");
      expect(logged).toContain("discover-shows.test.ts");
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("logs a non-Error throw as unknown error", async () => {
    vi.mocked(getYouTubeClientSafe).mockReturnValue({
      searchVideos: vi.fn(async () => [{ channelId: "US1", title: "US One", description: "a" }]),
      getMultipleChannelDetails: vi.fn(async () => {
        throw "nope";
      }),
      getRecentVideoStats: vi.fn(),
    } as never);

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const errors: string[] = [];
      const result = await discoverFromYoutube(["endurance athletes"], errors);
      expect(result).toEqual([]);
      expect(errors).toEqual(["YouTube discovery failed: unknown error"]);
      expect(errorSpy).toHaveBeenCalledWith(
        "[discovery] YouTube discovery failed:",
        "unknown error",
        undefined
      );
    } finally {
      errorSpy.mockRestore();
    }
  });
});

describe("YouTube library topical input", () => {
  const ringTerms = ["protein gummies"];
  const primaryCategories = ["health"];

  function libraryRecord(
    overrides: Partial<YoutubeChannelRecord> & { channel_id: string }
  ): YoutubeChannelRecord {
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
      keywords: [],
      niche_tags: [],
      niche_tags_version: 1,
      tagged_at: "2026-10-01T00:00:00.000Z",
      passed_market_filter: true,
      brand_flag: null,
      show_id: null,
      source: "category",
      source_query: "health tips",
      first_seen_at: "2026-01-01T00:00:00.000Z",
      stats_refreshed_at: "2026-10-20T00:00:00.000Z",
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-10-20T00:00:00.000Z",
      ...overrides,
    };
  }

  function pattern(): CampaignPatternRow {
    return {
      id: "cp-1",
      campaign_id: "camp-1",
      customer_id: "cust-1",
      created_at: "2026-01-01T00:00:00.000Z",
      product_attributes: { category: "protein gummies", key_attributes: ["protein gummies"] },
      customer_description: null,
      aov_bucket: "mid",
      scoring_weights: null,
    };
  }

  function ring(): RingHypothesisRow {
    return {
      id: "ring-1",
      campaign_pattern_id: "cp-1",
      created_at: "2026-01-01T00:00:00.000Z",
      kind: "primary",
      label: "protein gummies",
      reasoning: "easy daily protein",
      confidence: "high",
      confidence_score: 80,
      brand_confirmed: true,
      brand_decision: "confirmed",
      slot_position: 0,
    };
  }

  it("gives primary and adjacent matches the same topical input", async () => {
    expect(
      youtubeLibraryTopicalInput({ matchLevel: "primary", ringTerms, primaryCategories })
    ).toEqual(
      youtubeLibraryTopicalInput({ matchLevel: "adjacent", ringTerms, primaryCategories })
    );
    expect(
      youtubeLibraryTopicalInput({ matchLevel: "adjacent", ringTerms, primaryCategories })
    ).toEqual(["protein gummies"]);

    const store = createMemoryYoutubeStore();
    await store.saveChannel(
      libraryRecord({
        channel_id: "health",
        niche_tags: ["Health & Wellness"],
        source_query: "health tips",
        topic_categories: ["protein"],
        avg_recent_views: 20000,
        subscriber_count: 10,
      })
    );
    await store.saveChannel(
      libraryRecord({
        channel_id: "fitness",
        niche_tags: [],
        source_query: "gym workout",
        topic_categories: ["Gym workout"],
        avg_recent_views: 90000,
        subscriber_count: 90,
      })
    );
    vi.mocked(getYouTubeClientSafe).mockReturnValue({
      searchVideos: vi.fn(async () => []),
      getMultipleChannelDetails: vi.fn(async () => []),
      getRecentVideoStats: vi.fn(),
    } as never);

    const shows = await discoverFromYoutube(["protein gummies"], [], "", [], {
      store,
      now: new Date("2026-10-26T00:00:00.000Z"),
      rings: [{ id: "protein gummies", terms: ["protein gummies"] }],
    });
    const health = shows.find((show) => show.youtube_channel_id === "health");
    const fitness = shows.find((show) => show.youtube_channel_id === "fitness");
    expect(health).toBeTruthy();
    expect(fitness).toBeTruthy();
    expect(health?.categories).toEqual(["protein"]);
    expect(fitness?.categories).toEqual(["Gym workout"]);
    expect(health?.audience_interests).toEqual(["protein", "protein gummies"]);
    expect(fitness?.audience_interests).toEqual(["Gym workout", "protein gummies"]);

    const added = youtubeLibraryTopicalInput({
      matchLevel: "primary",
      ringTerms,
      primaryCategories,
    });
    expect(health?.audience_interests?.slice(-added.length)).toEqual(added);
    expect(fitness?.audience_interests?.slice(-added.length)).toEqual(added);

    const scoredPrimary = scoreShowConviction(health!, ring(), pattern());
    const scoredAdjacent = scoreShowConviction(fitness!, ring(), pattern());
    expect(scoredAdjacent.topicalRelevance).toBe(scoredPrimary.topicalRelevance);
    expect(scoredAdjacent.topicalRelevance).toBe(85);
    expect(scoredAdjacent.weights).toEqual(scoredPrimary.weights);
    expect(scoredPrimary.weights).toEqual(convictionWeights("mid"));

    const unstamped = applyYoutubeLibraryTopicalInput(
      { ...fitness!, audience_interests: ["Gym workout"] },
      { matchLevel: "adjacent", ringTerms: [], primaryCategories: [] }
    );
    expect(topicalRelevanceInputs(unstamped)).toEqual(
      topicalRelevanceInputs({ ...fitness!, audience_interests: ["Gym workout"] })
    );
    expect(scoreShowConviction(unstamped, ring(), pattern()).topicalRelevance).toBe(20);
  });
});

describe("podcast discovery regression", () => {
  const episode = {
    episode_id: "ep_fixture",
    episode_title: "Morning health",
    podcast_id: "pd_fixture",
    podcast: {
      podcast_id: "pd_fixture",
      podcast_name: "Health Cast",
      podcast_description: "A health show",
      podcast_categories: ["Health"],
      publisher_name: "Health House",
      reach: { audience_size: 20000, email: "host@example.com" },
      rss_url: "https://example.com/feed.xml",
    },
  };

  function slim(show: {
    id: string;
    name: string;
    platform: string;
    description: string;
    categories: string[];
    audience_interests: string[];
    audience_size: number;
    network?: string;
    price_type: string;
    podscan_id?: string;
    rss_url?: string;
    contact: { email: string };
    rate_card: unknown;
  }) {
    return {
      id: show.id,
      name: show.name,
      platform: show.platform,
      description: show.description,
      categories: show.categories,
      audience_interests: show.audience_interests,
      audience_size: show.audience_size,
      network: show.network ?? null,
      price_type: show.price_type,
      podscan_id: show.podscan_id ?? null,
      rss_url: show.rss_url ?? null,
      contact_email: show.contact.email,
      rate_card: show.rate_card,
    };
  }

  it("keeps podcast results byte-identical on the fixture", async () => {
    vi.mocked(getPodscanClientSafe).mockReturnValue({
      searchEpisodes: async () => ({
        data: [episode],
        pagination: { total: 1, per_page: 25, current_page: 1, last_page: 1 },
      }),
    } as never);
    try {
      const result = await discoverShows({
        target_interests: ["Health & Wellness"],
        keywords: ["protein"],
        platforms: ["podcast"],
        ring_terms: ["protein gummies"],
      });
      expect(result.sources).toEqual({ podscan: 1, youtube: 0 });
      expect(result.errors).toEqual([]);
      expect(result.discovered.map((show) => slim(show))).toMatchInlineSnapshot(`
        [
          {
            "audience_interests": [
              "Health",
            ],
            "audience_size": 20000,
            "categories": [
              "Health",
            ],
            "contact_email": "host@example.com",
            "description": "A health show",
            "id": "discovered-podscan-pd_fixture",
            "name": "Health Cast",
            "network": "Health House",
            "platform": "podcast",
            "podscan_id": "pd_fixture",
            "price_type": "cpm",
            "rate_card": {
              "midroll_cpm": 22,
              "postroll_cpm": 10,
              "preroll_cpm": 15,
            },
            "rss_url": "https://example.com/feed.xml",
          },
        ]
      `);
    } finally {
      vi.mocked(getPodscanClientSafe).mockReturnValue(null);
    }
  });
});
