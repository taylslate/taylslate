import { describe, it, expect } from "vitest";
import {
  PURCHASE_POWER_SCORE,
  categoryToPurchasePower,
  tierToPurchasePowerScore,
  categoriesToPurchasePowerScore,
  planPurchasePowerBackfill,
  type ShowBackfillRow,
} from "./purchase-power";

describe("anchors (locked: high 80 / medium 50 / low 25)", () => {
  it("maps each tier to its locked score", () => {
    expect(PURCHASE_POWER_SCORE).toEqual({ high: 80, medium: 50, low: 25 });
    expect(tierToPurchasePowerScore("high")).toBe(80);
    expect(tierToPurchasePowerScore("medium")).toBe(50);
    expect(tierToPurchasePowerScore("low")).toBe(25);
  });
});

describe("categoryToPurchasePower", () => {
  it("classifies an affluence-signal category as high", () => {
    expect(categoryToPurchasePower("Business")).toBe("high");
    expect(categoryToPurchasePower("Investing")).toBe("high");
    expect(categoryToPurchasePower("Technology")).toBe("high");
  });

  it("classifies broad/mixed-income categories as medium", () => {
    expect(categoryToPurchasePower("Education")).toBe("medium");
    expect(categoryToPurchasePower("Comedy")).toBe("medium");
    expect(categoryToPurchasePower("Society & Culture")).toBe("medium");
    // Deliberate divergence from §6: Marketing skews small-business/indie.
    expect(categoryToPurchasePower("Marketing")).toBe("medium");
  });

  it("classifies price-sensitive / non-purchasing categories as low", () => {
    expect(categoryToPurchasePower("Kids & Family")).toBe("low");
    expect(categoryToPurchasePower("Music")).toBe("low");
    expect(categoryToPurchasePower("Entertainment")).toBe("low");
  });

  it("Decision B: a bare 'Health & Fitness' is medium, not high", () => {
    // High is reserved for unambiguous affluence; biohacking-lean H&F is not
    // distinguishable from a plain category string.
    expect(categoryToPurchasePower("Health & Fitness")).toBe("medium");
    expect(categoryToPurchasePower("Health & Medicine")).toBe("medium");
    expect(categoryToPurchasePower("Beauty")).toBe("medium");
    expect(categoryToPurchasePower("Fitness")).toBe("medium");
  });

  it("normalizes case, '&'/'and', and separators", () => {
    expect(categoryToPurchasePower("society and culture")).toBe("medium");
    expect(categoryToPurchasePower("SOCIETY & CULTURE")).toBe("medium");
    expect(categoryToPurchasePower("  Real   Estate  ")).toBe("high");
    expect(categoryToPurchasePower("Tech")).toBe("high");
    expect(categoryToPurchasePower("true-crime")).toBe("medium");
  });

  it("degrades unknown category to medium without throwing", () => {
    expect(categoryToPurchasePower("Blockchain Llamas")).toBe("medium");
  });

  it("degrades empty / null / undefined to medium without throwing", () => {
    expect(categoryToPurchasePower("")).toBe("medium");
    expect(categoryToPurchasePower("   ")).toBe("medium");
    expect(categoryToPurchasePower(null)).toBe("medium");
    expect(categoryToPurchasePower(undefined)).toBe("medium");
  });
});

describe("categoriesToPurchasePowerScore (Decision A: MAX over known tiers)", () => {
  it("takes the max tier across a show's categories", () => {
    // Beauty=medium, Business=high → high → 80
    expect(categoriesToPurchasePowerScore(["Beauty", "Business"])).toBe(80);
  });

  it("returns low only when every known category is low", () => {
    expect(categoriesToPurchasePowerScore(["Kids & Family", "Music"])).toBe(25);
  });

  it("treats unknown categories as no-signal — cannot raise a low show", () => {
    // Unknown is skipped (not counted as medium), so a genuinely-low show
    // stays low even with a junk tag alongside.
    expect(categoriesToPurchasePowerScore(["Kids & Family", "Blargh"])).toBe(25);
  });

  it("defaults to medium when there are no recognizable categories", () => {
    expect(categoriesToPurchasePowerScore([])).toBe(50);
    expect(categoriesToPurchasePowerScore(["Blargh", "Wibble"])).toBe(50);
    expect(categoriesToPurchasePowerScore(null)).toBe(50);
    expect(categoriesToPurchasePowerScore(undefined)).toBe(50);
  });
});

describe("planPurchasePowerBackfill", () => {
  const rows: ShowBackfillRow[] = [
    { id: "a", categories: ["Business"], audience_purchase_power: null },
    { id: "b", categories: ["Kids & Family"], audience_purchase_power: null },
    { id: "c", categories: [], audience_purchase_power: null },
  ];

  it("plans an update for every NULL row from its categories", () => {
    const updates = planPurchasePowerBackfill(rows);
    expect(updates).toEqual([
      { id: "a", audience_purchase_power: 80 },
      { id: "b", audience_purchase_power: 25 },
      { id: "c", audience_purchase_power: 50 },
    ]);
  });

  it("is idempotent — a second run over already-populated rows is a no-op", () => {
    const populated: ShowBackfillRow[] = [
      { id: "a", categories: ["Business"], audience_purchase_power: 80 },
      { id: "b", categories: ["Kids & Family"], audience_purchase_power: 25 },
    ];
    expect(planPurchasePowerBackfill(populated)).toEqual([]);
  });

  it("respects an existing non-proxy value (no clobber) by default", () => {
    const manual: ShowBackfillRow[] = [
      { id: "x", categories: ["Business"], audience_purchase_power: 73 },
    ];
    // Default path leaves the manual 73 alone...
    expect(planPurchasePowerBackfill(manual)).toEqual([]);
    // ...and --recompute is the explicit escape hatch that overwrites it.
    expect(planPurchasePowerBackfill(manual, { recompute: true })).toEqual([
      { id: "x", audience_purchase_power: 80 },
    ]);
  });

  it("recompute still writes NULL rows (recompute is a superset of the default)", () => {
    const nullRow: ShowBackfillRow[] = [
      { id: "y", categories: ["Business"], audience_purchase_power: null },
    ];
    expect(planPurchasePowerBackfill(nullRow, { recompute: true })).toEqual([
      { id: "y", audience_purchase_power: 80 },
    ]);
  });

  it("recompute skips no-op writes (value already equals the proxy)", () => {
    const same: ShowBackfillRow[] = [
      { id: "a", categories: ["Business"], audience_purchase_power: 80 },
    ];
    expect(planPurchasePowerBackfill(same, { recompute: true })).toEqual([]);
  });
});
