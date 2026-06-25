import { describe, it, expect } from "vitest";

// tiered-universe transitively imports reasoning-log / tier-portfolio / queries,
// which construct the admin Supabase client at import. Tests inject fakes, so
// the real client is never used — stub it so import needs no live env.
import { vi } from "vitest";
vi.mock("@/lib/supabase/admin", () => ({ supabaseAdmin: { from: vi.fn() } }));

import {
  getTieredUniverse,
  type TieredUniverseDeps,
} from "./tiered-universe";
import { dollarsToCents } from "./spot-cost";
import {
  THREE_SPOT_THRESHOLD,
  tierCampaignPortfolio,
  type TierPortfolioDeps,
} from "./tier-portfolio";
import type {
  ConvictionScoreRow,
  ConvictionTier,
  CostBasis,
  RingHypothesisRow,
  Show,
} from "@/lib/data/types";
import type { ConvictionScoreWithShow } from "@/lib/data/reasoning-log";

// ---- Fixtures ----

const PATTERN = "cp-1";
const BUDGET_DOLLARS = 10_000; // → 1,000,000 cents; ceiling = 250,000 cents
const BUDGET_CENTS = dollarsToCents(BUDGET_DOLLARS);
const CEILING_CENTS = Math.floor(THREE_SPOT_THRESHOLD * BUDGET_CENTS);

function makeShow(overrides: Partial<Show> = {}): Show {
  return {
    id: "show-x",
    name: "Show X",
    platform: "podcast",
    audience_size: 50000,
    rate_card: { midroll_cpm: 25 },
    price_type: "cpm",
    min_buy: 0,
    categories: [],
    ...overrides,
  } as Show;
}

let seq = 0;
function makeRow(
  overrides: Partial<ConvictionScoreWithShow> = {}
): ConvictionScoreWithShow {
  const base: ConvictionScoreRow = {
    id: `cs-${++seq}`,
    campaign_pattern_id: PATTERN,
    show_id: "show-x",
    ring_hypothesis_id: "ring-a",
    created_at: "2026-01-01T00:00:00.000Z",
    audience_fit_score: 50,
    topical_relevance_score: 80,
    purchase_power_score: 60,
    composite_score: 70,
    conviction_band: "medium",
    reasoning: "persisted 2B prose",
    tier: "test",
    per_spot_cents: 20000,
    three_spot_cents: 60000,
    cpm_used_cents: 2000,
    cost_basis: "derived",
    cost_is_estimate: true,
    needs_quote: false,
    brand_saved: false,
    brand_dismissed: false,
  };
  return { ...base, show: makeShow(), ...overrides };
}

function makeDeps(
  rows: ConvictionScoreWithShow[],
  budgetDollars: number | null = BUDGET_DOLLARS,
  /** Confirmed ring ids (Layer 3.5). Defaults to every distinct ring present in
   *  the rows, so the filter is a no-op unless a test narrows it deliberately. */
  confirmedRingIds?: string[]
): TieredUniverseDeps {
  const confirmed =
    confirmedRingIds ??
    [
      ...new Set(
        rows.map((r) => r.ring_hypothesis_id).filter((id): id is string => !!id)
      ),
    ];
  return {
    loadScoresWithShows: async () => rows,
    loadConfirmedRings: async () =>
      confirmed.map((id) => ({ id }) as RingHypothesisRow),
    loadCampaignCtx: async () =>
      budgetDollars == null
        ? null
        : { campaignId: "camp-1", budgetTotalDollars: budgetDollars },
  };
}

// ---- Tests ----

describe("getTieredUniverse — partitioning", () => {
  it("splits the universe into test / scale / bench by persisted tier", async () => {
    const rows = [
      makeRow({ show_id: "t1", tier: "test", composite_score: 90, show: makeShow({ id: "t1" }) }),
      makeRow({ show_id: "s1", tier: "scale", composite_score: 80, three_spot_cents: 600000, show: makeShow({ id: "s1" }) }),
      makeRow({ show_id: "b1", tier: "dropped", composite_score: 40, show: makeShow({ id: "b1" }) }),
    ];
    const u = await getTieredUniverse(PATTERN, makeDeps(rows));

    expect(u.hasScores).toBe(true);
    expect(u.test.map((s) => s.showId)).toEqual(["t1"]);
    expect(u.scale.map((s) => s.showId)).toEqual(["s1"]);
    expect(u.bench.map((s) => s.showId)).toEqual(["b1"]);
    expect(u.testBudgetCents).toBe(BUDGET_CENTS);
    expect(u.testUnderfilled).toBe(true); // 1 < MIN_TEST_SHOWS
  });

  it("returns an empty universe when there are no scores", async () => {
    const u = await getTieredUniverse(PATTERN, makeDeps([]));
    expect(u.hasScores).toBe(false);
    expect(u.test).toHaveLength(0);
    expect(u.scale).toHaveLength(0);
    expect(u.bench).toHaveLength(0);
  });
});

describe("getTieredUniverse — scale budget delta", () => {
  it("scale rows carry a positive budget delta; test/bench rows carry null", async () => {
    const rows = [
      makeRow({ show_id: "t1", tier: "test", show: makeShow({ id: "t1" }) }),
      makeRow({ show_id: "s1", tier: "scale", three_spot_cents: 600000, show: makeShow({ id: "s1" }) }),
      makeRow({ show_id: "b1", tier: "dropped", show: makeShow({ id: "b1" }) }),
    ];
    const u = await getTieredUniverse(PATTERN, makeDeps(rows));

    expect(u.scale[0].budgetDeltaCents).toBe(600000 - CEILING_CENTS);
    expect(u.scale[0].budgetDeltaCents).toBeGreaterThan(0);
    expect(u.test[0].budgetDeltaCents).toBeNull();
    expect(u.bench[0].budgetDeltaCents).toBeNull();
  });
});

describe("getTieredUniverse — reasoning is read, not regenerated", () => {
  it("surfaces the persisted top-row reasoning verbatim (no LLM dep in the path)", async () => {
    const rows = [makeRow({ reasoning: "the host's recovery audience converts" })];
    // deps expose only DB reads — there is no reasoning/LLM dependency to call.
    const u = await getTieredUniverse(PATTERN, makeDeps(rows));
    expect(u.test[0].reasoning).toBe("the host's recovery audience converts");
  });
});

describe("getTieredUniverse — watchlist flags round-trip", () => {
  it("passes through brand_saved / brand_dismissed", async () => {
    const rows = [
      makeRow({ show_id: "s1", tier: "scale", three_spot_cents: 600000, brand_saved: true, brand_dismissed: false, show: makeShow({ id: "s1" }) }),
      makeRow({ show_id: "s2", tier: "scale", three_spot_cents: 600000, brand_saved: false, brand_dismissed: true, show: makeShow({ id: "s2" }) }),
    ];
    const u = await getTieredUniverse(PATTERN, makeDeps(rows));
    const saved = u.scale.find((s) => s.showId === "s1")!;
    const dismissed = u.scale.find((s) => s.showId === "s2")!;
    expect(saved.brandSaved).toBe(true);
    expect(saved.brandDismissed).toBe(false);
    expect(dismissed.brandSaved).toBe(false);
    expect(dismissed.brandDismissed).toBe(true);
  });

  it("coalesces null watchlist flags to false", async () => {
    const rows = [makeRow({ brand_saved: null, brand_dismissed: null })];
    const u = await getTieredUniverse(PATTERN, makeDeps(rows));
    expect(u.test[0].brandSaved).toBe(false);
    expect(u.test[0].brandDismissed).toBe(false);
  });
});

describe("getTieredUniverse — compute-on-read fallback", () => {
  it("classifies a tier-null row on the fly from the embedded show", async () => {
    // tier null (persist failed / pre-028). audience 10k × $20 CPM = $200/spot →
    // 60,000 cents for 3 spots, well under the 250,000 ceiling → test.
    const rows = [
      makeRow({
        tier: null,
        per_spot_cents: null,
        three_spot_cents: null,
        cpm_used_cents: null,
        cost_basis: null,
        cost_is_estimate: null,
        needs_quote: null,
        composite_score: 70,
        show: makeShow({ audience_size: 10000, rate_card: { midroll_cpm: 20 } }),
      }),
    ];
    const u = await getTieredUniverse(PATTERN, makeDeps(rows));

    expect(u.test).toHaveLength(1);
    const s = u.test[0];
    expect(s.computedOnRead).toBe(true);
    expect(s.tier).toBe("test");
    expect(s.perSpotCents).toBe(20000); // (10000/1000)*$20 = $200
    expect(s.threeSpotCents).toBe(60000);
    expect(s.costBasis).toBe("derived");
    expect(s.needsQuote).toBe(false);
  });

  it("does not crash when a tier-null row has no embedded show → needs-quote bench", async () => {
    const rows = [makeRow({ tier: null, show: null, composite_score: 90 })];
    const u = await getTieredUniverse(PATTERN, makeDeps(rows));
    expect(u.bench).toHaveLength(1);
    expect(u.bench[0].computedOnRead).toBe(true);
    expect(u.bench[0].needsQuote).toBe(true);
    expect(u.bench[0].tier).toBe("dropped");
  });
});

describe("getTieredUniverse — simulcast resolves a single cost via medium", () => {
  it("a merged simulcast (one show, flat-fee YouTube medium) yields one entry, one cost", async () => {
    // A simulcast is folded to ONE show upstream; by read time it is a single
    // row. flat_rate YouTube → flat_fee basis, priced off the medium's rate card.
    const yt = makeShow({
      id: "yt-1",
      platform: "youtube",
      price_type: "flat_rate",
      rate_card: { flat_rate: 5000 },
      audience_size: 0,
    });
    const rows = [
      makeRow({
        show_id: "yt-1",
        tier: null,
        per_spot_cents: null,
        three_spot_cents: null,
        cost_basis: null,
        cost_is_estimate: null,
        needs_quote: null,
        composite_score: 70,
        show: yt,
      }),
    ];
    const u = await getTieredUniverse(PATTERN, makeDeps(rows));

    const all = [...u.test, ...u.scale, ...u.bench];
    expect(all).toHaveLength(1); // single entry for the simulcast show
    const s = all[0];
    expect(s.costBasis).toBe("flat_fee");
    expect(s.perSpotCents).toBe(dollarsToCents(5000));
    expect(s.tier).toBe("test"); // flat_fee is conviction-only, never scale on cost
  });
});

describe("getTieredUniverse — needs_quote lands in bench with the marker", () => {
  it("a persisted needs_quote / dropped show is bench, needsQuote true", async () => {
    const rows = [
      makeRow({
        tier: "dropped",
        needs_quote: true,
        per_spot_cents: null,
        three_spot_cents: null,
        cpm_used_cents: null,
        cost_basis: null,
      }),
    ];
    const u = await getTieredUniverse(PATTERN, makeDeps(rows));
    expect(u.bench).toHaveLength(1);
    expect(u.bench[0].needsQuote).toBe(true);
    expect(u.test).toHaveLength(0);
    expect(u.scale).toHaveLength(0);
  });
});

describe("getTieredUniverse — per-show rollup across rings", () => {
  it("collapses a show on multiple rings to one entry at its highest composite", async () => {
    const rows = [
      makeRow({ ring_hypothesis_id: "ring-a", composite_score: 60, reasoning: "lower ring" }),
      makeRow({ ring_hypothesis_id: "ring-b", composite_score: 88, reasoning: "winning ring" }),
    ];
    const u = await getTieredUniverse(PATTERN, makeDeps(rows));

    const all = [...u.test, ...u.scale, ...u.bench];
    expect(all).toHaveLength(1); // one show, not two
    expect(all[0].composite).toBe(88);
    expect(all[0].ringHypothesisId).toBe("ring-b");
    expect(all[0].reasoning).toBe("winning ring");
  });
});

describe("getTieredUniverse — confirmed-ring filter (Layer 3.5)", () => {
  it("a show whose only ring was rejected is absent from the whole universe", async () => {
    const rows = [
      makeRow({ show_id: "keep", ring_hypothesis_id: "ring-ok", show: makeShow({ id: "keep" }) }),
      makeRow({ show_id: "gone", ring_hypothesis_id: "ring-rejected", show: makeShow({ id: "gone" }) }),
    ];
    const u = await getTieredUniverse(PATTERN, makeDeps(rows, BUDGET_DOLLARS, ["ring-ok"]));

    const allIds = [...u.test, ...u.scale, ...u.bench].map((s) => s.showId);
    expect(allIds).toEqual(["keep"]);
    expect(allIds).not.toContain("gone");
  });

  it("a rejected+confirmed show is present, rolled up from the confirmed ring only", async () => {
    // The rejected ring has the HIGHER composite — a pre-fix rollup would have
    // surfaced it. After the filter the confirmed ring governs the entry.
    const rows = [
      makeRow({
        ring_hypothesis_id: "ring-rejected",
        composite_score: 88,
        conviction_band: "high",
        reasoning: "rejected-ring prose",
      }),
      makeRow({
        ring_hypothesis_id: "ring-ok",
        composite_score: 70,
        conviction_band: "medium",
        reasoning: "confirmed-ring prose",
      }),
    ];
    const u = await getTieredUniverse(PATTERN, makeDeps(rows, BUDGET_DOLLARS, ["ring-ok"]));

    const all = [...u.test, ...u.scale, ...u.bench];
    expect(all).toHaveLength(1);
    expect(all[0].composite).toBe(70);
    expect(all[0].ringHypothesisId).toBe("ring-ok");
    expect(all[0].band).toBe("medium");
    expect(all[0].reasoning).toBe("confirmed-ring prose");
  });

  it("persist pass and read path agree on the surviving show set for one campaign", async () => {
    // show-A + show-C on the confirmed ring; show-B only on a rejected ring.
    const rows = [
      makeRow({ show_id: "show-A", ring_hypothesis_id: "ring-ok", show: makeShow({ id: "show-A" }) }),
      makeRow({ show_id: "show-B", ring_hypothesis_id: "ring-rejected", show: makeShow({ id: "show-B" }) }),
      makeRow({ show_id: "show-C", ring_hypothesis_id: "ring-ok", show: makeShow({ id: "show-C" }) }),
    ];
    const confirmed = ["ring-ok"];
    const showById = new Map(rows.map((r) => [r.show_id as string, r.show as Show]));

    // Read path.
    const u = await getTieredUniverse(PATTERN, makeDeps(rows, BUDGET_DOLLARS, confirmed));
    const readIds = new Set([...u.test, ...u.scale, ...u.bench].map((s) => s.showId));

    // Persist path — same rows, same confirmed-ring set.
    const persistedIds: string[] = [];
    const portfolioDeps: TierPortfolioDeps = {
      loadScores: async () => rows,
      loadConfirmedRings: async () =>
        confirmed.map((id) => ({ id }) as RingHypothesisRow),
      loadCampaignCtx: async () => ({ campaignId: "camp-1", budgetTotalDollars: BUDGET_DOLLARS }),
      loadShowsByIds: async (ids) =>
        new Map(ids.filter((id) => showById.has(id)).map((id) => [id, showById.get(id)!])),
      persist: async (input) => {
        persistedIds.push(input.showId);
        return true;
      },
      emit: async () => null,
    };
    await tierCampaignPortfolio(PATTERN, portfolioDeps);

    expect(readIds).toEqual(new Set(["show-A", "show-C"]));
    expect(new Set(persistedIds)).toEqual(readIds);
    expect(readIds.has("show-B")).toBe(false);
  });
});
