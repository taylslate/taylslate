import { describe, expect, it } from "vitest";
import { buildDueSpots } from "./select";

const TODAY = "2026-11-03";

function deal(overrides: Record<string, unknown> = {}) {
  return {
    id: "deal-1",
    status: "show_signed",
    cancelled_at: null,
    show_id: "show-1",
    promo_code: "HUBERMAN",
    brand_profile_id: "brand-1",
    outreach_id: "out-1",
    ...overrides,
  };
}

function line(overrides: Record<string, unknown> = {}) {
  return {
    id: "line-1",
    io_id: "io-1",
    format: "podcast",
    post_date: "2026-11-03",
    episode_url: null,
    placement: "mid-roll",
    ...overrides,
  };
}

describe("buildDueSpots", () => {
  const base = {
    today: TODAY,
    deals: [deal()],
    ios: [{ id: "io-1", deal_id: "deal-1", advertiser_name: "Sauna Box", status: "signed" }],
    lines: [line()],
    shows: [{ id: "show-1", rss_url: "https://feeds.example.com/show.xml", youtube_channel_id: null }],
    brands: [{ id: "brand-1", brand_name: "Sauna Box", brand_website: "https://saunabox.com" }],
    pitches: [
      {
        id: "out-1",
        pitch_body: "Hello\n- The infrared cabin heats in ten minutes\nThanks",
      },
    ],
    airchecks: [],
    libraryChannels: [],
  };

  it("keeps a booked spot in its air window and reads talking points from the pitch", () => {
    const spots = buildDueSpots(base);
    expect(spots).toHaveLength(1);
    expect(spots[0]).toMatchObject({
      ioLineItemId: "line-1",
      format: "podcast",
      rssUrl: "https://feeds.example.com/show.xml",
      postDate: "2026-11-03",
    });
    expect(spots[0].buy.talkingPoints).toBe("The infrared cabin heats in ten minutes");
    expect(spots[0].buy.promoCode).toBe("HUBERMAN");
  });

  it("drops planning, cancelled, future, closed, and already reviewed spots", () => {
    const spots = buildDueSpots({
      ...base,
      deals: [
        deal({ id: "deal-plan", status: "planning" }),
        deal({ id: "deal-cancel", cancelled_at: "2026-11-01T00:00:00Z" }),
        deal({ id: "deal-1" }),
      ],
      ios: [
        { id: "io-plan", deal_id: "deal-plan", advertiser_name: "Sauna Box", status: "draft" },
        { id: "io-cancel", deal_id: "deal-cancel", advertiser_name: "Sauna Box", status: "signed" },
        { id: "io-1", deal_id: "deal-1", advertiser_name: "Sauna Box", status: "signed" },
      ],
      lines: [
        line({ id: "line-plan", io_id: "io-plan" }),
        line({ id: "line-cancel", io_id: "io-cancel" }),
        line({ id: "line-future", post_date: "2026-12-01" }),
        line({ id: "line-old", post_date: "2026-09-01" }),
        line({ id: "line-ready" }),
        line(),
      ],
      airchecks: [
        {
          io_line_item_id: "line-ready",
          status: "transcribed",
          transcript_text: "already done",
          ready_for_review: true,
          match_result: "matched",
        },
      ],
    });
    expect(spots.map((spot) => spot.ioLineItemId)).toEqual(["line-1"]);
  });

  it("keeps recent failures from filling the spot cap", () => {
    const fails = Array.from({ length: 25 }, (_, index) =>
      line({ id: `fail-${index}`, post_date: "2026-11-01" })
    );
    const fresh = Array.from({ length: 3 }, (_, index) =>
      line({ id: `new-${index}`, post_date: "2026-11-03" })
    );
    const spots = buildDueSpots({
      ...base,
      nowMs: Date.parse("2026-11-03T18:00:00.000Z"),
      lines: [...fails, ...fresh, line({ id: "give-up", post_date: "2026-11-02" })],
      airchecks: [
        ...fails.map((row) => ({
          io_line_item_id: row.id as string,
          status: "failed",
          transcript_text: null,
          ready_for_review: false,
          match_result: null,
          error: "attempt=2; no enclosure",
          updated_at: "2026-11-03T12:00:00.000Z",
        })),
        {
          io_line_item_id: "give-up",
          status: "failed",
          transcript_text: null,
          ready_for_review: false,
          match_result: null,
          error: "attempt=5; no enclosure",
          updated_at: "2020-01-01T00:00:00.000Z",
        },
      ],
    });
    expect(spots.map((spot) => spot.ioLineItemId)).toEqual(["new-0", "new-1", "new-2"]);
  });

  it("skips a line a person already confirmed or rejected", () => {
    const spots = buildDueSpots({
      ...base,
      lines: [line({ id: "line-confirmed" }), line()],
      airchecks: [
        {
          io_line_item_id: "line-confirmed",
          status: "failed",
          transcript_text: null,
          ready_for_review: false,
          match_result: null,
          review_decision: "confirmed",
        },
      ],
    });
    expect(spots.map((spot) => spot.ioLineItemId)).toEqual(["line-1"]);
  });

  it("uses the library channel for a youtube spot and ignores a show with no line", () => {
    const spots = buildDueSpots({
      ...base,
      lines: [line({ format: "youtube" })],
      shows: [
        { id: "show-1", rss_url: null, youtube_channel_id: null },
        { id: "show-catalog", rss_url: "https://feeds.example.com/catalog.xml", youtube_channel_id: "UCcatalog" },
      ],
      libraryChannels: [{ show_id: "show-1", channel_id: "UCbooked" }],
    });
    expect(spots).toHaveLength(1);
    expect(spots[0].youtubeChannelId).toBe("UCbooked");
    expect(spots[0].format).toBe("youtube");
    expect(spots.map((spot) => spot.showId)).not.toContain("show-catalog");
  });

  it("keeps the lowest library channel id, in either input order", () => {
    const highFirst = [
      { show_id: "show-1", channel_id: "UCzzzzzzzzzzzzzzzzzzz" },
      { show_id: "show-1", channel_id: "UCaaaaaaaaaaaaaaaaaaaa" },
    ];
    const spot = (channels: { show_id: string; channel_id: string }[]) =>
      buildDueSpots({
        ...base,
        lines: [line({ format: "youtube" })],
        shows: [{ id: "show-1", rss_url: null, youtube_channel_id: null }],
        libraryChannels: channels,
      });
    expect(spot(highFirst)[0].youtubeChannelId).toBe("UCaaaaaaaaaaaaaaaaaaaa");
    expect(spot([...highFirst].reverse())[0].youtubeChannelId).toBe(
      "UCaaaaaaaaaaaaaaaaaaaa"
    );
  });

  it("orders mixed-case channel ids the way migration 089 does", () => {
    const upperFirst = [
      { show_id: "show-1", channel_id: "UCB000000000000000000" },
      { show_id: "show-1", channel_id: "UCa000000000000000000" },
    ];
    const spot = (channels: { show_id: string; channel_id: string }[]) =>
      buildDueSpots({
        ...base,
        lines: [line({ format: "youtube" })],
        shows: [{ id: "show-1", rss_url: null, youtube_channel_id: null }],
        libraryChannels: channels,
      });
    expect(spot(upperFirst)[0].youtubeChannelId).toBe("UCa000000000000000000");
    expect(spot([...upperFirst].reverse())[0].youtubeChannelId).toBe(
      "UCa000000000000000000"
    );
  });
});
