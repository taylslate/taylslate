import { describe, it, expect } from "vitest";
import type { Show } from "@/lib/data/types";
import type { TieredShow } from "./tiered-universe";
import { tieredShowToScoredShowRecord } from "./scored-show-adapter";

function show(over: Partial<Show> = {}): Show {
  return {
    id: "show-1",
    name: "The Recovery Lab",
    description: "Recovery science.",
    image_url: "https://img/recovery.jpg",
    categories: ["Health & Wellness"],
    network: "Wellness Network",
    audience_size: 40_000,
    current_sponsors: ["AG1", "Eight Sleep"],
    rss_url: "https://feed/recovery.xml",
    contact: { name: "Host", email: "host@recovery.fm", method: "email" },
    ...over,
  } as unknown as Show;
}

function tiered(over: Partial<TieredShow> = {}): TieredShow {
  return {
    showId: "show-1",
    show: show(),
    ringHypothesisId: "ring-1",
    band: "medium",
    audienceFit: 50,
    topicalRelevance: 85,
    purchasePower: 70,
    composite: 67,
    reasoning: "Probable fit.",
    tier: "test",
    perSpotCents: 88_000, // 40k/1000 * $22 = $880
    threeSpotCents: 264_000,
    cpmUsedCents: 2_200, // $22.00
    costBasis: "derived",
    isEstimate: true,
    needsQuote: false,
    placement: "midroll",
    budgetDeltaCents: null,
    brandSaved: false,
    brandDismissed: false,
    computedOnRead: false,
    ...over,
  };
}

describe("tieredShowToScoredShowRecord", () => {
  it("maps a derived test show to a valid ScoredShowRecord", () => {
    const rec = tieredShowToScoredShowRecord(tiered());
    expect(rec).not.toBeNull();
    expect(rec!.podcastId).toBe("show-1"); // showId becomes podcastId
    expect(rec!.name).toBe("The Recovery Lab");
    expect(rec!.audienceSize).toBe(40_000);
    expect(rec!.compositeScore).toBe(67);
    expect(rec!.publisherName).toBe("Wellness Network");
    expect(rec!.contactEmail).toBe("host@recovery.fm");
    expect(rec!.sponsorCount).toBe(2);
    expect(rec!.source).toBe("discover");
  });

  it("recovers estimatedCpm from cpmUsedCents (cents→dollars)", () => {
    const rec = tieredShowToScoredShowRecord(tiered({ cpmUsedCents: 2_800 }));
    expect(rec!.estimatedCpm).toBe(28); // $28.00
  });

  it("back-computes an effective CPM for a flat-fee show with no CPM", () => {
    // perSpot $4,000, audience 40k → effective CPM = 4000 / (40000/1000) = 100
    const rec = tieredShowToScoredShowRecord(
      tiered({
        cpmUsedCents: null,
        perSpotCents: 400_000,
        costBasis: "flat_fee",
        show: show({ audience_size: 40_000 }),
      })
    );
    expect(rec!.estimatedCpm).toBeCloseTo(100, 5);
  });

  it("returns 0 CPM when neither a CPM nor a usable per-spot/audience exists", () => {
    const rec = tieredShowToScoredShowRecord(
      tiered({ cpmUsedCents: null, perSpotCents: null })
    );
    expect(rec!.estimatedCpm).toBe(0);
  });

  it("returns null when the embedded Show is missing", () => {
    expect(tieredShowToScoredShowRecord(tiered({ show: null }))).toBeNull();
  });
});
