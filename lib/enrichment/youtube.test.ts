import { afterEach, describe, expect, it, vi } from "vitest";
import { YouTubeClient } from "./youtube";

function stubFetch(body: unknown) {
  const fetchMock = vi.fn(async () => {
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
