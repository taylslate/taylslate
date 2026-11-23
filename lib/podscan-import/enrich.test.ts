import { describe, expect, it } from "vitest";
import {
  analysisFetched,
  enrichCallsRemaining,
  enrichShow,
  fetchSponsorHistory,
  listenerFromDetail,
  brandSafetyFromEndpoint,
  qualifiesForEnrich,
  scoringFromPodcastBody,
  sponsorHistoryFrom,
} from "./enrich";

function missing(): Error {
  return Object.assign(new Error("missing"), { status: 404 });
}

describe("enrich", () => {
  it("skips the detail call when search already has listener data", async () => {
    const paths: string[] = [];
    const listener = { total_listeners: 4 };
    const result = await enrichShow("pd_1", listener, async (path) => {
      paths.push(path);
      if (path.endsWith("/demographics")) return { bands: { a: 1 } };
      throw missing();
    });
    expect(paths).toEqual(["/podcasts/pd_1/demographics"]);
    expect(result.demographics).toEqual({ bands: { a: 1 } });
    expect(result.listener).toBe(listener);
  });

  it("treats a 404 as empty and reads listener_engagement from the detail body", async () => {
    const paths: string[] = [];
    const result = await enrichShow("pd_2", null, async (path) => {
      paths.push(path);
      if (path.endsWith("/demographics")) throw missing();
      return { podcast: { listener_engagement: { total_listeners: 9 } } };
    });
    expect(paths).toEqual(["/podcasts/pd_2/demographics", "/podcasts/pd_2"]);
    expect(result.demographics).toBeNull();
    expect(result.listener).toEqual({ total_listeners: 9 });
    expect(listenerFromDetail({ listener_engagement: { total_listeners: 1 } })).toEqual({
      total_listeners: 1,
    });
  });

  it("qualifies a kept show on either gate and skips the rest", () => {
    const both = { minAudience: 5000, minPanelListeners: 10 };
    expect(
      qualifiesForEnrich({ kept: true, audienceSize: 5000, listenerEngagement: { total_listeners: 0 } }, both)
    ).toBe(true);
    expect(
      qualifiesForEnrich({ kept: true, audienceSize: 100, listenerEngagement: { total_listeners: 10 } }, both)
    ).toBe(true);
    expect(
      qualifiesForEnrich({ kept: true, audienceSize: 4999, listenerEngagement: { total_listeners: 9 } }, both)
    ).toBe(false);
    expect(
      qualifiesForEnrich({ kept: false, audienceSize: 9000, listenerEngagement: { total_listeners: 90 } }, both)
    ).toBe(false);
    expect(
      qualifiesForEnrich(
        { kept: true, audienceSize: null, listenerEngagement: { total_listeners: 4 } },
        { minAudience: 5000, minPanelListeners: null }
      )
    ).toBe(false);
    expect(
      qualifiesForEnrich(
        { kept: true, audienceSize: 100, listenerEngagement: null },
        { minAudience: null, minPanelListeners: 10 }
      )
    ).toBe(false);
    expect(
      qualifiesForEnrich({ kept: true, audienceSize: 100, listenerEngagement: null }, { minAudience: null, minPanelListeners: null })
    ).toBe(true);
  });

  it("counts a later analysis call for an older enrich entry", () => {
    const listener = { total_listeners: 4 };
    expect(enrichCallsRemaining(listener, undefined)).toBe(2);
    expect(enrichCallsRemaining(null, undefined)).toBe(3);
    expect(enrichCallsRemaining(listener, { demographics: { ok: true }, listener })).toBe(1);
    const done = { demographics: { ok: true }, listener, sponsorHistory: null };
    expect(analysisFetched(done)).toBe(true);
    expect(enrichCallsRemaining(listener, done)).toBe(0);
    expect(analysisFetched({ demographics: null, listener: null })).toBe(false);
  });

  it("keeps sponsor names and episode counts and treats a 404 as empty", async () => {
    const history = sponsorHistoryFrom({
      episodes_analyzed: 8,
      sponsors: [
        { name: "Acme", episode_count: 3, url: "https://secret.example/acme", product_mentioned: "widget" },
        { name: "  ", episode_count: 1 },
      ],
      guests: [{ name: "Pat", episode_count: 2 }],
    });
    expect(history).toEqual({
      sponsors: [{ name: "Acme", episode_count: 3 }],
      episode_counts: { episodes_analyzed: 8 },
    });
    expect(JSON.stringify(history)).not.toContain("http");
    expect(JSON.stringify(history)).not.toContain("Pat");
    const paths: string[] = [];
    const empty = await fetchSponsorHistory("pd_9", async (path) => {
      paths.push(path);
      throw missing();
    });
    expect(paths).toEqual(["/podcasts/pd_9/analysis"]);
    expect(empty).toBeNull();
  });

  it("reads reach score and brand safety from the podcast object", () => {
    const safety = { max_risk_level: "low", most_common_recommendation: "safe" };
    expect(
      scoringFromPodcastBody({
        podcast_reach_score: 72,
        brand_safety: safety,
        podcast_description: "skip",
        reach: { website: "https://secret.example" },
      })
    ).toEqual({ reachScore: 72, brandSafety: safety });
    expect(
      scoringFromPodcastBody({
        podcast: { podcast_reach_score: 4, brand_safety: safety },
      }).reachScore
    ).toBe(4);
    expect(scoringFromPodcastBody({ listener_engagement: { total_listeners: 1 } })).toEqual({
      reachScore: null,
      brandSafety: null,
    });
    const aggregation = { max_risk_level: "low", most_common_recommendation: "safe", episode_count: 4 };
    expect(
      brandSafetyFromEndpoint({
        aggregation,
        categories: [{ name: "crime", evidence: [{ excerpt: "owner@sponsor.example said it" }] }],
      })
    ).toEqual(aggregation);
    expect(JSON.stringify(brandSafetyFromEndpoint({ aggregation }))).not.toContain("@");
    expect(brandSafetyFromEndpoint(null)).toBeNull();
  });

  it("rethrows a non-404 error", async () => {
    await expect(
      enrichShow("pd_3", null, async () => {
        throw Object.assign(new Error("down"), { status: 500 });
      })
    ).rejects.toMatchObject({ status: 500 });
  });
});
