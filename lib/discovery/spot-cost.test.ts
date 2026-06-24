import { describe, it, expect } from "vitest";
import type { Show } from "@/lib/data/types";
import { deriveSpotCost, DEFAULT_SPOT_COUNT } from "./spot-cost";
import {
  podscanPodcastToShow,
  youtubeChannelToShow,
} from "./format-discovered-show";

// Minimal Show factory — only the fields deriveSpotCost reads (price_type,
// audience_size, rate_card, min_buy, platform) matter; the rest exist to
// satisfy the type.
function makeShow(overrides: Partial<Show> = {}): Show {
  const now = "2026-06-24T00:00:00.000Z";
  return {
    id: "test-show",
    name: "Test Show",
    platform: "podcast",
    description: "",
    categories: [],
    tags: [],
    contact: { name: "", email: "", method: "email" },
    audience_size: 50000,
    demographics: {},
    audience_interests: [],
    rate_card: { preroll_cpm: 20, midroll_cpm: 28, postroll_cpm: 14 },
    price_type: "cpm",
    ad_formats: ["host_read"],
    episode_cadence: "weekly",
    avg_episode_length_min: 45,
    current_sponsors: [],
    is_claimed: false,
    is_verified: false,
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

describe("deriveSpotCost — podcast CPM path", () => {
  it("prices a mid-roll spot as (downloads/1000) × CPM in integer cents", () => {
    const show = makeShow({
      audience_size: 50000,
      rate_card: { preroll_cpm: 20, midroll_cpm: 28, postroll_cpm: 14 },
    });
    const cost = deriveSpotCost(show); // default placement = midroll
    // (50000 / 1000) × $28 = $1,400 → 140000 cents
    expect(cost.perSpotCents).toBe(140000);
    expect(cost.threeSpotCents).toBe(420000);
    expect(cost.threeSpotCents).toBe(cost.perSpotCents! * DEFAULT_SPOT_COUNT);
    expect(cost.cpmUsedCents).toBe(2800);
    expect(cost.costBasis).toBe("derived");
    expect(cost.isEstimate).toBe(true);
    expect(cost.needsQuote).toBe(false);
  });

  it("prices pre-roll against preroll_cpm (a distinct unit, not mid-roll)", () => {
    const show = makeShow({
      audience_size: 50000,
      rate_card: { preroll_cpm: 20, midroll_cpm: 28, postroll_cpm: 14 },
    });
    const cost = deriveSpotCost(show, undefined, "preroll");
    // (50000 / 1000) × $20 = $1,000 → 100000 cents
    expect(cost.perSpotCents).toBe(100000);
    expect(cost.cpmUsedCents).toBe(2000);
  });

  it("prices post-roll against postroll_cpm (a distinct unit, not mid-roll)", () => {
    const show = makeShow({
      audience_size: 50000,
      rate_card: { preroll_cpm: 20, midroll_cpm: 28, postroll_cpm: 14 },
    });
    const cost = deriveSpotCost(show, undefined, "postroll");
    // (50000 / 1000) × $14 = $700 → 70000 cents
    expect(cost.perSpotCents).toBe(70000);
    expect(cost.cpmUsedCents).toBe(1400);
  });

  it("does NOT cross-fall back: a null CPM for the chosen placement → needsQuote", () => {
    const show = makeShow({
      audience_size: 50000,
      rate_card: { midroll_cpm: 28 }, // no postroll_cpm
    });
    const cost = deriveSpotCost(show, undefined, "postroll");
    expect(cost.needsQuote).toBe(true);
    expect(cost.perSpotCents).toBeNull();
    expect(cost.cpmUsedCents).toBeNull(); // did NOT borrow midroll's $28
  });

  it("returns needsQuote (no crash, no drop, no zero) when downloads are 0", () => {
    const show = makeShow({ audience_size: 0 });
    const cost = deriveSpotCost(show);
    expect(cost.needsQuote).toBe(true);
    expect(cost.perSpotCents).toBeNull();
    expect(cost.threeSpotCents).toBeNull();
    expect(cost.cpmUsedCents).toBeNull();
    expect(cost.costBasis).toBeNull();
    expect(cost.isEstimate).toBe(false);
  });

  it("treats a non-finite audience_size like ≤ 0 → needsQuote (never NaN cents)", () => {
    const show = makeShow({ audience_size: Number.NaN });
    const cost = deriveSpotCost(show);
    expect(cost.needsQuote).toBe(true);
    expect(cost.perSpotCents).toBeNull(); // not NaN
    expect(cost.threeSpotCents).toBeNull();
    expect(Number.isNaN(cost.perSpotCents as number)).toBe(false);
  });
});

describe("deriveSpotCost — YouTube / flat-fee path", () => {
  it("reads rate_card.flat_rate, leaves cpmUsedCents null, basis flat_fee", () => {
    const show = makeShow({
      platform: "youtube",
      price_type: "flat_rate",
      audience_size: 80000,
      rate_card: { flat_rate: 5000 },
    });
    const cost = deriveSpotCost(show);
    expect(cost.perSpotCents).toBe(500000); // $5,000
    expect(cost.threeSpotCents).toBe(1500000);
    expect(cost.cpmUsedCents).toBeNull();
    expect(cost.costBasis).toBe("flat_fee");
    expect(cost.isEstimate).toBe(true);
    expect(cost.needsQuote).toBe(false);
  });

  it("flat fee is view-independent: audience_size 0 with a flat_rate still prices", () => {
    const show = makeShow({
      platform: "youtube",
      price_type: "flat_rate",
      audience_size: 0,
      rate_card: { flat_rate: 2000 },
    });
    const cost = deriveSpotCost(show);
    expect(cost.needsQuote).toBe(false);
    expect(cost.perSpotCents).toBe(200000);
  });

  it("missing flat_rate → needsQuote", () => {
    const show = makeShow({
      platform: "youtube",
      price_type: "flat_rate",
      rate_card: {},
    });
    const cost = deriveSpotCost(show);
    expect(cost.needsQuote).toBe(true);
    expect(cost.perSpotCents).toBeNull();
  });
});

describe("deriveSpotCost — onboarded rate card overrides the estimate", () => {
  it("min_buy present flips a CPM deal to basis rate_card / not-estimate", () => {
    const show = makeShow({
      audience_size: 50000,
      min_buy: 1000,
      rate_card: { midroll_cpm: 30 },
    });
    const cost = deriveSpotCost(show);
    expect(cost.costBasis).toBe("rate_card");
    expect(cost.isEstimate).toBe(false);
    expect(cost.perSpotCents).toBe(150000); // (50000/1000) × $30 = $1,500
  });

  it("min_buy present flips a flat-rate deal to basis rate_card / not-estimate", () => {
    const show = makeShow({
      platform: "podcast",
      price_type: "flat_rate",
      min_buy: 500,
      rate_card: { flat_rate: 1200 },
    });
    const cost = deriveSpotCost(show);
    expect(cost.costBasis).toBe("rate_card");
    expect(cost.isEstimate).toBe(false);
    expect(cost.perSpotCents).toBe(120000);
  });
});

describe("deriveSpotCost — reuses format-discovered-show bands (no duplicate table)", () => {
  function podscanShow(audienceSize: number): Show {
    return podscanPodcastToShow({
      podcast_id: `p-${audienceSize}`,
      podcast_name: "Reuse Cast",
      reach: { audience_size: audienceSize },
    });
  }

  it("the banded mid-roll CPM changes with audience tier", () => {
    const small = deriveSpotCost(podscanShow(5000)); // < 10K → $18 mid-roll
    const large = deriveSpotCost(podscanShow(200000)); // ≥ 200K → $35 mid-roll
    expect(small.cpmUsedCents).toBe(1800);
    expect(large.cpmUsedCents).toBe(3500);
    // (5000/1000) × $18 = $90 → 9000 ; (200000/1000) × $35 = $7,000 → 700000
    expect(small.perSpotCents).toBe(9000);
    expect(large.perSpotCents).toBe(700000);
    expect(large.perSpotCents!).toBeGreaterThan(small.perSpotCents!);
    expect(small.costBasis).toBe("derived"); // bands → derived estimates
  });

  it("reuses the YouTube flat-rate band (built via youtubeChannelToShow)", () => {
    const show = youtubeChannelToShow(
      {
        channelId: "yt-1",
        title: "Reuse Tube",
        description: "",
        publishedAt: "2020-01-01T00:00:00Z",
        subscriberCount: 600000, // ≥ 500K → $10K
        videoCount: 100,
        totalViewCount: 10_000_000,
        topicCategories: [],
      },
      {
        videos: [],
        averageViews: 120000,
        averageLikes: 0,
        averageComments: 0,
        totalVideosAnalyzed: 0,
      }
    );
    const cost = deriveSpotCost(show);
    expect(cost.perSpotCents).toBe(1000000); // $10,000
    expect(cost.costBasis).toBe("flat_fee");
  });
});

describe("deriveSpotCost — cents/dollars correctness", () => {
  it("rounds to integer cents and keeps threeSpot = 3 × perSpot exactly", () => {
    const show = makeShow({
      audience_size: 12345,
      rate_card: { midroll_cpm: 22 },
    });
    const cost = deriveSpotCost(show);
    // (12345/1000) × $22 = $271.59 → 27159 cents
    expect(cost.perSpotCents).toBe(27159);
    expect(cost.threeSpotCents).toBe(27159 * 3);
    expect(Number.isInteger(cost.perSpotCents!)).toBe(true);
    expect(Number.isInteger(cost.threeSpotCents!)).toBe(true);
  });
});

describe("deriveSpotCost — estimate/needsQuote flags per basis", () => {
  it.each([
    [
      "derived",
      makeShow({ audience_size: 50000, rate_card: { midroll_cpm: 22 } }),
      { costBasis: "derived", isEstimate: true, needsQuote: false },
    ],
    [
      "flat_fee",
      makeShow({ price_type: "flat_rate", rate_card: { flat_rate: 2000 } }),
      { costBasis: "flat_fee", isEstimate: true, needsQuote: false },
    ],
    [
      "rate_card",
      makeShow({
        audience_size: 50000,
        min_buy: 1000,
        rate_card: { midroll_cpm: 22 },
      }),
      { costBasis: "rate_card", isEstimate: false, needsQuote: false },
    ],
    [
      "needsQuote",
      makeShow({ audience_size: 0, rate_card: { midroll_cpm: 22 } }),
      { costBasis: null, isEstimate: false, needsQuote: true },
    ],
  ])("%s basis sets the right flags", (_label, show, expected) => {
    const cost = deriveSpotCost(show as Show);
    expect(cost.costBasis).toBe(expected.costBasis);
    expect(cost.isEstimate).toBe(expected.isEstimate);
    expect(cost.needsQuote).toBe(expected.needsQuote);
  });
});
