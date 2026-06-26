import { describe, it, expect, vi } from "vitest";

// Default deps statically import queries/reasoning-log, which construct the admin
// Supabase client at import time (needs live env). Tests inject fakes, so the
// real client is never used — stub it so the import doesn't require env.
vi.mock("@/lib/supabase/admin", () => ({ supabaseAdmin: { from: vi.fn() } }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

import type { CampaignPatternRow } from "@/lib/data/types";
import {
  applyPortfolioOverride,
  type PortfolioOverride,
  type RecomputePortfolioDeps,
} from "./recompute-portfolio";
import type { TierPortfolioResult } from "./tier-portfolio";

function tierResult(over: Partial<TierPortfolioResult> = {}): TierPortfolioResult {
  return {
    campaignPatternId: "pattern-1",
    testCount: 3,
    scaleCount: 1,
    droppedCount: 2,
    testUnderfilled: false,
    showsClassified: 6,
    persisted: 6,
    errors: [],
    ...over,
  };
}

interface Spies {
  campaignOverrides: Array<{
    campaignId: string;
    input: { testSpotCount?: number | null; testPlacement?: string | null };
  }>;
  showOverrides: Array<{
    campaignPatternId: string;
    showId: string;
    cpmOverrideCents?: number | null;
    placementOverride?: string | null;
  }>;
  cleared: string[];
  tierRuns: string[];
  emitted: Array<{ eventType: string; entityId: string; payload: unknown }>;
}

function makeDeps(opts: {
  pattern?: CampaignPatternRow | null;
  campaignPersist?: boolean;
  showPersist?: boolean;
  clearOk?: boolean;
  tier?: TierPortfolioResult;
} = {}): { deps: RecomputePortfolioDeps; spies: Spies } {
  const spies: Spies = {
    campaignOverrides: [],
    showOverrides: [],
    cleared: [],
    tierRuns: [],
    emitted: [],
  };
  const pattern =
    opts.pattern === undefined
      ? ({ id: "pattern-1" } as CampaignPatternRow)
      : opts.pattern;
  const deps: RecomputePortfolioDeps = {
    loadPattern: async () => pattern,
    persistCampaignOverrides: async (campaignId, input) => {
      spies.campaignOverrides.push({ campaignId, input });
      return opts.campaignPersist ?? true;
    },
    persistShowOverride: async (input) => {
      spies.showOverrides.push(input);
      return opts.showPersist ?? true;
    },
    clearShowOverrides: async (patternId) => {
      spies.cleared.push(patternId);
      return opts.clearOk ?? true;
    },
    runTierPass: async (patternId) => {
      spies.tierRuns.push(patternId);
      return opts.tier ?? tierResult();
    },
    emit: async (input) => {
      spies.emitted.push({
        eventType: input.eventType,
        entityId: input.entityId,
        payload: input.payload,
      });
      return null;
    },
  };
  return { deps, spies };
}

describe("applyPortfolioOverride — campaign spot-count", () => {
  it("persists the spot count, reruns the tier pass, and emits override_applied", async () => {
    const { deps, spies } = makeDeps({
      tier: tierResult({ testCount: 4, scaleCount: 0 }),
    });
    const res = await applyPortfolioOverride(
      "campaign-1",
      { kind: "campaign_spot_count", spotCount: 1 },
      deps
    );
    expect(res.ok).toBe(true);
    expect(spies.campaignOverrides).toEqual([
      { campaignId: "campaign-1", input: { testSpotCount: 1 } },
    ]);
    expect(spies.tierRuns).toEqual(["pattern-1"]); // recomputed after persist
    expect(res.tier?.testCount).toBe(4);
    const ev = spies.emitted.find((e) => e.eventType === "portfolio.override_applied");
    expect(ev).toBeTruthy();
    expect(ev!.entityId).toBe("campaign-1");
  });
});

describe("applyPortfolioOverride — placement (campaign + per-show)", () => {
  it("campaign placement persists to the campaign and recomputes", async () => {
    const { deps, spies } = makeDeps();
    await applyPortfolioOverride(
      "campaign-1",
      { kind: "campaign_placement", placement: "postroll" },
      deps
    );
    expect(spies.campaignOverrides[0].input).toEqual({ testPlacement: "postroll" });
    expect(spies.showOverrides).toHaveLength(0);
    expect(spies.tierRuns).toEqual(["pattern-1"]);
  });

  it("per-show placement persists to the row (not the campaign) and recomputes", async () => {
    const { deps, spies } = makeDeps();
    await applyPortfolioOverride(
      "campaign-1",
      { kind: "show_placement", showId: "show-C", placementOverride: "postroll" },
      deps
    );
    expect(spies.campaignOverrides).toHaveLength(0);
    expect(spies.showOverrides).toEqual([
      {
        campaignPatternId: "pattern-1",
        showId: "show-C",
        placementOverride: "postroll",
      },
    ]);
    expect(spies.tierRuns).toEqual(["pattern-1"]);
  });
});

describe("applyPortfolioOverride — per-show CPM", () => {
  it("persists the per-show CPM override and recomputes only via the pattern", async () => {
    const { deps, spies } = makeDeps();
    const res = await applyPortfolioOverride(
      "campaign-1",
      { kind: "show_cpm", showId: "show-C", cpmOverrideCents: 1000 },
      deps
    );
    expect(res.ok).toBe(true);
    expect(spies.showOverrides).toEqual([
      { campaignPatternId: "pattern-1", showId: "show-C", cpmOverrideCents: 1000 },
    ]);
    expect(spies.tierRuns).toEqual(["pattern-1"]);
  });

  it("a null CPM clears the override (reset of a single show) and recomputes", async () => {
    const { deps, spies } = makeDeps();
    await applyPortfolioOverride(
      "campaign-1",
      { kind: "show_cpm", showId: "show-C", cpmOverrideCents: null },
      deps
    );
    expect(spies.showOverrides[0].cpmOverrideCents).toBeNull();
  });
});

describe("applyPortfolioOverride — reset-to-default", () => {
  it("clears the campaign config AND every per-show override, then recomputes", async () => {
    const { deps, spies } = makeDeps();
    const res = await applyPortfolioOverride("campaign-1", { kind: "reset" }, deps);
    expect(res.ok).toBe(true);
    expect(spies.campaignOverrides).toEqual([
      { campaignId: "campaign-1", input: { testSpotCount: null, testPlacement: null } },
    ]);
    expect(spies.cleared).toEqual(["pattern-1"]);
    expect(spies.tierRuns).toEqual(["pattern-1"]);
  });
});

describe("applyPortfolioOverride — guards + idempotency", () => {
  it("returns ok:false and never recomputes when there's no discovery pattern", async () => {
    const { deps, spies } = makeDeps({ pattern: null });
    const res = await applyPortfolioOverride(
      "campaign-1",
      { kind: "campaign_spot_count", spotCount: 1 },
      deps
    );
    expect(res.ok).toBe(false);
    expect(res.tier).toBeNull();
    expect(spies.tierRuns).toHaveLength(0); // did NOT tier an empty universe
  });

  it("a failed input persist aborts the recompute (no cache rewrite on a bad write)", async () => {
    const { deps, spies } = makeDeps({ campaignPersist: false });
    const res = await applyPortfolioOverride(
      "campaign-1",
      { kind: "campaign_spot_count", spotCount: 1 },
      deps
    );
    expect(res.ok).toBe(false);
    expect(res.tier).toBeNull();
    expect(spies.tierRuns).toHaveLength(0);
  });

  it("idempotent: the same override applied twice yields the same tier counts", async () => {
    const override: PortfolioOverride = { kind: "campaign_spot_count", spotCount: 1 };
    const first = await applyPortfolioOverride(
      "campaign-1",
      override,
      makeDeps({ tier: tierResult({ testCount: 4, scaleCount: 0 }) }).deps
    );
    const second = await applyPortfolioOverride(
      "campaign-1",
      override,
      makeDeps({ tier: tierResult({ testCount: 4, scaleCount: 0 }) }).deps
    );
    expect(first.tier?.testCount).toBe(second.tier?.testCount);
    expect(first.tier?.scaleCount).toBe(second.tier?.scaleCount);
  });
});
