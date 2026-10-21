// Static assertions on migration 047. Migrations are pasted into the
// Supabase SQL Editor (no local Postgres in CI), so the contract is
// the SQL text.

import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";

const sql = fs.readFileSync(
  path.join(__dirname, "047_campaign_learning.sql"),
  "utf-8"
);

function policy(name: string): string {
  const start = sql.indexOf(`create policy "${name}"`);
  const rest = sql.slice(start);
  const end = rest.indexOf("drop policy if exists");
  return end === -1 ? rest : rest.slice(0, end);
}

describe("migration 047 campaign learning", () => {
  it("revokes public and anon on both tables", () => {
    expect(sql).toMatch(
      /revoke all on table public\.deal_conversion_reports from public;/i
    );
    expect(sql).toMatch(
      /revoke all on table public\.learning_overrides from public;/i
    );
    expect(sql).toMatch(/revoke all on public\.deal_conversion_reports from anon;/i);
    expect(sql).toMatch(/revoke all on public\.learning_overrides from anon;/i);
    expect(sql).not.toMatch(
      /grant\s+[a-z,\s]+\s+on\s+(?:table\s+)?public\.(?:deal_conversion_reports|learning_overrides)\s+to\s+anon/i
    );
    expect(sql).not.toMatch(
      /grant\s+[a-z,\s]+\s+on\s+(?:table\s+)?public\.(?:deal_conversion_reports|learning_overrides)\s+to\s+public/i
    );
  });

  it("repeats the brand and rep insert checks on update", () => {
    const update = policy("Author updates own learning overrides");
    const brand = policy("Brand inserts own learning overrides");
    const rep = policy("Rep inserts own learning overrides");
    expect(update).toMatch(/using \(author_id = auth\.uid\(\)\)/i);
    expect(update).toMatch(/author_role = 'brand'/);
    expect(update).toMatch(/c\.user_id = auth\.uid\(\)/);
    expect(update).toMatch(/author_role = 'rep'/);
    expect(update).toMatch(/a\.show_id::text = learning_overrides\.target_key/);
    expect(update).toMatch(/d\.agent_id = auth\.uid\(\)/);
    expect(brand).toMatch(/author_role = 'brand'/);
    expect(rep).toMatch(/author_role = 'rep'/);
    expect(update).not.toMatch(/with check \(author_id = auth\.uid\(\)\);/i);
  });
});
