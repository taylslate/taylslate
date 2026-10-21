import { describe, expect, it } from "vitest";
import { detectAircheckUnderdelivery } from "./detect";

const aired = {
  status: "transcribed" as const,
  match_result: "matched" as const,
  review_decision: null,
  evidenceReason: null,
  reviewReason: null,
};

describe("detectAircheckUnderdelivery", () => {
  it("stays quiet when make-good is off", () => {
    expect(
      detectAircheckUnderdelivery({
        makeGoodEnabled: false,
        makeGoodThreshold: 0.1,
        guaranteedDownloads: 10000,
        actualDownloads: 0,
        aircheck: {
          ...aired,
          match_result: "not_matched",
          review_decision: "rejected",
          reviewReason: "did not air",
        },
      })
    ).toBeNull();
  });

  it("treats a rejection as a missed spot", () => {
    const finding = detectAircheckUnderdelivery({
      makeGoodEnabled: true,
      makeGoodThreshold: 0.1,
      guaranteedDownloads: 10000,
      actualDownloads: 10000,
      aircheck: {
        ...aired,
        review_decision: "rejected",
        reviewReason: "Host read a competitor",
      },
    });
    expect(finding?.kind).toBe("missed");
    expect(finding?.reason).toMatch(/competitor/);
  });

  it("treats an unmatched transcript as a missed spot", () => {
    const finding = detectAircheckUnderdelivery({
      makeGoodEnabled: true,
      makeGoodThreshold: 0.1,
      guaranteedDownloads: 10000,
      actualDownloads: null,
      aircheck: {
        ...aired,
        match_result: "not_matched",
        evidenceReason: "Talking points were not in the transcript.",
      },
    });
    expect(finding?.kind).toBe("missed");
    expect(finding?.reason).toMatch(/Talking points/);
  });

  it("lets a confirmed review override an unmatched transcript", () => {
    expect(
      detectAircheckUnderdelivery({
        makeGoodEnabled: true,
        makeGoodThreshold: 0.1,
        guaranteedDownloads: 10000,
        actualDownloads: 9500,
        aircheck: { ...aired, match_result: "not_matched", review_decision: "confirmed" },
      })
    ).toBeNull();
  });

  it("flags a short spot only past the IO threshold", () => {
    expect(
      detectAircheckUnderdelivery({
        makeGoodEnabled: true,
        makeGoodThreshold: 0.1,
        guaranteedDownloads: 10000,
        actualDownloads: 9000,
        aircheck: aired,
      })
    ).toBeNull();

    const finding = detectAircheckUnderdelivery({
      makeGoodEnabled: true,
      makeGoodThreshold: 0.1,
      guaranteedDownloads: 10000,
      actualDownloads: 8000,
      aircheck: aired,
    });
    expect(finding?.kind).toBe("short");
    expect(finding?.shortfallPct).toBeCloseTo(0.2);
    expect(finding?.reason).toMatch(/8000/);
  });

  it("does not call a matched spot short when downloads are still unknown", () => {
    expect(
      detectAircheckUnderdelivery({
        makeGoodEnabled: true,
        makeGoodThreshold: 0.1,
        guaranteedDownloads: 10000,
        actualDownloads: null,
        aircheck: aired,
      })
    ).toBeNull();
  });

  it("does not treat a skipped aircheck as underdelivery", () => {
    expect(
      detectAircheckUnderdelivery({
        makeGoodEnabled: true,
        makeGoodThreshold: 0.1,
        guaranteedDownloads: 10000,
        actualDownloads: 0,
        aircheck: { ...aired, status: "failed", match_result: "skipped" },
      })
    ).toBeNull();
  });
});
