import { describe, expect, it } from "vitest";
import {
  analyticsQueryUrl,
  analyticsWindow,
  retentionPointsForAd,
  type RetentionPoint,
} from "./analytics";

function point(ratio: number): RetentionPoint {
  return {
    ratio,
    audience_watch_ratio: ratio,
    relative_retention_performance: 1,
  };
}

describe("youtube analytics window", () => {
  const published = "2026-11-01T00:00:00.000Z";

  it("waits 48 hours, retries through 14 days, and stops after 10 attempts", () => {
    expect(
      analyticsWindow({
        now: new Date("2026-11-02T00:00:00.000Z"),
        publishedAt: published,
        attempts: 0,
        hasViews: false,
      })
    ).toBe("wait");
    expect(
      analyticsWindow({
        now: new Date("2026-11-04T00:00:00.000Z"),
        publishedAt: published,
        attempts: 0,
        hasViews: false,
      })
    ).toBe("due");
    expect(
      analyticsWindow({
        now: new Date("2026-11-20T00:00:00.000Z"),
        publishedAt: published,
        attempts: 1,
        hasViews: false,
      })
    ).toBe("expired");
    expect(
      analyticsWindow({
        now: new Date("2026-11-04T00:00:00.000Z"),
        publishedAt: published,
        attempts: 10,
        hasViews: false,
      })
    ).toBe("done");
    expect(
      analyticsWindow({
        now: new Date("2026-11-04T00:00:00.000Z"),
        publishedAt: published,
        attempts: 1,
        hasViews: true,
      })
    ).toBe("done");
  });

  it("keeps only the raw points that cover the ad, plus one point either side", () => {
    const points = [0.4, 0.49, 0.5, 0.51, 0.52, 0.6].map(point);
    const kept = retentionPointsForAd({
      points,
      durationSeconds: 100,
      adStartSeconds: 50,
      adEndSeconds: 51,
    });
    expect(kept.map((row) => row.ratio)).toEqual([0.49, 0.5, 0.51, 0.52]);
    expect(kept[0]).not.toHaveProperty("score");
    expect(analyticsQueryUrl({
      videoId: "abcdefghijk",
      publishedAt: published,
      now: new Date("2026-11-04T00:00:00.000Z"),
      retention: true,
    })).toContain("elapsedVideoTimeRatio");
    expect(
      analyticsQueryUrl({
        videoId: "abcdefghijk",
        publishedAt: published,
        now: new Date("2026-11-04T00:00:00.000Z"),
        retention: false,
      })
    ).toContain("metrics=views%2CestimatedMinutesWatched%2CaverageViewDuration");
  });
});
