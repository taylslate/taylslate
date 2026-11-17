import { describe, expect, it } from "vitest";
import type { PodscanPodcast, PodscanSearchResponse } from "@/lib/podscan/types";
import {
  SEARCH_QUERY,
  categoryIdsFrom,
  collectCandidates,
  toCandidate,
} from "./candidates";

function podcast(id: string, extra: Partial<PodscanPodcast> = {}): PodscanPodcast {
  return {
    podcast_id: id,
    podcast_name: id,
    podcast_categories: ["News"],
    ...extra,
  };
}

function page(rows: PodscanPodcast[], total = rows.length): PodscanSearchResponse {
  return {
    podcasts: rows,
    pagination: {
      total,
      per_page: 50,
      current_page: 1,
      last_page: 1,
      from: rows.length ? 1 : null,
      to: rows.length ? rows.length : null,
    },
  };
}

describe("candidates", () => {
  it("sends the alphabet query, drops duplicates, and ignores reach.feed_email", async () => {
    const queries: string[] = [];
    const state = await collectCandidates({
      language: "en",
      region: null,
      since: "2025-11-17",
      sample: null,
      search: async (params) => {
        queries.push(String(params.query));
        const sponsored = params.has_sponsors === true;
        if (!sponsored) return page([]);
        return page([
          podcast("pd_1", { is_duplicate: true }),
          podcast("pd_2", {
            podcast_itunes_id: "99",
            listener_engagement: { total_listeners: 3 } as PodscanPodcast["listener_engagement"],
            reach: {
              audience_size: 1500,
              email: "keep@sponsor.example",
              website: null,
              social_links: [],
              itunes: [],
              spotify: [],
              ...({ feed_email: "hidden@sponsor.example" } as object),
            },
          }),
        ]);
      },
      categories: async () => {
        throw new Error("categories");
      },
    });
    expect(queries.every((query) => query === SEARCH_QUERY)).toBe(true);
    expect(state.rows.map((row) => row.podcastId)).toEqual(["pd_2"]);
    expect(state.rows[0]?.podscanEmail).toBe("keep@sponsor.example");
    expect(JSON.stringify(state.rows)).not.toContain("hidden@sponsor.example");
    expect(state.rows[0]?.listenerEngagement).toEqual({ total_listeners: 3 });
    const bad = toCandidate(podcast("../etc"), "sponsored");
    expect(bad).toBeNull();
  });

  it("does not walk categories during a sample", async () => {
    let categories = 0;
    const state = await collectCandidates({
      language: "en",
      region: "us",
      since: "2025-11-17",
      sample: 2,
      search: async (params) => {
        expect(params.per_page).toBe(50);
        expect(params.language).toBe("en");
        expect(params.region).toBe("us");
        const pass = params.has_sponsors === true ? "s" : "u";
        return page(
          [podcast(`${pass}1`), podcast(`${pass}2`), podcast(`${pass}3`)],
          10000
        );
      },
      categories: async () => {
        categories += 1;
        return ["news"];
      },
    });
    expect(categories).toBe(0);
    expect(state.passCounts).toEqual({ sponsored: 2, unsponsored: 2 });
    expect(state.cappedSlices.every((slice) => slice.sampled)).toBe(true);
    expect(state.complete).toBe(true);
  });

  it("splits by audience, then category, and logs a capped leaf", async () => {
    const seen: string[] = [];
    let categoryCalls = 0;
    const state = await collectCandidates({
      language: "en",
      region: null,
      since: "2025-11-17",
      sample: null,
      search: async (params) => {
        seen.push(
          [
            params.has_sponsors ? "s" : "u",
            String(params.min_audience_size ?? "-"),
            String(params.max_audience_size ?? "-"),
            String(params.category_ids ?? "-"),
          ].join(":")
        );
        const rootSponsored = params.has_sponsors === true && params.min_audience_size == null;
        const cappedBand =
          params.has_sponsors === true &&
          params.min_audience_size === 0 &&
          params.max_audience_size === 999;
        if (rootSponsored || cappedBand) {
          return page([], 10000);
        }
        const id = `pd_${params.has_sponsors ? "s" : "u"}_${params.min_audience_size ?? "x"}_${params.category_ids ?? "none"}`;
        return page([podcast(id, { reach: { audience_size: 2000, email: null, website: null, social_links: [], itunes: [], spotify: [] } })]);
      },
      categories: async () => {
        categoryCalls += 1;
        return categoryIdsFrom([{ category_id: "news" }, { category_id: "news" }]);
      },
    });
    expect(categoryCalls).toBe(1);
    expect(state.cappedSlices).toEqual([
      expect.objectContaining({
        pass: "sponsored",
        minAudience: 0,
        maxAudience: 999,
        categoryId: "news",
        total: 10000,
        sampled: false,
      }),
    ]);
    expect(state.rows.some((row) => row.podcastId === "ignored")).toBe(false);
    expect(state.complete).toBe(true);
    expect(seen.some((line) => line.startsWith("u:1000"))).toBe(true);
  });
});
