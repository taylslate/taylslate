import { afterEach, describe, expect, it, vi } from "vitest";
import {
  YouTubeClient,
  UPLOADS_STATS_UNITS,
  YOUTUBE_IDS_PER_CALL,
  chunk,
  isShortFormDuration,
  parseIso8601DurationSeconds,
  parseYouTubeChannelKeywords,
  summarizeLongFormUploads,
  uploadsPlaylistId,
  wikipediaTopicUrlToLabel,
  type UploadedVideoSample,
} from "./youtube";

function stubFetch(body: unknown) {
  const fetchMock = vi.fn(async (_input: string | URL | Request) => {
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function searchUrl(fetchMock: ReturnType<typeof vi.fn>): URL {
  const raw = fetchMock.mock.calls
    .map((call) => String(call[0]))
    .find((url) => url.includes("/search"));
  if (!raw) throw new Error("no /search request");
  return new URL(raw);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("YouTube search market filters", () => {
  it("searches videos for the last 12 months in the US English market", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-26T21:46:00.000Z"));
    try {
      const fetchMock = stubFetch({
        items: [
          {
            id: { kind: "youtube#video", videoId: "vid-high" },
            snippet: {
              channelId: "UC-first",
              title: "Most watched",
              description: "A home workout",
            },
          },
          {
            id: { kind: "youtube#video", videoId: "vid-second" },
            snippet: {
              channelId: "UC-first",
              title: "Also watched",
              description: "Same channel",
            },
          },
          {
            id: { kind: "youtube#video", videoId: "vid-next" },
            snippet: {
              channelId: "UC-second",
              title: "Next",
              description: "Another creator",
            },
          },
          {
            id: { videoId: "vid-blank" },
            snippet: { title: "No channel", description: "" },
          },
        ],
      });
      const client = new YouTubeClient("test-key");

      const hits = await client.searchVideos("home fitness", 50);

      const url = searchUrl(fetchMock);
      expect(url.pathname).toBe("/youtube/v3/search");
      expect(url.searchParams.get("part")).toBe("snippet");
      expect(url.searchParams.get("type")).toBe("video");
      expect(url.searchParams.get("order")).toBe("relevance");
      expect(url.searchParams.get("videoDuration")).toBe("medium");
      expect(url.searchParams.get("publishedAfter")).toBe("2025-10-26T21:46:00.000Z");
      expect(url.searchParams.get("regionCode")).toBe("US");
      expect(url.searchParams.get("relevanceLanguage")).toBe("en");
      expect(url.searchParams.get("maxResults")).toBe("50");
      expect(url.searchParams.get("q")).toBe("home fitness");
      expect(url.searchParams.get("key")).toBe("test-key");
      expect(hits).toEqual([
        {
          channelId: "UC-first",
          videoId: "vid-high",
          title: "Most watched",
          description: "A home workout",
        },
        {
          channelId: "UC-first",
          videoId: "vid-second",
          title: "Also watched",
          description: "Same channel",
        },
        {
          channelId: "UC-second",
          videoId: "vid-next",
          title: "Next",
          description: "Another creator",
        },
      ]);
      expect(fetchMock).toHaveBeenCalledTimes(1);

      await client.searchVideos("home fitness", 50, "viewCount");
      const ranked = new URL(String(fetchMock.mock.calls[1][0]));
      expect(ranked.searchParams.get("order")).toBe("viewCount");
    } finally {
      vi.useRealTimers();
    }
  });

  it("sends regionCode=US and relevanceLanguage=en on channel search", async () => {
    const fetchMock = stubFetch({ items: [] });
    const client = new YouTubeClient("test-key");

    await client.searchChannels("home fitness", 20);

    const url = searchUrl(fetchMock);
    expect(url.pathname).toBe("/youtube/v3/search");
    expect(url.searchParams.get("type")).toBe("channel");
    expect(url.searchParams.get("q")).toBe("home fitness");
    expect(url.searchParams.get("maxResults")).toBe("20");
    expect(url.searchParams.get("regionCode")).toBe("US");
    expect(url.searchParams.get("relevanceLanguage")).toBe("en");
    expect(url.searchParams.get("key")).toBe("test-key");
  });

  it("sends regionCode=US and relevanceLanguage=en on recent-video search", async () => {
    const fetchMock = stubFetch({ items: [] });
    const client = new YouTubeClient("test-key");

    await client.getRecentVideoStats("UCabc", 5);

    const url = searchUrl(fetchMock);
    expect(url.pathname).toBe("/youtube/v3/search");
    expect(url.searchParams.get("type")).toBe("video");
    expect(url.searchParams.get("channelId")).toBe("UCabc");
    expect(url.searchParams.get("order")).toBe("date");
    expect(url.searchParams.get("maxResults")).toBe("5");
    expect(url.searchParams.get("regionCode")).toBe("US");
    expect(url.searchParams.get("relevanceLanguage")).toBe("en");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("wikipedia topic labels", () => {
  it("turns a Wikipedia topic URL into a readable label", () => {
    expect(wikipediaTopicUrlToLabel("https://en.wikipedia.org/wiki/Physical_fitness")).toBe(
      "Physical fitness"
    );
    expect(wikipediaTopicUrlToLabel("https://en.wikipedia.org/wiki/Health")).toBe("Health");
    expect(
      wikipediaTopicUrlToLabel("https://en.wikipedia.org/wiki/Lifestyle_(sociology)")
    ).toBe("Lifestyle (sociology)");
    expect(
      wikipediaTopicUrlToLabel("https://en.wikipedia.org/wiki/Physical%20fitness")
    ).toBe("Physical fitness");
    expect(wikipediaTopicUrlToLabel("")).toBe("");
  });

  it("splits channel keywords and keeps quoted phrases", () => {
    expect(parseYouTubeChannelKeywords('fitness "home workout" nutrition fitness')).toEqual([
      "fitness",
      "home workout",
      "nutrition",
    ]);
    expect(parseYouTubeChannelKeywords(undefined)).toEqual([]);
    expect(parseYouTubeChannelKeywords("")).toEqual([]);
  });
});

describe("channel details parts", () => {
  it("requests snippet, statistics, topicDetails, and brandingSettings and maps topics", async () => {
    const fetchMock = stubFetch({
      items: [
        {
          id: "UCfit",
          snippet: {
            title: "Fit Lab",
            description: "Training",
            publishedAt: "2020-01-01T00:00:00.000Z",
            country: "US",
            defaultLanguage: "en",
            thumbnails: { high: { url: "https://img.example/fit.jpg", width: 1, height: 1 } },
          },
          statistics: {
            viewCount: "1000",
            subscriberCount: "50",
            hiddenSubscriberCount: false,
            videoCount: "40",
          },
          topicDetails: {
            topicCategories: [
              "https://en.wikipedia.org/wiki/Physical_fitness",
              "https://en.wikipedia.org/wiki/Nutrition",
            ],
          },
          brandingSettings: {
            channel: { keywords: 'fitness "home workout" nutrition' },
          },
        },
      ],
    });
    const client = new YouTubeClient("test-key");
    const rows = await client.getMultipleChannelDetails(["UCfit"]);

    const raw = String(fetchMock.mock.calls[0][0]);
    const url = new URL(raw);
    expect(url.pathname).toBe("/youtube/v3/channels");
    expect(url.searchParams.get("part")).toBe(
      "snippet,statistics,topicDetails,brandingSettings"
    );
    expect(url.searchParams.get("id")).toBe("UCfit");
    expect(rows).toHaveLength(1);
    expect(rows[0].country).toBe("US");
    expect(rows[0].defaultLanguage).toBe("en");
    expect(rows[0].topicCategories).toEqual(["Physical fitness", "Nutrition"]);
    expect(rows[0].keywords).toEqual(["fitness", "home workout", "nutrition"]);
    expect(rows[0].videoCount).toBe(40);
  });

  it("uses the same parts for a single channel", async () => {
    const fetchMock = stubFetch({ items: [] });
    const client = new YouTubeClient("test-key");
    const row = await client.getChannelDetails("UCfit");
    expect(row).toBeNull();
    const url = new URL(String(fetchMock.mock.calls[0][0]));
    expect(url.searchParams.get("part")).toBe(
      "snippet,statistics,topicDetails,brandingSettings"
    );
  });
});

describe("uploads playlist id", () => {
  it("replaces the UC prefix with UU and keeps a known uploads id", () => {
    expect(uploadsPlaylistId("UCabcdefghijklmnopqrstuv")).toBe("UUabcdefghijklmnopqrstuv");
    expect(uploadsPlaylistId("UCabc", "  UUalready  ")).toBe("UUalready");
    expect(uploadsPlaylistId("not-a-channel")).toBe("not-a-channel");
  });
});

describe("long-form recent views", () => {
  const now = new Date("2026-10-29T00:00:00.000Z");

  function daysAgo(days: number, extraMs = 0): string {
    return new Date(now.getTime() - days * 24 * 60 * 60 * 1000 - extraMs).toISOString();
  }

  function sample(
    videoId: string,
    publishedAt: string,
    durationSeconds: number | null,
    viewCount: number
  ): UploadedVideoSample {
    return { videoId, publishedAt, durationSeconds, viewCount };
  }

  it("parses durations and treats 60 seconds or less as Shorts", () => {
    expect(parseIso8601DurationSeconds("PT1H2M3S")).toBe(3723);
    expect(parseIso8601DurationSeconds("PT1M")).toBe(60);
    expect(parseIso8601DurationSeconds("PT61S")).toBe(61);
    expect(parseIso8601DurationSeconds("PT45S")).toBe(45);
    expect(parseIso8601DurationSeconds("")).toBeNull();
    expect(parseIso8601DurationSeconds("nope")).toBeNull();
    expect(isShortFormDuration(60)).toBe(true);
    expect(isShortFormDuration(61)).toBe(false);
    expect(isShortFormDuration(null)).toBe(false);
  });

  it("keeps long-form videos from the last 90 days and reports median and mean", () => {
    const summary = summarizeLongFormUploads(
      [
        sample("long-a", daysAgo(10), 300, 100),
        sample("short-45", daysAgo(20), 45, 99999),
        sample("long-b", daysAgo(30), 61, 300),
        sample("old", daysAgo(100), 600, 50000),
        sample("short-60", daysAgo(5), 60, 80000),
        sample("edge", daysAgo(90), 120, 500),
        sample("just-out", daysAgo(90, 1), 120, 700),
        sample("nodur", daysAgo(2), null, 1000),
      ],
      now
    );
    expect(summary.uploadCount).toBe(3);
    expect(summary.videos.map((video) => video.videoId)).toEqual(["long-a", "long-b", "edge"]);
    expect(summary.meanViews).toBe(300);
    expect(summary.medianViews).toBe(300);

    const even = summarizeLongFormUploads(
      [sample("a", daysAgo(1), 120, 10), sample("b", daysAgo(2), 120, 40)],
      now
    );
    expect(even.medianViews).toBe(25);
    expect(even.meanViews).toBe(25);
    expect(UPLOADS_STATS_UNITS).toBe(2);
  });
});

describe("recentUploadsStats", () => {
  const now = new Date("2026-10-29T00:00:00.000Z");

  function daysAgo(days: number): string {
    return new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
  }

  it("calls playlistItems.list then videos.list and drops Shorts and old uploads", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/playlistItems")) {
        return new Response(
          JSON.stringify({
            items: [
              { contentDetails: { videoId: "long-a", videoPublishedAt: daysAgo(10) } },
              { contentDetails: { videoId: "short-45", videoPublishedAt: daysAgo(3) } },
              { contentDetails: { videoId: "long-b", videoPublishedAt: daysAgo(20) } },
              { contentDetails: { videoId: "old", videoPublishedAt: daysAgo(100) } },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
      return new Response(
        JSON.stringify({
          items: [
            {
              id: "long-a",
              contentDetails: { duration: "PT5M" },
              statistics: { viewCount: "100", likeCount: "4", commentCount: "1" },
            },
            {
              id: "short-45",
              contentDetails: { duration: "PT45S" },
              statistics: { viewCount: "99999", likeCount: "1", commentCount: "1" },
            },
            {
              id: "long-b",
              contentDetails: { duration: "PT1M1S" },
              statistics: { viewCount: "300", likeCount: "6", commentCount: "3" },
            },
            {
              id: "old",
              contentDetails: { duration: "PT10M" },
              statistics: { viewCount: "50000", likeCount: "9", commentCount: "9" },
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    const client = new YouTubeClient("test-key");

    const stats = await client.recentUploadsStats("UCabcdefghijklmnopqrstuv", { now });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const playlist = new URL(String(fetchMock.mock.calls[0][0]));
    expect(playlist.pathname).toBe("/youtube/v3/playlistItems");
    expect(playlist.searchParams.get("part")).toBe("contentDetails");
    expect(playlist.searchParams.get("playlistId")).toBe("UUabcdefghijklmnopqrstuv");
    expect(playlist.searchParams.get("maxResults")).toBe("15");
    expect(playlist.searchParams.get("key")).toBe("test-key");
    const videos = new URL(String(fetchMock.mock.calls[1][0]));
    expect(videos.pathname).toBe("/youtube/v3/videos");
    expect(videos.searchParams.get("part")).toBe("statistics,contentDetails");
    expect(videos.searchParams.get("id")).toBe("long-a,short-45,long-b,old");
    expect(stats.method).toBe("uploads");
    expect(stats.uploadCount).toBe(2);
    expect(stats.meanViews).toBe(200);
    expect(stats.medianViews).toBe(200);
    expect(stats.averageViews).toBe(200);
    expect(stats.videos.map((video) => video.videoId)).toEqual(["long-a", "long-b"]);

    await client.recentUploadsStats("UCabcdefghijklmnopqrstuv", {
      uploadsPlaylistId: "UUalready",
      now,
    });
    const known = new URL(String(fetchMock.mock.calls[2][0]));
    expect(known.searchParams.get("playlistId")).toBe("UUalready");
  });

  it("falls back to the estimate and redacts the API key when the playlist call fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        return new Response("lookup failed ?key=super-secret-key&part=snippet", {
          status: 403,
          headers: { "content-type": "text/plain" },
        });
      })
    );
    const client = new YouTubeClient("test-key");
    try {
      const stats = await client.recentUploadsStats("UCabc", { fallbackAverage: 4321, now });
      expect(stats.method).toBe("estimate");
      expect(stats.averageViews).toBe(4321);
      expect(stats.meanViews).toBe(4321);
      expect(stats.uploadCount).toBe(0);
      const logged = warn.mock.calls.map((call) => call.map((part) => String(part)).join(" ")).join("\n");
      expect(logged).toContain("key=[redacted]");
      expect(logged).not.toContain("super-secret-key");
    } finally {
      warn.mockRestore();
    }
  });
});

describe("batched id calls", () => {
  const now = new Date("2026-10-29T00:00:00.000Z");

  function daysAgo(days: number): string {
    return new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
  }

  it("uses one channels.list call for 50 ids and two for 51", async () => {
    expect(chunk(Array.from({ length: 50 }, (_, index) => index), YOUTUBE_IDS_PER_CALL)).toHaveLength(1);
    expect(chunk(Array.from({ length: 51 }, (_, index) => index), YOUTUBE_IDS_PER_CALL)).toHaveLength(2);
    const fetchMock = vi.fn(async (_input: string | URL | Request) => {
      return new Response(JSON.stringify({ items: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    const client = new YouTubeClient("TESTKEY");
    const fifty = Array.from({ length: 50 }, (_, index) => `UC${String(index).padStart(22, "0")}`);
    await client.getMultipleChannelDetails(fifty);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(new URL(String(fetchMock.mock.calls[0][0])).searchParams.get("id")!.split(",")).toHaveLength(50);

    fetchMock.mockClear();
    await client.getMultipleChannelDetails([...fifty, "UCextra"]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const sizes = fetchMock.mock.calls.map(
      (call) => new URL(String(call[0])).searchParams.get("id")!.split(",").length
    );
    expect(sizes).toEqual([50, 1]);
    expect(Math.max(...sizes)).toBeLessThanOrEqual(50);
  });

  it("packs videos.list at 50 ids and limits playlist fetches to 4", async () => {
    let inFlight = 0;
    let max = 0;
    const channels = Array.from({ length: 4 }, (_, index) => `UC${String(index).padStart(22, "b")}`);
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/playlistItems")) {
        inFlight += 1;
        max = Math.max(max, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 15));
        inFlight -= 1;
        const playlistId = url.searchParams.get("playlistId") ?? "";
        const items = Array.from({ length: 15 }, (_, video) => ({
          contentDetails: {
            videoId: `${playlistId}-v${video}`,
            videoPublishedAt: daysAgo(5),
          },
        }));
        return new Response(JSON.stringify({ items }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      const ids = (url.searchParams.get("id") ?? "").split(",").filter(Boolean);
      expect(ids.length).toBeLessThanOrEqual(50);
      return new Response(
        JSON.stringify({
          items: ids.map((id) => ({
            id,
            contentDetails: { duration: "PT5M" },
            statistics: { viewCount: "80", likeCount: "1", commentCount: "1" },
          })),
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    const client = new YouTubeClient("TESTKEY");
    const batch = await client.recentUploadsStatsBatch(channels, { now });
    const videoCalls = fetchMock.mock.calls.filter((call) => String(call[0]).includes("/videos"));
    expect(videoCalls).toHaveLength(2);
    const videoSizes = videoCalls.map(
      (call) => new URL(String(call[0])).searchParams.get("id")!.split(",").length
    );
    expect(videoSizes).toEqual([50, 10]);
    expect(batch.playlistCalls).toBe(4);
    expect(batch.videoListCalls).toBe(2);
    expect(max).toBeLessThanOrEqual(4);
    expect(max).toBe(4);
    expect(batch.results).toHaveLength(4);
    expect(batch.results.every((row) => row.method === "uploads")).toBe(true);
  });

  it("estimates a channel whose playlist call times out and still measures the rest", async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const fetchMock = vi.fn((input: string | URL | Request, init?: RequestInit) => {
        const url = new URL(String(input));
        if (url.pathname.endsWith("/playlistItems") && url.searchParams.get("playlistId") === "UUslow") {
          return new Promise((_resolve, reject) => {
            const onAbort = () => reject(new Error("YouTube call timed out"));
            if (init?.signal?.aborted) onAbort();
            else init?.signal?.addEventListener("abort", onAbort);
          });
        }
        if (url.pathname.endsWith("/playlistItems")) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                items: [{ contentDetails: { videoId: "long-ok", videoPublishedAt: daysAgo(4) } }],
              }),
              { status: 200, headers: { "content-type": "application/json" } }
            )
          );
        }
        return Promise.resolve(
          new Response(
            JSON.stringify({
              items: [
                {
                  id: "long-ok",
                  contentDetails: { duration: "PT5M" },
                  statistics: { viewCount: "100", likeCount: "2", commentCount: "1" },
                },
              ],
            }),
            { status: 200, headers: { "content-type": "application/json" } }
          )
        );
      });
      vi.stubGlobal("fetch", fetchMock);
      const client = new YouTubeClient("TESTKEY");
      const pending = client.recentUploadsStatsBatch(["UCslow", "UCok"], { now, timeoutMs: 20 });
      await vi.advanceTimersByTimeAsync(20);
      const batch = await pending;
      expect(batch.results[0].method).toBe("estimate");
      expect(batch.results[1].method).toBe("uploads");
      expect(batch.results[1].meanViews).toBe(100);
      expect(batch.playlistCalls).toBe(2);
      const logged = warn.mock.calls.map((call) => call.map((part) => String(part)).join(" ")).join("\n");
      expect(logged).not.toContain("TESTKEY");
    } finally {
      warn.mockRestore();
      vi.useRealTimers();
    }
  });

  it("redacts key=TESTKEY when a playlist call fails and keeps the other channel", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      vi.stubGlobal(
        "fetch",
        vi.fn(async (input: string | URL | Request) => {
          const url = new URL(String(input));
          if (url.pathname.endsWith("/playlistItems") && url.searchParams.get("playlistId") === "UUbad") {
            return new Response("key=TESTKEY", { status: 403, headers: { "content-type": "text/plain" } });
          }
          if (url.pathname.endsWith("/playlistItems")) {
            return new Response(
              JSON.stringify({
                items: [{ contentDetails: { videoId: "long-ok", videoPublishedAt: daysAgo(4) } }],
              }),
              { status: 200, headers: { "content-type": "application/json" } }
            );
          }
          return new Response(
            JSON.stringify({
              items: [
                {
                  id: "long-ok",
                  contentDetails: { duration: "PT5M" },
                  statistics: { viewCount: "40", likeCount: "1", commentCount: "0" },
                },
              ],
            }),
            { status: 200, headers: { "content-type": "application/json" } }
          );
        })
      );
      const client = new YouTubeClient("TESTKEY");
      const batch = await client.recentUploadsStatsBatch(["UCbad", "UCok"], { now });
      expect(batch.results[0].method).toBe("estimate");
      expect(batch.results[1].method).toBe("uploads");
      const logged = warn.mock.calls.map((call) => call.map((part) => String(part)).join(" ")).join("\n");
      expect(logged).toContain("key=[redacted]");
      expect(logged).not.toContain("TESTKEY");
    } finally {
      warn.mockRestore();
    }
  });

  it("stores an empty uploads page as estimate, not a recent mean of 0", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = new URL(String(input));
        if (url.pathname.endsWith("/playlistItems")) {
          return new Response(JSON.stringify({ items: [] }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        throw new Error("videos.list should not run for an empty playlist");
      })
    );
    const client = new YouTubeClient("TESTKEY");
    const batch = await client.recentUploadsStatsBatch(["UCempty"], { now });
    expect(batch.playlistCalls).toBe(1);
    expect(batch.videoListCalls).toBe(0);
    expect(batch.results[0].method).toBe("estimate");
    expect(batch.results[0].uploadCount).toBe(0);
  });

  it("skips videos.list after the chunk deadline and marks those channels estimated", async () => {
    let nowMs = Date.parse("2026-10-29T00:00:00.000Z");
    const deadlineMs = nowMs + 50;
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/playlistItems")) {
        nowMs = deadlineMs;
        return new Response(
          JSON.stringify({
            items: [
              {
                contentDetails: {
                  videoId: `vid-${url.searchParams.get("playlistId")}`,
                  videoPublishedAt: daysAgo(4),
                },
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
      throw new Error("videos.list should not run after the deadline");
    });
    vi.stubGlobal("fetch", fetchMock);
    const client = new YouTubeClient("TESTKEY");
    const batch = await client.recentUploadsStatsBatch(["UCaaa"], {
      now,
      deadlineMs,
      clock: () => nowMs,
    });
    expect(batch.playlistCalls).toBe(1);
    expect(batch.videoListCalls).toBe(0);
    expect(batch.results[0].method).toBe("estimate");
    expect(fetchMock.mock.calls.every((call) => !String(call[0]).includes("/videos"))).toBe(true);
  });

  it("stops a stalled playlist batch at the chunk deadline", async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const start = Date.now();
      let playlistFetches = 0;
      vi.stubGlobal(
        "fetch",
        vi.fn((input: string | URL | Request) => {
          const url = new URL(String(input));
          if (url.pathname.endsWith("/playlistItems")) {
            playlistFetches += 1;
            return new Promise(() => {});
          }
          return Promise.resolve(new Response(JSON.stringify({ items: [] }), { status: 200 }));
        })
      );
      const client = new YouTubeClient("TESTKEY");
      const ids = Array.from({ length: 10 }, (_, index) => `UC${String(index).padStart(22, "c")}`);
      const pending = client.recentUploadsStatsBatch(ids, {
        now,
        deadlineMs: start + 40_000,
        clock: () => Date.now(),
      });
      await vi.advanceTimersByTimeAsync(45_000);
      const batch = await pending;
      expect(Date.now() - start).toBeLessThan(300_000);
      expect(batch.playlistCalls).toBe(8);
      expect(playlistFetches).toBe(8);
      expect(batch.videoListCalls).toBe(0);
      expect(batch.results).toHaveLength(10);
      expect(batch.results.every((row) => row.method === "estimate")).toBe(true);
    } finally {
      warn.mockRestore();
      vi.useRealTimers();
    }
  });
});
