import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/admin", () => ({ supabaseAdmin: { from: vi.fn() } }));

import {
  loadMarketSignalsForShows,
  type MarketSignalDeps,
  type MarketSignalShowRef,
} from "./load-market-signals";
import type { MarketSignal } from "./market-signals";

const SHOW = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";

function ref(over: Partial<MarketSignalShowRef> = {}): MarketSignalShowRef {
  return {
    showId: SHOW,
    podscanId: "pd_lab",
    currentSponsors: [],
    pastSponsors: [],
    audienceSize: 40_000,
    isEstimate: true,
    costBasis: "derived",
    cpmUsedCents: 2200,
    rateCard: { midroll_cpm: 22 },
    ...over,
  };
}

function deps(over: Partial<MarketSignalDeps> = {}): MarketSignalDeps {
  return {
    lookupProfileTies: async () => [],
    showProfilesByIds: async () => [],
    dealsForShowIds: async () => [],
    showSponsorsForShowIds: async () => [],
    brandNamesByProfileIds: async () => new Map(),
    ...over,
  };
}

function value(signals: MarketSignal[], id: MarketSignal["id"]): string {
  return signals.find((signal) => signal.id === id)?.value ?? "";
}

describe("loadMarketSignalsForShows", () => {
  it("keeps every show and does not turn a banded CPM into a price", async () => {
    const result = await loadMarketSignalsForShows(
      [ref(), ref({ showId: OTHER, podscanId: "pd_other", currentSponsors: ["LMNT"] })],
      { productCategory: "Saunas", exclusions: ["Plunge"], exclusionText: null },
      deps()
    );
    expect(Object.keys(result).sort()).toEqual([OTHER, SHOW].sort());
    expect(result[SHOW]).toHaveLength(5);
    expect(value(result[SHOW], "pricing")).toBe("unknown");
    expect(value(result[SHOW], "ad_load")).toBe("unknown");
    expect(value(result[OTHER], "advertisers")).toBe("LMNT");
    expect(value(result[OTHER], "competitor_saturation")).toBe(
      "None of the named competitors appear in recorded advertisers"
    );
  });

  it("does not attach brand history from a podscan id match", async () => {
    const fetchProfiles = vi.fn(async () => [
      {
        id: "profile-1",
        brandHistory: [{ brand_name: "LMNT", category: "Electrolytes", deal_type: "annual" }],
        expectedCpm: 26,
      },
    ]);
    const result = await loadMarketSignalsForShows(
      [ref(), ref({ showId: OTHER, podscanId: "pd_unrelated" })],
      { productCategory: "Electrolytes", exclusions: null, exclusionText: "LMNT" },
      deps({
        lookupProfileTies: async (identities) => {
          expect(identities.map((row) => row.showId)).toEqual([SHOW, OTHER]);
          expect(identities.every((row) => row.podscanId == null)).toBe(true);
          return [];
        },
        showProfilesByIds: fetchProfiles,
      })
    );

    expect(fetchProfiles).not.toHaveBeenCalled();
    expect(value(result[SHOW], "advertisers")).toBe("unknown");
    expect(value(result[SHOW], "pricing")).toBe("unknown");
    expect(value(result[SHOW], "renewal")).not.toContain("Annual");
    expect(value(result[OTHER], "advertisers")).toBe("unknown");
    expect(value(result[OTHER], "renewal")).toBe("No repeat Taylslate deal is on file");
  });

  it("reads history through a deal's show profile when podscan ids differ", async () => {
    const result = await loadMarketSignalsForShows(
      [ref({ podscanId: null })],
      { productCategory: null, exclusions: null, exclusionText: null },
      deps({
        lookupProfileTies: async () => [{ showId: SHOW, profileId: "profile-9" }],
        dealsForShowIds: async () => [
          {
            showId: SHOW,
            showProfileId: "profile-9",
            brandId: "brand-user",
            brandProfileId: null,
            status: "planning",
            priceType: "cpm",
            cpmRate: 18,
            agreedCpm: null,
            netPerEpisode: 0,
            grossPerEpisode: null,
          },
        ],
        showProfilesByIds: async (ids) => {
          expect(ids).toEqual(["profile-9"]);
          return [
            {
              id: "profile-9",
              brandHistory: [{ brand_name: "Whoop", category: "Wearables", deal_type: "one-off" }],
              expectedCpm: null,
            },
          ];
        },
      })
    );

    expect(value(result[SHOW], "advertisers")).toBe("Whoop (Wearables)");
    expect(value(result[SHOW], "pricing")).toContain("$18 CPM");
    expect(value(result[SHOW], "renewal")).toBe("No renewal on file. Host-recorded buys are one-off.");
  });

  it("counts repeat signed deals, ignores a cancelled rate, and adds sponsor-table names", async () => {
    const result = await loadMarketSignalsForShows(
      [ref({ currentSponsors: ["Eight Sleep"] })],
      { productCategory: null, exclusions: ["Eight Sleep"], exclusionText: null },
      deps({
        showSponsorsForShowIds: async () => [{ showId: SHOW, brandName: "Momentous" }],
        brandNamesByProfileIds: async () => new Map([["bp-1", "Sauna Box"]]),
        dealsForShowIds: async () => [
          {
            showId: SHOW,
            showProfileId: null,
            brandId: "user-a",
            brandProfileId: "bp-1",
            status: "completed",
            priceType: "cpm",
            cpmRate: 20,
            agreedCpm: 32,
            netPerEpisode: 0,
            grossPerEpisode: null,
          },
          {
            showId: SHOW,
            showProfileId: null,
            brandId: "user-a",
            brandProfileId: "bp-1",
            status: "show_signed",
            priceType: "cpm",
            cpmRate: 32,
            agreedCpm: 32,
            netPerEpisode: 0,
            grossPerEpisode: null,
          },
          {
            showId: SHOW,
            showProfileId: null,
            brandId: "user-b",
            brandProfileId: null,
            status: "cancelled",
            priceType: "cpm",
            cpmRate: 99,
            agreedCpm: 99,
            netPerEpisode: 0,
            grossPerEpisode: null,
          },
          {
            showId: SHOW,
            showProfileId: null,
            brandId: "user-c",
            brandProfileId: null,
            status: "planning",
            priceType: "cpm",
            cpmRate: 15,
            agreedCpm: null,
            netPerEpisode: 0,
            grossPerEpisode: null,
          },
        ],
      })
    );

    expect(value(result[SHOW], "advertisers")).toBe("Eight Sleep, Momentous");
    expect(value(result[SHOW], "competitor_saturation")).toContain("Eight Sleep");
    expect(value(result[SHOW], "renewal")).toBe("Repeat deals: Sauna Box (2 deals)");
    expect(value(result[SHOW], "pricing")).toContain("$15–$32 CPM");
    expect(value(result[SHOW], "pricing")).not.toContain("$99");
  });

  it("leaves renewal unknown when the deal read fails, and still shows stored sponsors", async () => {
    const result = await loadMarketSignalsForShows(
      [ref({ currentSponsors: ["LMNT"] })],
      { productCategory: null, exclusions: null, exclusionText: null },
      deps({
        lookupProfileTies: async () => null,
        dealsForShowIds: async () => null,
      })
    );
    expect(value(result[SHOW], "advertisers")).toBe("LMNT");
    expect(value(result[SHOW], "renewal")).toBe("unknown");
  });

  it("does not drop a show when a dependency throws", async () => {
    const result = await loadMarketSignalsForShows(
      [ref(), ref({ showId: OTHER })],
      { productCategory: null, exclusions: null, exclusionText: null },
      deps({
        lookupProfileTies: async () => {
          throw new Error("down");
        },
      })
    );
    expect(Object.keys(result)).toHaveLength(2);
    expect(result[SHOW]).toHaveLength(5);
    expect(value(result[SHOW], "pricing")).toBe("unknown");
  });
});
