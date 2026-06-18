// Static assertions on migration 025. Migrations are pasted into the Supabase
// SQL Editor (no local Postgres in CI), so the contract is verified at the
// SQL-text level: idempotent column/index/function definitions, the security
// model (SECURITY INVOKER + pinned search_path, matching migration 024),
// service_role-only execute grants, and exception handling scoped narrowly —
// never the blunt WHEN OTHERS that would swallow genuine bugs.

import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const sql = fs.readFileSync(
  path.join(__dirname, "025_layer5_atomic_writes.sql"),
  "utf-8"
);

describe("migration 025 idempotency and conventions", () => {
  it("adds slot_position with ADD COLUMN IF NOT EXISTS", () => {
    expect(sql).toMatch(
      /ALTER TABLE ring_hypotheses\s+ADD COLUMN IF NOT EXISTS slot_position INT/i
    );
  });

  it("backfills slot_position guarded on IS NULL (idempotent re-run)", () => {
    expect(sql).toMatch(/ROW_NUMBER\(\) OVER/i);
    expect(sql).toMatch(/WHERE slot_position IS NULL/i);
  });

  it("creates the slot index only with IF NOT EXISTS", () => {
    const indexes = sql.match(/CREATE INDEX\b[^\n]*/gi) ?? [];
    expect(indexes.length).toBeGreaterThan(0);
    for (const stmt of indexes) {
      expect(stmt.toUpperCase()).toContain("IF NOT EXISTS");
    }
    expect(sql).toMatch(
      /CREATE INDEX IF NOT EXISTS idx_ring_hypotheses_slot\s+ON ring_hypotheses\(campaign_pattern_id, slot_position\)/i
    );
  });

  it("defines all three functions with CREATE OR REPLACE (idempotent)", () => {
    expect(sql).toMatch(
      /CREATE OR REPLACE FUNCTION public\.persist_interpretation/i
    );
    expect(sql).toMatch(
      /CREATE OR REPLACE FUNCTION public\.persist_refinement/i
    );
    expect(sql).toMatch(
      /CREATE OR REPLACE FUNCTION public\.persist_confirmation/i
    );
  });

  it("uses SECURITY INVOKER (matches migration 024), never SECURITY DEFINER", () => {
    // Anchor to the modifier line (not prose mentions): one per function
    // definition — interpretation + refinement + confirmation.
    const invokers = sql.match(/^SECURITY INVOKER$/gim) ?? [];
    expect(invokers.length).toBe(3);
    expect(sql).not.toMatch(/SECURITY DEFINER/i);
  });

  it("pins a safe search_path on every function", () => {
    const pins = sql.match(/SET search_path = public, pg_temp/gi) ?? [];
    expect(pins.length).toBe(3);
  });

  it("never uses the blunt WHEN OTHERS catch-all", () => {
    expect(sql).not.toMatch(/WHEN OTHERS/i);
  });

  it("persist_refinement inserts the new ring and marks the old one refined", () => {
    expect(sql).toMatch(/INSERT INTO ring_hypotheses/i);
    expect(sql).toMatch(/SET brand_decision = 'refined'/i);
  });

  it("persist_confirmation excludes refined rings and raises PT400 on validation failure", () => {
    expect(sql).toMatch(/brand_decision <> 'refined'/i);
    expect(sql).toMatch(/USING ERRCODE = 'PT400'/i);
  });

  it("grants EXECUTE to service_role only — no authenticated, no anon", () => {
    for (const fn of [
      "persist_interpretation",
      "persist_refinement",
      "persist_confirmation",
    ]) {
      expect(sql).toMatch(
        new RegExp(
          `GRANT EXECUTE ON FUNCTION public\\.${fn}[\\s\\S]*?TO service_role`,
          "i"
        )
      );
    }
    expect(sql).not.toMatch(/persist_refinement[\s\S]*?TO authenticated/i);
    expect(sql).not.toMatch(/persist_confirmation[\s\S]*?TO anon/i);
  });
});
