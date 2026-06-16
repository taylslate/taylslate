// Static assertions on migration 024. Migrations are pasted into the Supabase
// SQL Editor (no local Postgres in CI), so the contract is verified at the
// SQL-text level: idempotent function definition, service_role-only execute
// grant, and the per-analog handler scoped to foreign_key_violation (NOT the
// blunt WHEN OTHERS, which would swallow genuine insert bugs).

import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const sql = fs.readFileSync(
  path.join(__dirname, "024_layer4_atomic_persist.sql"),
  "utf-8"
);

describe("migration 024 idempotency and conventions", () => {
  it("defines the function with CREATE OR REPLACE (idempotent)", () => {
    expect(sql).toMatch(
      /CREATE OR REPLACE FUNCTION public\.persist_interpretation/i
    );
  });

  it("pins a safe search_path", () => {
    expect(sql).toMatch(/SET search_path = public, pg_temp/i);
  });

  it("grants EXECUTE to service_role only — no authenticated, no anon", () => {
    expect(sql).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.persist_interpretation[\s\S]*TO service_role/i
    );
    expect(sql).not.toMatch(/persist_interpretation[\s\S]*TO authenticated/i);
    expect(sql).not.toMatch(/persist_interpretation[\s\S]*TO anon/i);
  });

  it("scopes the per-analog handler to foreign_key_violation, never WHEN OTHERS", () => {
    expect(sql).toMatch(/EXCEPTION WHEN foreign_key_violation/i);
    expect(sql).not.toMatch(/WHEN OTHERS/i);
  });

  it("inserts into all three pattern-library tables in the one function", () => {
    expect(sql).toMatch(/INSERT INTO campaign_patterns/i);
    expect(sql).toMatch(/INSERT INTO ring_hypotheses/i);
    expect(sql).toMatch(/INSERT INTO analog_matches/i);
  });

  it("returns the pattern id and the ring-id map", () => {
    expect(sql).toMatch(/jsonb_build_object\(\s*'pattern_id'/i);
    expect(sql).toMatch(/'ring_ids'/i);
  });
});
