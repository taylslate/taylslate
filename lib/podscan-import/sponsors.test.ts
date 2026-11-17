import { describe, expect, it } from "vitest";
import { chunkIds, probeSponsorRecency, scoreProbeChecks } from "./sponsors";

describe("sponsor probe", () => {
  it("posts chunks of 100 and maps nulls", async () => {
    const ids = Array.from({ length: 250 }, (_, index) => `pd_${index}`);
    const sizes: number[] = [];
    const found = await probeSponsorRecency(ids, async (chunk) => {
      sizes.push(chunk.length);
      const results: Record<string, string | null> = {};
      for (const id of chunk) {
        if (id === "pd_0") results[id] = "ep_0";
        else if (id === "pd_1") results[id] = "";
        else if (id === "pd_2") results[id] = null;
      }
      return { results };
    });
    expect(sizes).toEqual([100, 100, 50]);
    expect(found.pd_0).toBe("ep_0");
    expect(found.pd_1).toBeNull();
    expect(found.pd_2).toBeNull();
    expect(found.pd_3).toBeNull();
    expect(chunkIds(ids).map((chunk) => chunk.length)).toEqual([100, 100, 50]);
  });

  it("passes at 18 agreements and lists mismatch ids", () => {
    const now = new Date("2026-11-17T00:00:00.000Z");
    const recent = "2026-11-01T00:00:00.000Z";
    const old = "2024-01-01T00:00:00.000Z";
    const checks = Array.from({ length: 20 }, (_, index) => ({
      podcastId: `pd_${index}`,
      probeEpisodeId: index < 18 ? `ep_${index}` : null,
      postedAt: index < 18 ? recent : old,
      missing: false,
    }));
    expect(scoreProbeChecks(checks, now).pass).toBe(true);
    checks[0].postedAt = old;
    checks[1].postedAt = old;
    checks[2].postedAt = old;
    const scored = scoreProbeChecks(checks, now);
    expect(scored.pass).toBe(false);
    expect(scored.mismatches).toEqual(["pd_0", "pd_1", "pd_2"]);
  });
});
