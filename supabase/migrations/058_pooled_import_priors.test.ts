// Static assertions on migration 058. Migrations are pasted into the
// Supabase SQL Editor (no local Postgres in CI), so the contract is
// the SQL text: service_role only, k >= 5, consent and confirmed
// filters, and no brand identifier on the pooled table.

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  join(__dirname, "058_pooled_import_priors.sql"),
  "utf8"
);

const statements = sql
  .split("\n")
  .filter((line) => !line.trim().startsWith("--"))
  .join("\n");

function tableBody(): string {
  const start = statements.search(/create table if not exists public\.pooled_import_priors/i);
  expect(start).toBeGreaterThanOrEqual(0);
  const end = statements.indexOf(";", start);
  return statements.slice(start, end);
}

describe("migration 058 pooled import priors", () => {
  it("is not applied and documents introspection", () => {
    expect(sql).toContain(
      "NOT applied. Apply on ldtmhafewfifdizgfrnn only after merge and Chris's OK."
    );
    expect(sql).toContain(
      "Do not run the refresh from a deploy hook or cron in this job."
    );
    expect(sql).toContain("information_schema.role_table_grants");
    expect(sql).toContain("information_schema.routine_privileges");
    expect(sql).toContain("pg_policies");
    expect(statements).not.toMatch(/cron\.schedule|pg_cron/i);
  });

  it("creates only the anonymized prior table, with no brand identifier", () => {
    const created = [
      ...statements.matchAll(/create table if not exists public\.([a-z_]+)/gi),
    ].map((match) => match[1]);
    expect(created).toEqual(["pooled_import_priors"]);

    const body = tableBody();
    expect(body).toMatch(/category\s+text not null/i);
    expect(body).toMatch(/placement\s+text/i);
    expect(body).toMatch(/price_type\s+text/i);
    expect(body).toMatch(/brand_count\s+integer not null/i);
    expect(body).toMatch(/record_count\s+integer not null/i);
    expect(body).toMatch(/median_cpm\s+numeric/i);
    expect(body).toMatch(/median_conversions_per_1k_downloads\s+numeric/i);
    expect(body).toMatch(/refreshed_at\s+timestamptz not null/i);
    expect(body).not.toMatch(/\bbrand_id\b|\bimport_id\b|\bshow_id\b|\bmatched_show_id\b|\brecord_id\b|\buser_id\b|\bpodscan_id\b/i);

    const insert = statements.match(
      /insert into public\.pooled_import_priors \(([\s\S]*?)\)/i
    );
    expect(insert?.[1] ?? "").not.toMatch(/brand_id|import_id|show_id|record_id|user_id/);
  });

  it("requires at least 5 brands and a unique group key", () => {
    expect(statements).toMatch(/check \(brand_count >= 5\)/i);
    expect(statements).toMatch(
      /unique nulls not distinct \(category, placement, price_type\)/i
    );
    expect(statements).toMatch(/having count\(distinct rec\.brand_id\) >= 5/i);
  });

  it("rebuilds from confirmed consented imports and skips unmatched rows", () => {
    expect(statements).toMatch(/where imp\.status = 'confirmed'/i);
    expect(statements).toMatch(/and imp\.pooling_consent = true/i);
    expect(statements).toMatch(/and rec\.matched_show_id is not null/i);
    expect(statements).toMatch(/join public\.shows sh/i);
    expect(statements).toMatch(/unnest\(coalesce\(sh\.categories, '\{\}'::text\[\]\)\)/i);
    expect(statements).toMatch(/security invoker/i);
    expect(statements).toMatch(/set search_path = public/i);
    expect(statements).not.toMatch(/security definer/i);
  });

  it("writes only pooled_import_priors", () => {
    const writes = [
      ...statements.matchAll(/\b(insert into|update|delete from)\s+public\.([a-z_]+)/gi),
    ].map((match) => match[2]);
    expect(writes).toEqual(["pooled_import_priors", "pooled_import_priors"]);
    expect(statements).not.toMatch(/alter table public\.shows\b/i);
    expect(statements).not.toMatch(/alter table public\.show_profiles\b/i);
    expect(statements).not.toMatch(/alter table public\.show_surfaces\b/i);
    expect(statements).not.toMatch(/alter table public\.benchmarks\b/i);
    expect(statements).not.toMatch(/\b(insert into|update|delete from)\s+public\.(shows|show_profiles|show_surfaces|benchmarks)\b/i);
  });

  it("enables RLS with no authenticated policy", () => {
    expect(statements).toMatch(
      /alter table public\.pooled_import_priors enable row level security;/i
    );
    expect(statements).not.toMatch(/create policy/i);
    expect(statements).not.toMatch(/using \(true\)/i);
  });

  it("grants DML and execute to service_role only, and revokes everyone else", () => {
    expect(statements).toMatch(
      /grant select, insert, update, delete on public\.pooled_import_priors to service_role;/i
    );
    expect(statements).toMatch(
      /revoke all on table public\.pooled_import_priors from public;/i
    );
    expect(statements).toMatch(
      /revoke all on table public\.pooled_import_priors from anon;/i
    );
    expect(statements).toMatch(
      /revoke all on table public\.pooled_import_priors from authenticated;/i
    );
    expect(statements).toMatch(
      /revoke truncate, references, trigger on table public\.pooled_import_priors from authenticated;/i
    );
    expect(statements).not.toMatch(
      /grant\s+[a-z,\s]+\s+on\s+(?:table\s+)?public\.pooled_import_priors\s+to\s+authenticated\b/i
    );
    expect(statements).not.toMatch(
      /grant\s+[a-z,\s]+\s+on\s+(?:table\s+)?public\.pooled_import_priors\s+to\s+anon\b/i
    );
    expect(statements).not.toMatch(
      /grant\s+[a-z,\s]+\s+on\s+(?:table\s+)?public\.pooled_import_priors\s+to\s+public\b/i
    );

    expect(statements).toMatch(
      /grant execute on function public\.refresh_pooled_import_priors\(\) to service_role;/i
    );
    expect(statements).toMatch(
      /revoke all on function public\.refresh_pooled_import_priors\(\) from public;/i
    );
    expect(statements).toMatch(
      /revoke all on function public\.refresh_pooled_import_priors\(\) from anon;/i
    );
    expect(statements).toMatch(
      /revoke all on function public\.refresh_pooled_import_priors\(\) from authenticated;/i
    );
    expect(statements).not.toMatch(
      /grant execute on function public\.refresh_pooled_import_priors\(\) to (authenticated|anon|public)/i
    );
  });
});

describe("import learning code does not write public show stats", () => {
  it("never inserts, updates, or deletes shows, profiles, surfaces, or benchmarks", () => {
    const roots = [join(process.cwd(), "lib/learning"), join(process.cwd(), "lib/scoring")];
    const files = roots.flatMap((root) => listTs(root));
    const write =
      /from\(["'](shows|show_profiles|show_surfaces|benchmarks)["']\)\s*\.(insert|update|upsert|delete)/;
    for (const file of files) {
      if (file.endsWith(".test.ts")) continue;
      const src = readFileSync(file, "utf8");
      expect(src, file).not.toMatch(write);
    }
  });
});

function listTs(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, name.name);
    if (name.isDirectory()) out.push(...listTs(full));
    else if (name.name.endsWith(".ts")) out.push(full);
  }
  return out;
}
