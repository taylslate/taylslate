// Static assertions on migration 050. Migrations are pasted into the
// Supabase SQL Editor (no local Postgres in CI), so the contract is
// the SQL text: user_owns_show no longer treats a matching podscan id
// as ownership, and execute stays limited to authenticated and
// service_role. 046 stays the podscan trigger.

import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";

const sql = fs.readFileSync(
  path.join(__dirname, "050_user_owns_show_drop_podscan.sql"),
  "utf-8"
);

describe("migration 050 user_owns_show", () => {
  it("recreates the function without a podscan id ownership check", () => {
    expect(sql).toMatch(/create or replace function public\.user_owns_show\(target_show uuid\)/i);
    expect(sql).toMatch(/security invoker/i);
    expect(sql).toMatch(/set search_path = public/i);
    expect(sql).toMatch(/from public\.deals d/i);
    expect(sql).toMatch(/sp\.user_id = auth\.uid\(\)/i);
    expect(sql).toMatch(/'show_owner' = any \(s\.data_sources\)/i);
    expect(sql).toMatch(/lower\(s\.contact_email\) = lower\(p\.email\)/i);
    const body = sql.slice(sql.indexOf("as $$"), sql.lastIndexOf("$$"));
    expect(body).not.toMatch(/podscan_id/i);
  });

  it("does not touch the 046 trigger", () => {
    expect(sql).not.toMatch(/show_profiles_guard_podscan_id/i);
    expect(sql).not.toMatch(/create trigger/i);
  });

  it("revokes execute from public and anon and grants authenticated and service_role", () => {
    expect(sql).toMatch(
      /revoke all on function public\.user_owns_show\(uuid\) from public;/i
    );
    expect(sql).toMatch(
      /revoke all on function public\.user_owns_show\(uuid\) from anon;/i
    );
    expect(sql).toMatch(
      /grant execute on function public\.user_owns_show\(uuid\) to authenticated;/i
    );
    expect(sql).toMatch(
      /grant execute on function public\.user_owns_show\(uuid\) to service_role;/i
    );
    expect(sql).not.toMatch(/to anon/i);
  });
});
