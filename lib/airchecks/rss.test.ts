import { describe, expect, it } from "vitest";
import { findRssEpisode, MAX_ITEM_CHARS, MAX_RSS_ITEMS, parseRssItems } from "./rss";

describe("parseRssItems", () => {
  it("reads one item with an index scan", () => {
    const xml = `<?xml version="1.0"?><rss><channel>
      <item>
        <link>https://example.com/spot</link>
        <enclosure url="https://cdn.example.com/spot.mp3"/>
        <itunes:duration>45:00</itunes:duration>
        <pubDate>Tue, 03 Nov 2026 12:00:00 GMT</pubDate>
      </item>
    </channel></rss>`;
    expect(parseRssItems(xml)).toEqual([
      {
        link: "https://example.com/spot",
        guid: null,
        enclosureUrl: "https://cdn.example.com/spot.mp3",
        pubDate: "Tue, 03 Nov 2026 12:00:00 GMT",
        durationSeconds: 45 * 60,
      },
    ]);
  });

  it("caps the item count and skips an oversized item", () => {
    const items = Array.from({ length: MAX_RSS_ITEMS + 5 }, (_, index) => {
      return `<item><link>https://example.com/${index}</link><enclosure url="https://cdn.example.com/${index}.mp3"/></item>`;
    }).join("");
    const huge = `<item><link>${"a".repeat(MAX_ITEM_CHARS + 1)}</link></item>`;
    const parsed = parseRssItems(`<rss><channel>${huge}${items}</channel></rss>`);
    expect(parsed).toHaveLength(MAX_RSS_ITEMS);
    expect(parsed[0]?.link).toBe("https://example.com/0");
    expect(parsed.some((item) => (item.link ?? "").startsWith("aaa"))).toBe(false);
  });

  it("reaches an in-window episode past the first page", () => {
    const oldItems = Array.from({ length: MAX_RSS_ITEMS + 20 }, (_, index) => {
      return `<item><link>https://example.com/old-${index}</link><enclosure url="https://cdn.example.com/old-${index}.mp3"/><pubDate>2020-01-01</pubDate></item>`;
    }).join("");
    const spot = `<item><guid>https://example.com/episodes/spot</guid><enclosure url="https://cdn.example.com/spot.mp3"/><pubDate>2026-11-03</pubDate></item>`;
    const xml = `<rss><channel>${oldItems}${spot}</channel></rss>`;
    expect(parseRssItems(xml).some((item) => item.enclosureUrl?.includes("spot.mp3"))).toBe(false);
    expect(
      findRssEpisode(xml, {
        episodeUrl: "https://example.com/episodes/spot",
        postDate: "2026-11-03",
        window: { start: "2026-11-01", end: "2026-11-07" },
      })?.enclosureUrl
    ).toBe("https://cdn.example.com/spot.mp3");
  });

  it("returns nothing for a document over the size cap", () => {
    expect(parseRssItems(`<item><link>x</link></item>${" ".repeat(5_000_000)}`)).toEqual([]);
  });
});
