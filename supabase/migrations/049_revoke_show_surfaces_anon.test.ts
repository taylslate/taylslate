// Static assertions on migration 049. Migrations are pasted into the
// Supabase SQL Editor (no local Postgres in CI), so the contract is
// the SQL text: anon is revoked, authenticated and service_role keep
// DML, and the 044 policies are re-stated.

import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";

const sql = fs.readFileSync(
  path.join(__dirname, "049_revoke_show_surfaces_anon.sql"),
  "utf-8"
);

describe("migration 049 revoke anon on show_surfaces", () => {
  it("revokes anon and public table privileges", () => {
    expect(sql).toMatch(
      /revoke all privileges on table public\.show_surfaces from anon;/i
    );
    expect(sql).toMatch(
      /revoke all privileges on table public\.show_surfaces from public;/i
    );
    expect(sql).not.toMatch(/grant\s+[a-z,\s]+\s+on\s+public\.show_surfaces\s+to\s+anon/i);
  });

  it("re-asserts service_role and authenticated grants", () => {
    expect(sql).toMatch(
      /grant select, insert, update, delete on public\.show_surfaces to service_role;/i
    );
    expect(sql).toMatch(
      /grant select, insert, update, delete on public\.show_surfaces to authenticated;/i
    );
  });

  it("enables RLS and restates the three 044 policies", () => {
    expect(sql).toMatch(/alter table public\.show_surfaces enable row level security;/i);
    expect(sql).toMatch(/drop policy if exists "Show owner manages own surfaces"/i);
    expect(sql).toMatch(/drop policy if exists "Buyers read published surfaces"/i);
    expect(sql).toMatch(/drop policy if exists "Service role manages show surfaces"/i);
    expect(sql).toMatch(/create policy "Show owner manages own surfaces"/i);
    expect(sql).toMatch(/create policy "Buyers read published surfaces"/i);
    expect(sql).toMatch(/create policy "Service role manages show surfaces"/i);
    expect(sql).toMatch(/to authenticated/i);
    expect(sql).toMatch(/to service_role/i);
  });
});
