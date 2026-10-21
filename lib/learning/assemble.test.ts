import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { assembleLearningInput, type AssembleLearningInput } from "./assemble";

function raw(over: Partial<AssembleLearningInput> = {}): AssembleLearningInput {
  return {
    campaignStatus: "active",
    brandWebsite: "https://saunabox.com",
    deals: [
      {
        id: "deal-1",
        show_id: "catalog-show",
        outreach_id: "out-1",
        status: "completed",
        promo_code: "SAUNA25",
        reader_type: "host_read",
        agreed_placement: "mid-roll",
      },
    ],
    outreaches: [{ id: "out-1", show_name: "Wrong Name From Outreach" }],
    shows: [{ id: "catalog-show", name: "Catalog Show" }],
    ios: [{ id: "io-1", deal_id: "deal-1" }],
    lines: [
      {
        id: "line-1",
        io_id: "io-1",
        placement: "mid-roll",
        reader_type: "host_read",
        spot_format: null,
        verified: false,
      },
    ],
    airchecks: [
      {
        io_line_item_id: "line-1",
        review_decision: "confirmed",
        match_evidence: { code_or_url: "found", excerpt: "secret transcript bit" },
      },
    ],
    scores: [
      {
        show_id: "catalog-show",
        ring_hypothesis_id: "ring-1",
        composite_score: 64,
        tier: "test",
      },
      {
        show_id: "scale-show",
        ring_hypothesis_id: "ring-1",
        composite_score: 22,
        tier: "scale",
      },
    ],
    rings: [{ id: "ring-1", label: "Recovery", brand_decision: "confirmed" }],
    reports: [{ deal_id: "deal-1", reported_conversions: 3 }],
    overrides: [],
    ...over,
  };
}

describe("assembleLearningInput", () => {
  it("links the deal to the catalog show id, not an outreach name", () => {
    const input = assembleLearningInput(raw());
    expect(input.deals[0].showId).toBe("catalog-show");
    expect(input.deals[0].showName).toBe("Catalog Show");
    expect(input.deals[0].aired).toBe(true);
    expect(input.deals[0].codeOnAir).toBe("found");
    expect(input.deals[0].reportedConversions).toBe(3);
    expect(input.deals[0].trackingLink).toContain("utm_source=podcast");
    expect(input.scaleShows.map((show) => show.showId)).toEqual(["scale-show"]);
    expect(JSON.stringify(input)).not.toContain("secret transcript bit");
  });

  it("keeps the catalog show id when the shows row has no name", () => {
    const input = assembleLearningInput(
      raw({
        shows: [],
      })
    );
    expect(input.deals[0].showId).toBe("catalog-show");
    expect(input.deals[0].showName).toBe("Wrong Name From Outreach");
  });

  it("drops a non-numeric conversion report instead of inventing a count", () => {
    const input = assembleLearningInput(
      raw({ reports: [{ deal_id: "deal-1", reported_conversions: Number.NaN }] })
    );
    expect(input.deals[0].reportedConversions).toBeNull();
  });
});

describe("learning modules stay off podscan and the closed money paths", () => {
  const root = join(process.cwd(), "lib/learning");
  const files = readdirSync(root).filter(
    (name) => name.endsWith(".ts") && !name.endsWith(".test.ts")
  );

  it("never reads show_profiles.podscan_id or a transcript body", () => {
    for (const name of files) {
      const src = readFileSync(join(root, name), "utf8");
      expect(src, name).not.toMatch(/podscan_id/);
      expect(src, name).not.toMatch(/transcript_text/);
      expect(src, name).not.toMatch(/from ["']@\/lib\/(stripe|payouts|billing|airchecks)/);
    }
  });
});
