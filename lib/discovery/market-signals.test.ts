import { describe, expect, it } from "vitest";
import {
  computeMarketSignals,
  parseBrandHistory,
  readMarketSignalContext,
  recordedPricing,
  type MarketSignal,
  type MarketSignalInput,
} from "./market-signals";

function byId(signals: MarketSignal[], id: MarketSignal["id"]): MarketSignal {
  const found = signals.find((signal) => signal.id === id);
  if (!found) throw new Error(`missing ${id}`);
  return found;
}

describe("computeMarketSignals", () => {
  it("returns five unknown lines when nothing is stored", () => {
    const signals = computeMarketSignals();
    expect(signals.map((signal) => signal.id)).toEqual([
      "advertisers",
      "competitor_saturation",
      "ad_load",
      "pricing",
      "renewal",
    ]);
    for (const signal of signals) {
      expect(signal.value).toBe("unknown");
      expect(signal.known).toBe(false);
      expect(signal.why.length).toBeGreaterThan(20);
      expect(signal.why).not.toContain("\n");
    }
  });

  it("lists Podscan names as recorded advertisers, not similar ones", () => {
    const signal = byId(
      computeMarketSignals({
        productCategory: "Electrolytes",
        advertisers: [{ name: "LMNT" }, { name: "lmnt" }, { name: "Eight Sleep" }],
      }),
      "advertisers"
    );
    expect(signal.label).toBe("Recorded advertisers");
    expect(signal.value).toBe("LMNT, Eight Sleep");
    expect(signal.value).not.toMatch(/similar/i);
  });

  it("marks an exact category match as similar and leaves other categories as history", () => {
    const signal = byId(
      computeMarketSignals({
        productCategory: "Health & Wellness",
        advertisers: [
          { name: "LMNT", category: "health and wellness" },
          { name: "Eight Sleep", category: "Sleep" },
          { name: "AG1" },
        ],
      }),
      "advertisers"
    );
    expect(signal.label).toBe("Similar advertisers");
    expect(signal.value).toContain("Similar (Health & Wellness): LMNT");
    expect(signal.value).toContain("Other recorded: Eight Sleep (Sleep), AG1");
  });

  it("does not treat a shorter category as the same category", () => {
    const signal = byId(
      computeMarketSignals({
        productCategory: "Health",
        advertisers: [{ name: "Whoop", category: "Health and Wellness" }],
      }),
      "advertisers"
    );
    expect(signal.label).toBe("Category history");
    expect(signal.value).toBe("Whoop (Health and Wellness)");
  });

  it("does not call anyone similar when the brief has no category", () => {
    const signal = byId(
      computeMarketSignals({
        advertisers: [{ name: "LMNT", category: "Electrolytes" }],
      }),
      "advertisers"
    );
    expect(signal.label).toBe("Category history");
    expect(signal.value).not.toMatch(/similar/i);
  });

  it("caps a long advertiser list and keeps the overflow count", () => {
    const signal = byId(
      computeMarketSignals({
        advertisers: ["A", "B", "C", "D", "E", "F", "G"].map((name) => ({ name })),
      }),
      "advertisers"
    );
    expect(signal.value).toBe("A, B, C, D, E +2");
  });

  it("reports named competitors that appear, and says none when they do not", () => {
    const hit = byId(
      computeMarketSignals({
        exclusions: ["LMNT Daily", "Whoop"],
        advertisers: [{ name: "LMNT" }],
      }),
      "competitor_saturation"
    );
    expect(hit.known).toBe(true);
    expect(hit.value).toBe("1 of 2 named competitors appear: LMNT Daily");

    const miss = byId(
      computeMarketSignals({
        exclusions: ["Whoop"],
        advertisers: [{ name: "LMNT" }],
      }),
      "competitor_saturation"
    );
    expect(miss.value).toBe("None of the named competitors appear in recorded advertisers");
  });

  it("does not match a short name inside a longer one", () => {
    const signal = byId(
      computeMarketSignals({
        exclusions: ["AG1"],
        advertisers: [{ name: "AG1 Daily" }],
      }),
      "competitor_saturation"
    );
    expect(signal.value).toBe("None of the named competitors appear in recorded advertisers");

    const exact = byId(
      computeMarketSignals({
        exclusionText: "AG1, Plunge",
        advertisers: [{ name: "AG1" }],
      }),
      "competitor_saturation"
    );
    expect(exact.value).toContain("AG1");
    expect(exact.value).not.toContain("Plunge appear");
  });

  it("leaves saturation unknown when either side of the comparison is missing", () => {
    const noCompetitors = byId(
      computeMarketSignals({ advertisers: [{ name: "LMNT" }, { name: "AG1" }] }),
      "competitor_saturation"
    );
    const noAdvertisers = byId(
      computeMarketSignals({ exclusions: ["LMNT"] }),
      "competitor_saturation"
    );
    expect(noCompetitors.value).toBe("unknown");
    expect(noAdvertisers.value).toBe("unknown");
  });

  it("does not treat a sponsor-name count as ad load", () => {
    const input: MarketSignalInput = {
      advertisers: Array.from({ length: 10 }, (_, i) => ({ name: `Brand ${i}` })),
    };
    expect(byId(computeMarketSignals(input), "ad_load").value).toBe("unknown");
    expect(byId(computeMarketSignals({ commercialReadsOnLatestEpisode: 4 }), "ad_load").value).toBe(
      "4 commercial reads on the latest sponsored episode"
    );
    expect(byId(computeMarketSignals({ commercialReadsOnLatestEpisode: 0 }), "ad_load").known).toBe(
      true
    );
    expect(byId(computeMarketSignals({ commercialReadsOnLatestEpisode: 1.5 }), "ad_load").value).toBe(
      "unknown"
    );
  });

  it("shows a recorded CPM and the spend at the stored audience", () => {
    const signal = byId(
      computeMarketSignals({ recordedCpms: [28, 22], audienceSize: 40_000 }),
      "pricing"
    );
    expect(signal.value).toBe("$22–$28 CPM · $880–$1,120 per spot at 40,000 downloads");
  });

  it("shows a flat rate beside a CPM without blending them", () => {
    const signal = byId(
      computeMarketSignals({ recordedCpms: [25], recordedFlatDollars: [5000] }),
      "pricing"
    );
    expect(signal.value).toBe("$25 CPM. $5,000 flat");
  });

  it("leaves a banded discovery CPM unknown", () => {
    const facts = recordedPricing({
      isEstimate: true,
      costBasis: "derived",
      cpmUsedCents: 2200,
      audienceSize: 50_000,
      rateCard: { midroll_cpm: 22 },
    });
    expect(facts.cpms).toEqual([]);
    const signal = byId(
      computeMarketSignals({ recordedCpms: facts.cpms, audienceSize: facts.audienceSize }),
      "pricing"
    );
    expect(signal.value).toBe("unknown");
  });

  it("keeps an onboarded rate card, a brand-entered CPM, and a show-stated CPM", () => {
    expect(
      recordedPricing({
        minBuy: 1500,
        placement: "midroll",
        rateCard: { midroll_cpm: 30 },
        priceType: "cpm",
      }).cpms
    ).toEqual([30]);

    expect(
      recordedPricing({
        isEstimate: false,
        costBasis: "derived",
        cpmUsedCents: 2700,
      }).cpms
    ).toEqual([27]);

    expect(recordedPricing({ expectedCpm: 24 }).cpms).toEqual([24]);

    expect(
      recordedPricing({
        isEstimate: true,
        costBasis: "flat_fee",
        perSpotCents: 500_000,
        priceType: "flat_rate",
        rateCard: { flat_rate: 5000 },
      }).flats
    ).toEqual([]);
  });

  it("reports annual history and repeat booked deals, and does not invent a renewal", () => {
    const both = byId(
      computeMarketSignals({
        brandHistoryLoaded: true,
        advertisers: [{ name: "LMNT", dealType: "annual" }],
        bookedDeals: [
          { brandKey: "brand-1", brandName: "Sauna Box" },
          { brandKey: "brand-1", brandName: "Sauna Box" },
        ],
      }),
      "renewal"
    );
    expect(both.value).toBe("Annual on file: LMNT. Repeat deals: Sauna Box (2 deals)");

    const oneDeal = byId(
      computeMarketSignals({
        bookedDeals: [{ brandKey: "brand-1", brandName: "Sauna Box" }],
      }),
      "renewal"
    );
    expect(oneDeal.value).toBe("No repeat Taylslate deal is on file");

    const oneOff = byId(
      computeMarketSignals({
        brandHistoryLoaded: true,
        advertisers: [{ name: "AG1", dealType: "one-off" }],
        bookedDeals: [],
      }),
      "renewal"
    );
    expect(oneOff.value).toBe("No renewal on file. Host-recorded buys are one-off.");

    const unchecked = byId(
      computeMarketSignals({
        advertisers: [{ name: "AG1" }],
      }),
      "renewal"
    );
    expect(unchecked.value).toBe("unknown");
  });

  it("states a one-off host record when deals were not loaded", () => {
    const signal = byId(
      computeMarketSignals({
        brandHistoryLoaded: true,
        advertisers: [{ name: "AG1", dealType: "one-off" }],
        bookedDeals: null,
      }),
      "renewal"
    );
    expect(signal.value).toBe("Host-recorded buys are one-off");
  });
});

describe("parseBrandHistory", () => {
  it("keeps named entries and drops junk", () => {
    expect(
      parseBrandHistory([
        null,
        { category: "Sleep" },
        { brand_name: " LMNT ", category: " Electrolytes ", deal_type: "annual" },
        { brand_name: "AG1", deal_type: "forever" },
      ])
    ).toEqual([
      { brand_name: "LMNT", category: "Electrolytes", deal_type: "annual" },
      { brand_name: "AG1" },
    ]);
  });
});

describe("readMarketSignalContext", () => {
  it("prefers structured exclusions and the confirmed product category", () => {
    const ctx = readMarketSignalContext({
      productCategory: "Saunas",
      exclusionsText: "Plunge, Therabody",
      productAttributes: {
        category: "Wellness",
        interpretation: {
          campaign_pattern: { exclusions_parsed: ["Higher Dose"] },
        },
      },
    });
    expect(ctx.productCategory).toBe("Saunas");
    expect(ctx.exclusions).toEqual(["Higher Dose"]);
    expect(ctx.exclusionText).toBeNull();
  });

  it("falls back to the brief text when no structured exclusions are stored", () => {
    const ctx = readMarketSignalContext({
      productAttributes: { category: "Saunas" },
      exclusionsText: "Plunge, Therabody",
    });
    expect(ctx.productCategory).toBe("Saunas");
    expect(ctx.exclusions).toBeNull();
    expect(ctx.exclusionText).toBe("Plunge, Therabody");
  });
});
