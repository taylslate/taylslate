import { describe, expect, it } from "vitest";
import { locateAdRead, talkingPointsFromPitch } from "./locate";
import type { AircheckBuy, AircheckSegment } from "./types";

const BUY: AircheckBuy = {
  brandNames: ["Sauna Box"],
  promoCode: "HUBERMAN",
  url: "https://www.saunabox.com/offer",
  placement: "mid-roll",
  talkingPoints: "The infrared cabin heats in ten minutes",
};

function segments(duration: number): AircheckSegment[] {
  const third = duration / 3;
  return [
    { start_seconds: 0, end_seconds: third, text: "Welcome back to the show." },
    {
      start_seconds: third,
      end_seconds: third + 50,
      text: "This episode is brought to you by Sauna Box. Use code HUBERMAN at saunabox.com. The infrared cabin heats in ten minutes.",
    },
    { start_seconds: third + 50, end_seconds: duration, text: "Now the interview continues." },
  ];
}

describe("locateAdRead", () => {
  it("stores confidence, timestamps, and reasons and marks the row ready for review", () => {
    const duration = 1800;
    const located = locateAdRead({
      status: "transcribed",
      transcript: segments(duration).map((segment) => segment.text).join(" "),
      segments: segments(duration),
      durationSeconds: duration,
      buy: BUY,
    });
    expect(located.judgment.match_result).toBe("matched");
    expect(located.readyForReview).toBe(true);
    expect(located.confidence).toBe(1);
    expect(located.adStartSeconds).toBe(600);
    expect(located.adEndSeconds).toBe(650);
    expect(located.judgment.match_evidence.position).toBe("found");
    expect(located.judgment.match_evidence.length).toBe("found");
    expect(located.reasons.some((reason) => reason.includes("Brand found at"))).toBe(true);
    expect(located.reasons.some((reason) => reason.includes("HUBERMAN") || reason.includes("Code or URL"))).toBe(
      true
    );
    expect(located.reasons.some((reason) => reason.includes("Ready for review"))).toBe(true);
    expect(located.reasons.join(" ")).not.toMatch(/charge/i);
  });

  it("stays ready for review when the code is missing", () => {
    const located = locateAdRead({
      status: "transcribed",
      transcript: "Thanks to Sauna Box for listening today on the show.",
      segments: [
        {
          start_seconds: 10,
          end_seconds: 20,
          text: "Thanks to Sauna Box for listening today on the show.",
        },
      ],
      durationSeconds: 1800,
      buy: { ...BUY, talkingPoints: null },
    });
    expect(located.judgment.match_result).toBe("not_matched");
    expect(located.judgment.match_evidence.code_or_url).toBe("missing");
    expect(located.readyForReview).toBe(true);
    expect(located.confidence).toBeLessThan(1);
    expect(located.reasons.some((reason) => reason.includes("Promo code"))).toBe(true);
  });

  it("does not mark a row ready when there is no transcript", () => {
    const located = locateAdRead({
      status: "failed",
      transcript: null,
      segments: [],
      durationSeconds: null,
      buy: BUY,
    });
    expect(located.judgment.match_result).toBe("skipped");
    expect(located.readyForReview).toBe(false);
    expect(located.confidence).toBe(0);
  });
});

describe("talkingPointsFromPitch", () => {
  it("keeps bullet lines and ignores the rest of the pitch", () => {
    const points = talkingPointsFromPitch(
      "Hi there,\n- The infrared cabin heats in ten minutes\nThanks,\nChris"
    );
    expect(points).toBe("The infrared cabin heats in ten minutes");
    expect(talkingPointsFromPitch("A paragraph with no bullets.")).toBeNull();
  });
});
