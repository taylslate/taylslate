import { describe, expect, it } from "vitest";
import {
  NOT_ENOUGH_DATA,
  buildLearningReview,
  type LearningDeal,
  type LearningOverrideInput,
  type LearningReviewInput,
  type LearningRing,
  type LearningScaleCandidate,
} from "./review";

function deal(over: Partial<LearningDeal> = {}): LearningDeal {
  return {
    dealId: "d1",
    showId: "show-1",
    showName: "Recovery Lab",
    status: "completed",
    promoCode: "SAUNA25",
    trackingLink: "https://example.com/?utm_source=podcast&utm_campaign=recovery-lab-d1",
    ringId: "ring-a",
    ringLabel: "Recovery",
    composite: 70,
    readerTypes: ["host_read"],
    placements: ["mid-roll"],
    aired: true,
    codeOnAir: "found",
    aircheckDecision: "confirmed",
    reportedConversions: null,
    ...over,
  };
}

function ring(over: Partial<LearningRing> = {}): LearningRing {
  return { id: "ring-a", label: "Recovery", kept: true, ...over };
}

function scale(over: Partial<LearningScaleCandidate> = {}): LearningScaleCandidate {
  return {
    showId: "scale-1",
    showName: "Scale Show",
    ringId: "ring-a",
    ringLabel: "Recovery",
    composite: 40,
    ...over,
  };
}

function input(over: Partial<LearningReviewInput> = {}): LearningReviewInput {
  return {
    campaignStatus: "active",
    deals: [],
    rings: [ring()],
    scaleShows: [],
    overrides: [],
    showNames: { "show-1": "Recovery Lab" },
    ...over,
  };
}

describe("buildLearningReview", () => {
  it("stays closed until a flight completes", () => {
    const review = buildLearningReview(
      input({ deals: [deal({ status: "planning", aired: false })] })
    );
    expect(review.ready).toBe(false);
    expect(review.deals).toEqual([]);
  });

  it("says not enough data when a completed campaign has no counts", () => {
    const review = buildLearningReview(
      input({
        campaignStatus: "completed",
        deals: [deal()],
      })
    );
    expect(review.ready).toBe(true);
    expect(review.bestRing.missing).toBe(NOT_ENOUGH_DATA);
    expect(review.renew.missing).toBe(NOT_ENOUGH_DATA);
    expect(review.styles.missing).toBe(NOT_ENOUGH_DATA);
    expect(review.wrongAssumptions.missing).toBe(NOT_ENOUGH_DATA);
    expect(review.weight.missing).toBe(NOT_ENOUGH_DATA);
    expect(review.deals[0].promoCode).toBe("SAUNA25");
    expect(review.deals[0].reportedConversions).toBeNull();
  });

  it("treats an explicit zero as a result, not a missing count", () => {
    const review = buildLearningReview(
      input({
        deals: [deal({ reportedConversions: 0 })],
      })
    );
    expect(review.bestRing.measuredEmpty).toMatch(/converted 0 times/);
    expect(review.bestRing.missing).toBeNull();
    expect(review.renew.measuredEmpty).toBe("No show has reported conversions.");
    expect(review.wrongAssumptions.items).toEqual([
      expect.objectContaining({ ringId: "ring-a", reportedConversions: 0 }),
    ]);
    expect(review.weight.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ direction: "avoid", label: "Recovery" }),
        expect.objectContaining({ direction: "avoid", label: "Host-read" }),
      ])
    );
  });

  it("names the ring with the higher reported count", () => {
    const review = buildLearningReview(
      input({
        rings: [ring(), ring({ id: "ring-b", label: "Commute", kept: true })],
        deals: [
          deal({ reportedConversions: 2, showId: "show-1" }),
          deal({
            dealId: "d2",
            showId: "show-2",
            showName: "Commute Hour",
            ringId: "ring-b",
            ringLabel: "Commute",
            reportedConversions: 9,
          }),
        ],
      })
    );
    expect(review.bestRing.items.map((item) => item.label)).toEqual(["Commute"]);
    expect(review.bestRing.items[0].reportedConversions).toBe(9);
    expect(review.renew.items.map((item) => item.showName).sort()).toEqual([
      "Commute Hour",
      "Recovery Lab",
    ]);
    const lab = review.renew.items.find((item) => item.showId === "show-1");
    expect(lab?.reasoningLine).toBe(
      "Post-air: 2 reported conversions. Score lifted +8."
    );
    expect(lab?.adjusted).toBe(78);
    expect(lab?.composite).toBe(70);
  });

  it("does not break a tie with a conviction score", () => {
    const review = buildLearningReview(
      input({
        rings: [ring(), ring({ id: "ring-b", label: "Commute", kept: true })],
        deals: [
          deal({ reportedConversions: 4, composite: 90 }),
          deal({
            dealId: "d2",
            showId: "show-2",
            showName: "Commute Hour",
            ringId: "ring-b",
            ringLabel: "Commute",
            reportedConversions: 4,
            composite: 50,
          }),
        ],
      })
    );
    expect(review.bestRing.items.map((item) => item.label).sort()).toEqual([
      "Commute",
      "Recovery",
    ]);
  });

  it("does not call a ring best while another aired ring has no count", () => {
    const review = buildLearningReview(
      input({
        rings: [ring(), ring({ id: "ring-b", label: "Commute", kept: true })],
        deals: [
          deal({ reportedConversions: 6 }),
          deal({
            dealId: "d2",
            showId: "show-2",
            showName: "Commute Hour",
            ringId: "ring-b",
            ringLabel: "Commute",
            reportedConversions: null,
          }),
        ],
      })
    );
    expect(review.bestRing.items.map((item) => item.ringId)).toEqual(["ring-a"]);
    expect(review.bestRing.caveat).toBe(
      "Rings still missing a conversion report: not enough data."
    );
  });

  it("does not split one deal's count across mixed read styles", () => {
    const review = buildLearningReview(
      input({
        deals: [
          deal({
            reportedConversions: 5,
            readerTypes: ["host_read", "producer_read"],
            placements: ["mid-roll"],
          }),
        ],
      })
    );
    expect(review.styles.items.map((item) => item.key)).toEqual(["mid-roll"]);
    expect(review.styles.items[0].reportedConversions).toBe(5);
  });

  it("lists every scale show, including a low score, and skips one that already aired", () => {
    const review = buildLearningReview(
      input({
        deals: [deal({ showId: "aired-scale", reportedConversions: 1 })],
        scaleShows: [
          scale({ showId: "aired-scale", showName: "Already Ran", composite: 90 }),
          scale({ showId: "low", showName: "Quiet Show", composite: 12, ringId: "ring-z", ringLabel: "Other" }),
          scale({ showId: "high", showName: "Loud Show", composite: 80, ringId: "ring-a" }),
        ],
      })
    );
    expect(review.scaleNext.items.map((item) => item.showId)).toEqual(["high", "low"]);
    expect(review.scaleNext.items[0].sameRingAsWinner).toBe(true);
  });

  it("keeps a rep note without inventing a score or a conversion count", () => {
    const note: LearningOverrideInput = {
      id: "note-1",
      authorRole: "rep",
      targetKind: "show",
      targetKey: "show-9",
      stance: "test_next",
      note: "rep vouches, test one flight",
    };
    const review = buildLearningReview(
      input({
        campaignStatus: "completed",
        showNames: { "show-9": "Vouched Show" },
        overrides: [note],
      })
    );
    expect(review.scaleNext.items).toEqual([
      expect.objectContaining({
        showId: "show-9",
        showName: "Vouched Show",
        composite: null,
        overrideNote: "rep vouches, test one flight",
      }),
    ]);
    expect(review.overrides[0].note).toBe("rep vouches, test one flight");
    expect(review.renew.missing).toBe(NOT_ENOUGH_DATA);
  });

  it("adds a renew note even when the count is missing", () => {
    const review = buildLearningReview(
      input({
        campaignStatus: "completed",
        deals: [deal()],
        overrides: [
          {
            id: "note-2",
            authorRole: "brand",
            targetKind: "show",
            targetKey: "show-1",
            stance: "renew",
            note: "host will record a tighter read",
          },
        ],
      })
    );
    expect(review.renew.items[0]).toEqual(
      expect.objectContaining({
        showName: "Recovery Lab",
        reportedConversions: null,
        reasoningLine: null,
        overrideNote: "host will record a tighter read",
      })
    );
  });

  it("ignores a cancelled deal", () => {
    const review = buildLearningReview(
      input({
        campaignStatus: "completed",
        deals: [deal({ status: "cancelled", reportedConversions: 20 })],
      })
    );
    expect(review.deals).toEqual([]);
    expect(review.bestRing.missing).toBe(NOT_ENOUGH_DATA);
    expect(review.renew.missing).toBe(NOT_ENOUGH_DATA);
  });

  it("does not invent a lifted score when the composite is missing", () => {
    const review = buildLearningReview(
      input({
        deals: [deal({ composite: null, reportedConversions: 3 })],
      })
    );
    expect(review.renew.items[0].adjusted).toBeNull();
    expect(review.renew.items[0].reasoningLine).toBeNull();
    expect(review.renew.items[0].reportedConversions).toBe(3);
  });
});
