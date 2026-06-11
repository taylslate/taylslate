// Static idempotency assertions on migration 022. Migrations are pasted
// into the Supabase SQL Editor (no local Postgres in CI), so the contract
// is verified at the SQL-text level: every statement must follow the
// idempotent patterns in CLAUDE.md and carry the required Data API grants.

import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const sql = fs.readFileSync(
  path.join(__dirname, "022_layer4_amendments.sql"),
  "utf-8"
);

describe("migration 022 idempotency and conventions", () => {
  it("creates tables only with IF NOT EXISTS", () => {
    const creates = sql.match(/CREATE TABLE\b[^(]*/gi) ?? [];
    expect(creates.length).toBeGreaterThan(0);
    for (const stmt of creates) {
      expect(stmt.toUpperCase()).toContain("IF NOT EXISTS");
    }
  });

  it("adds columns only with IF NOT EXISTS", () => {
    const adds = sql.match(/ADD COLUMN\b[^\n]*/gi) ?? [];
    expect(adds.length).toBeGreaterThan(0);
    for (const stmt of adds) {
      expect(stmt.toUpperCase()).toContain("IF NOT EXISTS");
    }
  });

  it("creates indexes only with IF NOT EXISTS", () => {
    const indexes = sql.match(/CREATE INDEX\b[^\n]*/gi) ?? [];
    expect(indexes.length).toBeGreaterThan(0);
    for (const stmt of indexes) {
      expect(stmt.toUpperCase()).toContain("IF NOT EXISTS");
    }
  });

  it("drops every policy before recreating it", () => {
    const created = [...sql.matchAll(/CREATE POLICY\s+"([^"]+)"/gi)].map(
      (m) => m[1]
    );
    expect(created.length).toBeGreaterThan(0);
    for (const name of created) {
      expect(sql).toMatch(new RegExp(`DROP POLICY IF EXISTS\\s+"${name}"`, "i"));
    }
  });

  it("adds analog_pattern_id with an FK to campaign_patterns", () => {
    expect(sql).toMatch(
      /ADD COLUMN IF NOT EXISTS analog_pattern_id UUID\s+REFERENCES campaign_patterns\(id\) ON DELETE SET NULL/i
    );
  });

  it("creates interpretation_locks with the composite primary key", () => {
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS interpretation_locks/i);
    expect(sql).toMatch(/PRIMARY KEY \(campaign_id, brief_submitted_at\)/i);
  });

  it("grants interpretation_locks to service_role only — no anon, no authenticated", () => {
    expect(sql).toMatch(
      /grant select, insert, update, delete on public\.interpretation_locks to service_role/i
    );
    expect(sql).not.toMatch(/interpretation_locks to anon/i);
    expect(sql).not.toMatch(/interpretation_locks to authenticated/i);
  });

  it("enables RLS on interpretation_locks", () => {
    expect(sql).toMatch(
      /ALTER TABLE interpretation_locks ENABLE ROW LEVEL SECURITY/i
    );
  });
});
