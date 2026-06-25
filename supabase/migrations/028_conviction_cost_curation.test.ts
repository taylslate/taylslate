// Static assertions on migration 028. Migrations are pasted into the Supabase
// SQL Editor (no local Postgres in CI), so the contract is verified at the
// SQL-text level: idempotent column/constraint/index definitions, the
// controlled-vocabulary check on cost_basis, and NO new grant block (the
// columns hang off conviction_scores, whose grants land in migration 020 and
// cover columns added later — and conviction_scores is sensitive, never anon).

import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const sql = fs.readFileSync(
  path.join(__dirname, "028_conviction_cost_curation.sql"),
  "utf-8"
);

describe("migration 028 idempotency and conventions", () => {
  const costCols = [
    "per_spot_cents",
    "three_spot_cents",
    "cpm_used_cents",
    "cost_basis",
    "cost_is_estimate",
    "needs_quote",
    "brand_saved",
    "brand_dismissed",
  ];

  it("adds all 8 cost + curation columns with ADD COLUMN IF NOT EXISTS", () => {
    for (const col of costCols) {
      expect(sql).toMatch(
        new RegExp(`add column if not exists\\s+${col}\\b`, "i")
      );
    }
  });

  it("targets public.conviction_scores", () => {
    expect(sql).toMatch(/alter table public\.conviction_scores/i);
  });

  it("defaults the boolean curation/quote flags to false", () => {
    expect(sql).toMatch(/needs_quote\s+boolean default false/i);
    expect(sql).toMatch(/brand_saved\s+boolean default false/i);
    expect(sql).toMatch(/brand_dismissed\s+boolean default false/i);
  });

  it("redefines the cost_basis check constraint with DROP-then-ADD (idempotent)", () => {
    expect(sql).toMatch(
      /drop constraint if exists conviction_scores_cost_basis_chk/i
    );
    expect(sql).toMatch(
      /add\s+constraint conviction_scores_cost_basis_chk/i
    );
  });

  it("constrains cost_basis to the controlled vocabulary (null allowed)", () => {
    expect(sql).toMatch(
      /check \(cost_basis is null or cost_basis in \('derived','flat_fee','rate_card'\)\)/i
    );
  });

  it("creates the pattern+tier lookup index only with IF NOT EXISTS", () => {
    const indexes = sql.match(/create index\b[^\n;]*/gi) ?? [];
    expect(indexes.length).toBeGreaterThan(0);
    for (const stmt of indexes) {
      expect(stmt.toUpperCase()).toContain("IF NOT EXISTS");
    }
    expect(sql).toMatch(
      /create index if not exists conviction_scores_pattern_tier_idx\s+on public\.conviction_scores \(campaign_pattern_id, tier\)/i
    );
  });

  it("adds NO new grant block (columns inherit migration 020 table grants; never anon)", () => {
    expect(sql).not.toMatch(/\bgrant\b/i);
    expect(sql).not.toMatch(/to anon/i);
  });
});
