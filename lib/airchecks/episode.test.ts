import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("node:dns/promises", () => ({
  lookup: async () => [{ address: "93.184.216.34", family: 4 }],
}));
import { YouTubeClient } from "@/lib/enrichment/youtube";
import {
  findPodcastEpisode,
  findYoutubeEpisode,
  type YoutubeAircheckClient,
} from "./episode";

const RSS = `<?xml version="1.0"?>
<rss><channel>
  <item>
    <link>https://example.com/old</link>
    <enclosure url="https://cdn.example.com/old.mp3"/>
    <pubDate>Mon, 01 Jun 2026 12:00:00 GMT</pubDate>
  </item>
  <item>
    <link>https://example.com/spot</link>
    <enclosure url="https://cdn.example.com/spot.mp3"/>
    <itunes:duration>45:00</itunes:duration>
    <pubDate>Tue, 03 Nov 2026 12:00:00 GMT</pubDate>
  </item>
  <item>
    <link>https://example.com/other-show</link>
    <enclosure url="https://cdn.example.com/catalog.mp3"/>
    <pubDate>Wed, 04 Nov 2026 12:00:00 GMT</pubDate>
  </item>
</channel></rss>`;

const WINDOW = { start: "2026-11-01", end: "2026-11-07" };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("find the booked episode", () => {
  it("pulls the one RSS enclosure inside the air window", async () => {
    const fetchMock = vi.fn(async (_input: string | URL | Request) => {
      return new Response(RSS, { status: 200, headers: { "content-type": "application/rss+xml" } });
    });
    vi.stubGlobal("fetch", fetchMock);

    const found = await findPodcastEpisode({
      rssUrl: "https://example.com/show.xml",
      episodeUrl: null,
      postDate: "2026-11-03",
      window: WINDOW,
    });
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("https://example.com/show.xml");
    expect(found).toMatchObject({
      audioUrl: "https://cdn.example.com/spot.mp3",
      durationSeconds: 45 * 60,
      source: "rss",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(found)).not.toContain("catalog.mp3");
  });

  it("asks one channel for the video inside the window and does not search", async () => {
    const recent = vi.fn(async (channelId: string) => {
      expect(channelId).toBe("UCbooked");
      return [
        {
          videoId: "oldvideo111",
          publishedAt: "2026-06-01T00:00:00Z",
          durationSeconds: 1000,
        },
        {
          videoId: "spotvideo11",
          publishedAt: "2026-11-03T15:00:00Z",
          durationSeconds: null,
        },
      ];
    });
    const client: YoutubeAircheckClient = {
      recentLongForm: recent,
      videoById: vi.fn(),
    };
    const found = await findYoutubeEpisode({
      channelId: "UCbooked",
      episodeUrl: null,
      postDate: "2026-11-03",
      window: WINDOW,
      client,
    });
    expect(found).toMatchObject({
      episodeIdentifier: "spotvideo11",
      audioUrl: null,
      source: "youtube",
    });
    expect(recent).toHaveBeenCalledTimes(1);
    expect(client.videoById).not.toHaveBeenCalled();
    if ("note" in found && found.note) {
      expect(found.note).toContain("does not return an audio file");
    }
  });

  it("loads one named video through videos.list", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      expect(url).toContain("/videos");
      expect(url).not.toContain("/search");
      return new Response(
        JSON.stringify({
          items: [
            {
              id: "abcdefghijk",
              snippet: {
                channelId: "UCbooked",
                title: "Episode",
                publishedAt: "2026-11-02T00:00:00Z",
              },
              contentDetails: { duration: "PT45M" },
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    const video = await new YouTubeClient("test-key").getVideo("abcdefghijk");
    expect(video).toMatchObject({
      videoId: "abcdefghijk",
      channelId: "UCbooked",
      durationSeconds: 45 * 60,
    });
  });

  it("does not call the library pull", () => {
    const src = readFileSync(join(process.cwd(), "lib/airchecks/episode.ts"), "utf8");
    expect(src).not.toMatch(/runYoutubeLibraryPull|searchLibraryPage|youtube_pull_queue/);
  });
});
