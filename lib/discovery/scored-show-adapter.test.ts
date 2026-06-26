import { describe, it, expect } from "vitest";
import type { Show } from "@/lib/data/types";
import type { TieredShow } from "./tiered-universe";
import { tieredShowToScoredShowRecord } from "./scored-show-adapter";
import { spotPrice } from "@/lib/utils/pricing";

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

  it("maps the discovery placement to the Wave 7 vocabulary (Layer 5 handoff)", () => {
    expect(tieredShowToScoredShowRecord(tiered({ placement: "postroll" }))!.placement).toBe("post-roll");
    expect(tieredShowToScoredShowRecord(tiered({ placement: "preroll" }))!.placement).toBe("pre-roll");
    expect(tieredShowToScoredShowRecord(tiered({ placement: "midroll" }))!.placement).toBe("mid-roll");
  });

  it("hands the builder a BASE CPM so it reproduces the discovery per-spot price (no double placement adjustment)", () => {
    // Discovery priced post-roll at $14 CPM on 50k downloads → $700/spot.
    const audience = 50_000;
    const discoveryPerSpotDollars = 700;
    for (const [placement, w7, cpmCents] of [
      ["postroll", "post-roll", 1400], // $14 post-roll
      ["preroll", "pre-roll", 1400],
      ["midroll", "mid-roll", 1400],
    ] as const) {
      const rec = tieredShowToScoredShowRecord(
        tiered({
          placement,
          cpmUsedCents: cpmCents,
          perSpotCents: 70_000,
          show: show({ audience_size: audience }),
        })
      )!;
      // The builder applies the placement multiplier to estimatedCpm — that
      // round-trip must equal the discovery price, not double-adjust it.
      const builderPerSpot = spotPrice(audience, rec.estimatedCpm, rec.placement!);
      expect(builderPerSpot).toBeCloseTo(discoveryPerSpotDollars, 5);
    }
  });
});
