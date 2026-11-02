import { describe, expect, it, vi } from "vitest";
import { runYoutubeEmailBackfill } from "./emails-backfill";
import { createMemoryYoutubeStore, draftToRecord } from "./store";
import type { YouTubeChannelDetails } from "@/lib/enrichment/youtube";

function details(description: string): YouTubeChannelDetails {
  return {
    channelId: "UCaaaaaaaaaaaaaaaaaaaaaa",
    title: "Fit",
    description,
    publishedAt: "2020-01-01T00:00:00.000Z",
    subscriberCount: 1000,
    videoCount: 20,
    totalViewCount: 200_000,
    topicCategories: [],
    keywords: [],
    country: "US",
    defaultLanguage: "en",
  };
}

const NOW = new Date("2026-11-02T18:00:00.000Z");

describe("email backfill", () => {
  it("stores description emails with source and found_at and does not call YouTube", async () => {
    const store = createMemoryYoutubeStore();
    await store.saveChannel(
      draftToRecord(
        null,
        {
          details: details("Business: ads@show.com. Book mailto:booking@show.com"),
          passedMarketFilter: true,
          brandFlag: null,
          source: "category",
          sourceQuery: "fitness",
          now: NOW.toISOString(),
        },
        null
      )
    );
    const recentVideoDescriptions = vi.fn();
    const lines: string[] = [];
    const report = await runYoutubeEmailBackfill({
      store,
      now: NOW,
      api: { recentVideoDescriptions },
      log: (line) => lines.push(line),
      clock: () => NOW.getTime(),
    });
    expect(report.descriptionsScanned).toBe(1);
    expect(report.emailsStored).toBe(2);
    expect(store.emails).toEqual([
      {
        channel_id: "UCaaaaaaaaaaaaaaaaaaaaaa",
        email: "booking@show.com",
        source: "about_link",
        found_at: NOW.toISOString(),
      },
      {
        channel_id: "UCaaaaaaaaaaaaaaaaaaaaaa",
        email: "ads@show.com",
        source: "channel_description",
        found_at: NOW.toISOString(),
      },
    ]);
    expect(lines.join("\n")).not.toContain("ads@show.com");
    expect(lines.join("\n")).not.toContain("booking@show.com");
    expect(lines.join("\n")).toContain("quota day=2026-11-02");
  });

  it("reads recent video descriptions inside the cap and resumes the next day", async () => {
    const store = createMemoryYoutubeStore();
    await store.saveChannel(
      draftToRecord(
        null,
        {
          details: details("No address here"),
          passedMarketFilter: true,
          brandFlag: null,
          source: "seed",
          sourceQuery: null,
          now: NOW.toISOString(),
        },
        null
      )
    );
    await store.markDescriptionEmailsChecked("UCaaaaaaaaaaaaaaaaaaaaaa", NOW.toISOString());
    await store.quotaLedger().commit("2026-11-02", 7999, "pull", 8000);
    const blocked = vi.fn(async () => ({ descriptions: ["deals@creator.com"], units: 2 }));
    const stopped = await runYoutubeEmailBackfill({
      store,
      now: NOW,
      api: { recentVideoDescriptions: blocked },
      log: () => {},
      clock: () => NOW.getTime(),
    });
    expect(stopped.stopped).toBe("cap");
    expect(stopped.videosScanned).toBe(0);
    expect(blocked).not.toHaveBeenCalled();
    expect(store.emails).toEqual([]);

    const next = new Date("2026-11-03T18:00:00.000Z");
    const called = vi.fn(async () => ({
      descriptions: ["Sponsor line deals@creator.com"],
      units: 2,
    }));
    const resumed = await runYoutubeEmailBackfill({
      store,
      now: next,
      api: { recentVideoDescriptions: called },
      log: () => {},
      clock: () => next.getTime(),
    });
    expect(resumed.stopped).toBeNull();
    expect(resumed.videosScanned).toBe(1);
    expect(resumed.units).toBe(2);
    expect(called).toHaveBeenCalledWith("UCaaaaaaaaaaaaaaaaaaaaaa");
    expect(store.emails).toEqual([
      {
        channel_id: "UCaaaaaaaaaaaaaaaaaaaaaa",
        email: "deals@creator.com",
        source: "video_description",
        found_at: next.toISOString(),
      },
    ]);

    const again = await runYoutubeEmailBackfill({
      store,
      now: next,
      api: { recentVideoDescriptions: called },
      log: () => {},
      clock: () => next.getTime(),
    });
    expect(again.videosScanned).toBe(0);
    expect(called).toHaveBeenCalledTimes(1);
    expect(store.emails).toHaveLength(1);
  });
});
