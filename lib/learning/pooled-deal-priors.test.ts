import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: { rpc: vi.fn() },
}));

import { supabaseAdmin } from "@/lib/supabase/admin";
import { BOOKED_DEAL_STATUSES } from "@/lib/discovery/market-signals";
import {
  buildPooledDealPriors,
  refreshPooledDealPriors,
  type PooledDealSourceRow,
} from "./pooled-deal-priors";

const CONSENT_LINE =
  "Taylslate may use aggregated, anonymized data from deals booked and completed through Taylslate to improve pricing and recommendations. Aggregates never identify a brand, and each one combines at least five brands. Files you upload stay private unless you choose to share them.";

function row(over: Partial<PooledDealSourceRow> = {}): PooledDealSourceRow {
  return {
    brandId: "brand-1",
    brandProfileId: null,
    status: "completed",
    cancelledAt: null,
    categories: ["True Crime"],
    placement: "mid-roll",
    agreedPlacement: null,
    priceType: "cpm",
    cpmRate: 10,
    agreedCpm: 30,
    episodeCount: 1,
    agreedEpisodeCount: null,
    guaranteedDownloads: 1000,
    reportConversions: 10,
    outcomeConversions: null,
    outcomeImpressions: null,
    ...over,
  };
}

function brands(
  count: number,
  over: Partial<PooledDealSourceRow> = {}
): PooledDealSourceRow[] {
  const rates = [20, 25, 30, 40, 50, 60, 70];
  return Array.from({ length: count }, (_, index) =>
    row({
      brandId: `brand-${index + 1}`,
      agreedCpm: rates[index] ?? 30,
      ...over,
    })
  );
}

const sql = readFileSync(
  join(process.cwd(), "supabase/migrations/067_pooled_deal_priors.sql"),
  "utf8"
);

describe("buildPooledDealPriors", () => {
  it("keeps a booked group of 5 and drops 4, cancelled, and unsigned deals", () => {
    expect(buildPooledDealPriors(brands(4))).toEqual([]);

    const ignored = [
      ...brands(4),
      row({ brandId: "brand-5", status: "brand_signed" }),
      row({ brandId: "brand-6", status: "planning" }),
      row({ brandId: "brand-7", status: "io_sent" }),
      row({ brandId: "brand-8", status: "cancelled", cancelledAt: null }),
      row({ brandId: "brand-9", status: "completed", cancelledAt: "2026-10-01" }),
      row({ brandId: "brand-10", categories: ["  "] }),
    ];
    expect(buildPooledDealPriors(ignored)).toEqual([]);

    const priors = buildPooledDealPriors([
      ...brands(4),
      row({ brandId: "brand-5", status: "show_signed", agreedCpm: 50 }),
    ]);
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
    expect(JSON.stringify(priors)).not.toContain("brand-");
  });

  it("counts a brand profile once and lets agreed fields win", () => {
    const completed = [
      row({
        brandId: "b1",
        brandProfileId: "profile-2",
        placement: "pre-roll",
        agreedPlacement: "mid-roll",
        agreedCpm: 20,
        cpmRate: 99,
      }),
      row({ brandId: "b2", brandProfileId: "profile-3", agreedPlacement: "midroll", agreedCpm: 25 }),
      row({ brandId: "b3", brandProfileId: "profile-4", agreedPlacement: "midroll", agreedCpm: 30 }),
      row({ brandId: "b4", brandProfileId: "profile-5", agreedPlacement: "midroll", agreedCpm: 40 }),
      row({ brandId: "b5", brandProfileId: "profile-6", agreedPlacement: "midroll", agreedCpm: 50 }),
      row({
        brandId: "b5-again",
        brandProfileId: "profile-6",
        agreedPlacement: "midroll",
        agreedCpm: 15,
      }),
    ];
    const [prior] = buildPooledDealPriors(completed);
    expect(prior.brandCount).toBe(5);
    expect(prior.recordCount).toBe(6);
    expect(prior.placement).toBe("mid-roll");
    expect(prior.medianCpm).toBe(27.5);
  });

  it("uses outcome impressions ahead of a conversion report, and leaves flat cpm empty", () => {
    const withOutcome = brands(5, {
      reportConversions: 10,
      guaranteedDownloads: 1000,
      episodeCount: 1,
      outcomeConversions: 40,
      outcomeImpressions: 1000,
    });
    expect(buildPooledDealPriors(withOutcome)[0].medianConversionsPer1kDownloads).toBe(40);

    const flat = brands(5, { priceType: "flat_rate", agreedCpm: 500, categories: ["News", " News "] });
    const priors = buildPooledDealPriors(flat);
    expect(priors.map((prior) => prior.category)).toEqual(["News"]);
    expect(priors[0].priceType).toBe("flat");
    expect(priors[0].medianCpm).toBeNull();
    expect(priors[0].medianConversionsPer1kDownloads).toBe(10);
  });

  it("stays in sync with the SQL refresh", () => {
    for (const status of BOOKED_DEAL_STATUSES) {
      expect(sql).toContain(`'${status}'`);
    }
    expect(sql).toContain("d.cancelled_at is null");
    expect(sql).toContain("count(distinct rows.brand_key) >= 5");
    expect(sql).toContain("check (brand_count >= 5)");
    expect(sql).toContain("coalesce(d.agreed_cpm, d.cpm_rate)");
    expect(sql).toContain("coalesce(d.agreed_episode_count, d.num_episodes)");
    expect(sql).toContain("nullif(btrim(d.agreed_placement), '')");
    expect(sql).toContain("delete from public.pooled_deal_priors where true");
    expect(sql).toContain("column_name = 'matched_show_id'");
    expect(sql).toContain("and rec.matched_show_id is not null");
    expect(sql).toContain("imp.pooling_consent = true");
    expect(sql).toContain("o.booking_id = d.id");
    expect(sql).not.toContain("o.show_id = d.show_id and");
    expect(sql).toContain("security invoker");
    expect(sql).toContain("set search_path = public");
    expect(sql).not.toContain("security definer");
    expect(sql).not.toContain("\u2014");
  });
});

describe("refreshPooledDealPriors", () => {
  beforeEach(() => {
    vi.mocked(supabaseAdmin.rpc).mockReset();
  });

  it("calls the deal refresh and does not write show stats", async () => {
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({ data: 1, error: null } as never);
    await expect(refreshPooledDealPriors()).resolves.toBe(1);
    expect(supabaseAdmin.rpc).toHaveBeenCalledWith("refresh_pooled_deal_priors");

    const src = readFileSync(join(process.cwd(), "lib/learning/pooled-deal-priors.ts"), "utf8");
    expect(src).not.toMatch(
      /from\(["'](shows|show_profiles|show_surfaces|benchmarks)["']\)\s*\.(insert|update|upsert|delete)/
    );
    expect(src).not.toContain("podscan_id");
    expect(src).not.toContain("\u2014");
  });
});

describe("approved terms line", () => {
  it("is the consent sentence on the terms page", () => {
    const page = readFileSync(join(process.cwd(), "app/terms/page.tsx"), "utf8");
    expect(page).toContain(CONSENT_LINE);
    expect(page).not.toContain("\u2014");
    expect(page).not.toMatch(/pending approval|draft/i);
    expect(page).not.toMatch(/--brand-|#[0-9a-fA-F]{3,8}/);
  });
});
