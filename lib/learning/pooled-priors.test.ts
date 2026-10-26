import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: { from: vi.fn(), rpc: vi.fn() },
}));

import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  buildPooledPriors,
  loadPooledPriors,
  percentileCont,
  priorMapKey,
  refreshPooledImportPriors,
  toPoolPlacement,
  toPoolPriceType,
  type PooledPriorSourceRow,
} from "./pooled-priors";

function row(over: Partial<PooledPriorSourceRow> = {}): PooledPriorSourceRow {
  return {
    brandId: "brand-1",
    status: "confirmed",
    poolingConsent: true,
    matchedShowId: "show-1",
    showMatchStatus: null,
    discoverable: true,
    categories: ["True Crime"],
    placement: "mid-roll",
    priceType: "cpm",
    rate: 30,
    conversions: 10,
    downloads: 1000,
    ...over,
  };
}

function fiveBrands(over: Partial<PooledPriorSourceRow> = {}): PooledPriorSourceRow[] {
  return [1, 2, 3, 4, 5].map((n) =>
    row({
      brandId: `brand-${n}`,
      rate: [20, 25, 30, 40, 50][n - 1],
      ...over,
    })
  );
}

const sql = readFileSync(
  join(process.cwd(), "supabase/migrations/068_past_campaign_show_match.sql"),
  "utf8"
);

describe("buildPooledPriors", () => {
  it("drops consent, status, unmatched rows, and groups under 5 brands", () => {
    const rows = [
      ...[1, 2, 3, 4].map((n) => row({ brandId: `brand-${n}` })),
      row({ brandId: "brand-5", poolingConsent: false }),
      row({ brandId: "brand-6", status: "parsed" }),
      row({ brandId: "brand-7", status: "discarded" }),
      row({ brandId: "brand-8", matchedShowId: null }),
      row({ brandId: "brand-9", categories: [] }),
      row({ brandId: "brand-10", categories: ["  "] }),
    ];
    expect(buildPooledPriors(rows)).toEqual([]);
  });

  it("keeps one identifier-free prior once five distinct brands consent", () => {
    const priors = buildPooledPriors(fiveBrands());
    expect(priors).toEqual([
      {
        category: "True Crime",
        placement: "mid-roll",
        priceType: "cpm",
        brandCount: 5,
        recordCount: 5,
        medianCpm: 30,
        medianConversionsPer1kDownloads: 10,
      },
    ]);
    expect(Object.keys(priors[0]).sort()).toEqual([
      "brandCount",
      "category",
      "medianConversionsPer1kDownloads",
      "medianCpm",
      "placement",
      "priceType",
      "recordCount",
    ]);
    expect(JSON.stringify(priors)).not.toContain("brand-");
    expect(JSON.stringify(priors)).not.toContain("show-1");
  });

  it("counts a brand once and interpolates an even median the way percentile_cont does", () => {
    const rates = [10, 20, 30, 40, 50, 60];
    const rows = rates.map((rate, index) =>
      row({ brandId: `brand-${index + 1}`, rate, conversions: rate, downloads: 1000 })
    );
    rows.push(row({ brandId: "brand-1", rate: 15, conversions: null, downloads: null }));
    const [prior] = buildPooledPriors(rows);
    expect(prior.brandCount).toBe(6);
    expect(prior.recordCount).toBe(7);
    expect(prior.medianCpm).toBe(percentileCont(0.5, rates.concat(15)));
    expect(prior.medianCpm).toBe(30);
    expect(prior.medianConversionsPer1kDownloads).toBe(percentileCont(0.5, rates));
    expect(prior.medianConversionsPer1kDownloads).toBe(35);
  });

  it("leaves median cpm empty for a flat group and splits categories", () => {
    const rows = fiveBrands({
      priceType: "flat",
      rate: 500,
      categories: ["News", " News ", "Comedy"],
    });
    const priors = buildPooledPriors(rows);
    expect(priors.map((prior) => prior.category)).toEqual(["Comedy", "News"]);
    expect(priors.every((prior) => prior.medianCpm == null)).toBe(true);
    expect(priors.every((prior) => prior.brandCount === 5 && prior.recordCount === 5)).toBe(true);
  });

  it("keeps ambiguous and hidden-show rows out of the pool", () => {
    expect(buildPooledPriors(fiveBrands({ showMatchStatus: "matched" }))).toHaveLength(1);
    expect(buildPooledPriors(fiveBrands({ showMatchStatus: null }))).toHaveLength(1);

    const ambiguous = fiveBrands({ showMatchStatus: "matched" });
    ambiguous[0] = row({
      brandId: "brand-1",
      showMatchStatus: "ambiguous",
      matchedShowId: null,
    });
    expect(buildPooledPriors(ambiguous)).toEqual([]);

    const hidden = fiveBrands({ showMatchStatus: "matched" });
    hidden[0] = row({
      brandId: "brand-1",
      showMatchStatus: "matched",
      discoverable: false,
    });
    expect(buildPooledPriors(hidden)).toEqual([]);
    expect(buildPooledPriors(fiveBrands({ discoverable: false }))).toEqual([]);
  });

  it("stays in sync with the SQL refresh", () => {
    expect(sql).toContain("imp.status = 'confirmed'");
    expect(sql).toContain("imp.pooling_consent = true");
    expect(sql).toContain("count(distinct rec.brand_id) >= 5");
    expect(sql).toContain("rec.matched_show_id is not null");
    expect(sql).toContain("rec.show_match_status is null");
    expect(sql).toContain("rec.show_match_status = 'matched'");
    expect(sql).toContain("and sh.is_discoverable");
    expect(sql).toContain("percentile_cont(0.5)");
    expect(sql).toContain("unnest");
    expect(sql).toContain("btrim(cat)");
    expect(sql).toContain("when grouped.price_type = 'cpm' then grouped.median_rate");
    expect(sql).toContain("(rec.conversions::numeric * 1000) / nullif(rec.downloads, 0)");
    expect(percentileCont(0.5, [20, 25, 30, 40, 50])).toBe(30);
    expect(percentileCont(0.5, [])).toBeNull();
  });
});

describe("pool key helpers", () => {
  it("maps discovery placement and show price type onto import vocabulary", () => {
    expect(toPoolPlacement("midroll")).toBe("mid-roll");
    expect(toPoolPlacement("pre-roll")).toBe("pre-roll");
    expect(toPoolPlacement("postroll")).toBe("post-roll");
    expect(toPoolPriceType("flat_rate")).toBe("flat");
    expect(toPoolPriceType("cpm")).toBe("cpm");
    expect(priorMapKey("News", "mid-roll", "cpm")).not.toBe(priorMapKey("News", null, "cpm"));
  });
});

describe("loadPooledPriors and refreshPooledImportPriors", () => {
  beforeEach(() => {
    vi.mocked(supabaseAdmin.from).mockReset();
    vi.mocked(supabaseAdmin.rpc).mockReset();
  });

  it("does not query when there are no keys", async () => {
    await expect(loadPooledPriors([])).resolves.toEqual(new Map());
    expect(supabaseAdmin.from).not.toHaveBeenCalled();
  });

  it("reads the pool as service role and drops a short group", async () => {
    vi.mocked(supabaseAdmin.from).mockImplementation(((table: string) => {
      const builder = {
        select: () => builder,
        then: (
          resolve: (value: { data: unknown; error: null }) => unknown,
          reject?: (reason: unknown) => unknown
        ) =>
          Promise.resolve({
            data:
              table === "pooled_import_priors"
                ? [
                    {
                      category: "True Crime",
                      placement: "mid-roll",
                      price_type: "cpm",
                      brand_count: "5",
                      record_count: "6",
                      median_cpm: "30",
                      median_conversions_per_1k_downloads: "10",
                    },
                    {
                      category: "News",
                      placement: "mid-roll",
                      price_type: "cpm",
                      brand_count: 4,
                      record_count: 4,
                      median_cpm: 10,
                      median_conversions_per_1k_downloads: 1,
                    },
                  ]
                : [],
            error: null,
          }).then(resolve, reject),
      };
      return builder;
    }) as never);

    const loaded = await loadPooledPriors([
      { category: "True Crime", placement: "mid-roll", priceType: "cpm" },
      { category: "News", placement: "mid-roll", priceType: "cpm" },
    ]);
    expect(supabaseAdmin.from).toHaveBeenCalledWith("pooled_deal_priors");
    expect(supabaseAdmin.from).toHaveBeenCalledWith("pooled_import_priors");
    expect([...loaded.keys()]).toEqual([priorMapKey("True Crime", "mid-roll", "cpm")]);
    expect(loaded.get(priorMapKey("True Crime", "mid-roll", "cpm"))).toEqual({
      category: "True Crime",
      placement: "mid-roll",
      priceType: "cpm",
      brandCount: 5,
      recordCount: 6,
      medianCpm: 30,
      medianConversionsPer1kDownloads: 10,
    });
  });

  it("lets a deal prior win and keeps an import prior the deal pool lacks", async () => {
    vi.mocked(supabaseAdmin.from).mockImplementation(((table: string) => {
      const builder = {
        select: () => builder,
        then: (
          resolve: (value: { data: unknown; error: null }) => unknown,
          reject?: (reason: unknown) => unknown
        ) =>
          Promise.resolve({
            data:
              table === "pooled_deal_priors"
                ? [
                    {
                      category: "True Crime",
                      placement: "mid-roll",
                      price_type: "cpm",
                      brand_count: 6,
                      deal_count: 8,
                      median_cpm: 42,
                      median_conversions_per_1k_downloads: 4,
                    },
                  ]
                : [
                    {
                      category: "True Crime",
                      placement: "mid-roll",
                      price_type: "cpm",
                      brand_count: 5,
                      record_count: 5,
                      median_cpm: 10,
                      median_conversions_per_1k_downloads: 1,
                    },
                    {
                      category: "News",
                      placement: "mid-roll",
                      price_type: "flat",
                      brand_count: 5,
                      record_count: 5,
                      median_cpm: null,
                      median_conversions_per_1k_downloads: 2,
                    },
                  ],
            error: null,
          }).then(resolve, reject),
      };
      return builder;
    }) as never);

    const loaded = await loadPooledPriors([
      { category: "True Crime", placement: "mid-roll", priceType: "cpm" },
      { category: "News", placement: "mid-roll", priceType: "flat" },
    ]);
    expect(loaded.get(priorMapKey("True Crime", "mid-roll", "cpm"))).toMatchObject({
      brandCount: 6,
      recordCount: 8,
      medianCpm: 42,
    });
    expect(loaded.get(priorMapKey("News", "mid-roll", "flat"))).toMatchObject({
      brandCount: 5,
      recordCount: 5,
      medianCpm: null,
    });
  });

  it("keeps import priors when the deal table is missing", async () => {
    vi.mocked(supabaseAdmin.from).mockImplementation(((table: string) => {
      const builder = {
        select: () => builder,
        then: (resolve: (value: unknown) => unknown) =>
          Promise.resolve(
            table === "pooled_deal_priors"
              ? { data: null, error: { message: "missing" } }
              : {
                  data: [
                    {
                      category: "News",
                      placement: null,
                      price_type: null,
                      brand_count: 5,
                      record_count: 5,
                      median_cpm: null,
                      median_conversions_per_1k_downloads: null,
                    },
                  ],
                  error: null,
                }
          ).then(resolve),
      };
      return builder as never;
    }) as never);
    const loaded = await loadPooledPriors([
      { category: "News", placement: null, priceType: null },
    ]);
    expect(loaded.get(priorMapKey("News", null, null))).toMatchObject({
      brandCount: 5,
      recordCount: 5,
    });
  });

  it("returns an empty map when the read fails", async () => {
    vi.mocked(supabaseAdmin.from).mockImplementation(() => {
      const builder = {
        select: () => builder,
        then: (resolve: (value: unknown) => unknown) =>
          Promise.resolve({ data: null, error: { message: "missing" } }).then(resolve),
      };
      return builder as never;
    });
    const loaded = await loadPooledPriors([
      { category: "News", placement: null, priceType: null },
    ]);
    expect(loaded.size).toBe(0);
  });

  it("calls the refresh function and does not schedule it", async () => {
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({ data: 2, error: null } as never);
    await expect(refreshPooledImportPriors()).resolves.toBe(2);
    expect(supabaseAdmin.rpc).toHaveBeenCalledWith("refresh_pooled_import_priors");

    const src = readFileSync(join(process.cwd(), "lib/learning/pooled-priors.ts"), "utf8");
    expect(src).not.toContain("podscan_id");
    expect(src).not.toContain("\u2014");
    expect(src).not.toMatch(/cron\.schedule/);
    expect(src.match(/refreshPooledImportPriors\(/g)).toEqual(["refreshPooledImportPriors("]);
    expect(src).toContain("pooled_deal_priors");
    const discovery = readFileSync(
      join(process.cwd(), "lib/discovery/tiered-universe.ts"),
      "utf8"
    );
    expect(discovery).toContain("loadPooledPriors");
    expect(discovery).not.toContain("pooled_deal_priors");
  });
});
