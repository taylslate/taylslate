import { afterEach, describe, expect, it, vi } from "vitest";
import {
  YouTubeClient,
  parseYouTubeChannelKeywords,
  wikipediaTopicUrlToLabel,
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
