// Migration 091 on PGlite. Loads 001 through 090 that exist on disk,
// then 091 twice. Never uses a hosted database.
// 059, 062, 063, and 064 are absent. That gap is expected.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const sqlPath = join(__dirname, "091_ownership_decision_note.sql");
const sql = readFileSync(sqlPath, "utf8");
const statements = sql
  .split("\n")
  .filter((line) => !line.trim().startsWith("--"))
  .join("\n");

const USER_A = "11111111-1111-4111-8111-111111111111";
const USER_B = "22222222-2222-4222-8222-222222222222";
const SHOW = "a1111111-1111-4111-8111-111111111111";
const PROOF_A = "b1111111-1111-4111-8111-111111111111";
const PROOF_B = "b2222222-2222-4222-8222-222222222222";

function migrationFiles(max: number): string[] {
  return readdirSync(__dirname)
    .filter((name) => /^\d{3}_.+\.sql$/.test(name))
    .map((name) => ({ name, n: Number(name.slice(0, 3)) }))
    .filter((row) => row.n >= 1 && row.n <= max)
    .sort((a, b) => a.n - b.n || a.name.localeCompare(b.name))
    .map((row) => join(__dirname, row.name));
}

describe("migration 091 sql", () => {
  it("adds decision_note, restates the 061 grants, and does not add a table", () => {
    expect(sql).toContain("NOT applied. Apply on ldtmhafewfifdizgfrnn only after merge");
    expect(sql).toContain("Ownership review needs migration 091.");
    expect(sql).toContain("It is safe to deploy before 091.");
    expect(sql).toContain("falls back to the");
    expect(sql).not.toContain("before or after the O4 deploy");
    expect(sql).toContain("select column_name");
    expect(sql).toContain("information_schema.role_table_grants");
    expect(statements).toMatch(/add column if not exists decision_note text/i);
    expect(statements).toMatch(/drop constraint if exists show_ownership_proofs_decision_note_check/i);
    expect(statements).toMatch(
      /check \(decision_note is null or char_length\(decision_note\) between 1 and 500\)/i
    );
    expect(statements).toMatch(
      /grant select, insert, update, delete on table public\.show_ownership_proofs to service_role;/i
    );
    expect(statements).toMatch(/grant select on table public\.show_ownership_proofs to authenticated;/i);
    expect(statements).toMatch(/revoke all on table public\.show_ownership_proofs from anon;/i);
    expect(statements).toMatch(/revoke all on table public\.show_ownership_proofs from public;/i);
    expect(statements).not.toMatch(/create table/i);
    expect(statements).not.toMatch(/create policy/i);
    expect(statements).not.toMatch(/create function/i);
    expect(statements).not.toMatch(/grant\s+[a-z,\s]+\s+on\s+(?:table\s+)?public\.show_ownership_proofs\s+to\s+anon\b/i);
  });
});

const prelude = `
create schema if not exists auth;
create table if not exists auth.users (
  id uuid primary key,
  email text
);
create or replace function auth.uid()
returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
create or replace function auth.role()
returns text language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), 'anon')
$$;
create schema if not exists storage;
create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text
);
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin bypassrls;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'supabase_admin') then
    create role supabase_admin nologin bypassrls;
  end if;
end $$;
create table if not exists public.show_claims (id uuid primary key default gen_random_uuid());
create table if not exists public.outcomes (id uuid primary key default gen_random_uuid());
grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
grant execute on function auth.role() to anon, authenticated, service_role;
`;

describe("migration 091 on PGlite", () => {
  const db = new PGlite();

  async function attempt(role: string, statement: string): Promise<string> {
    await db.exec(`set role ${role}`);
    try {
      await db.exec(statement);
      return "allowed";
    } catch (err) {
      return err instanceof Error ? err.message : String(err);
    } finally {
      await db.exec("reset role");
    }
  }

  async function asAuthenticated(userId: string, statement: string): Promise<string> {
    await db.exec(`select set_config('request.jwt.claim.sub', '${userId}', false)`);
    await db.exec(`select set_config('request.jwt.claim.role', 'authenticated', false)`);
    await db.exec("set role authenticated");
    try {
      const result = await db.query<{ value: string }>(statement);
      return result.rows.map((row) => row.value).join("|");
    } catch (err) {
      return err instanceof Error ? err.message : String(err);
    } finally {
      await db.exec("reset role");
      await db.exec(`select set_config('request.jwt.claim.sub', '', false)`);
      await db.exec(`select set_config('request.jwt.claim.role', '', false)`);
    }
  }

  beforeAll(async () => {
    await db.exec(prelude);
    for (const path of migrationFiles(90)) {
      if (path.endsWith("068_past_campaign_show_match.sql")) {
        await db.exec("alter table public.shows add column if not exists agent_id uuid;");
      }
      try {
        await db.exec(readFileSync(path, "utf8"));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        throw new Error(`${path}\n${message}`);
      }
    }
    await db.exec(sql);
    await db.exec(sql);
    await db.exec(`
      insert into auth.users (id, email) values
        ('${USER_A}', 'owner-a@example.com'),
        ('${USER_B}', 'owner-b@example.com');
      insert into public.profiles (id, email, role) values
        ('${USER_A}', 'owner-a@example.com', 'show'),
        ('${USER_B}', 'owner-b@example.com', 'show');
      insert into public.shows (id, name, platform, is_discoverable, data_sources, contact_email)
        values ('${SHOW}', 'Odd Lots', 'podcast', true, '{}', null);
      insert into public.show_ownership_proofs (id, show_id, user_id, method, status, decision_note)
        values
          ('${PROOF_A}', '${SHOW}', '${USER_A}', 'admin', 'contested', 'Owner A reason'),
          ('${PROOF_B}', '${SHOW}', '${USER_B}', 'rss_code', 'expired', 'Owner B reason');
    `);
  }, 300_000);

  afterAll(async () => {
    await db.close();
  });

  it("adds the column and refuses a 501-character note", async () => {
    const column = await db.query<{ column_name: string }>(`
      select column_name
        from information_schema.columns
       where table_schema = 'public'
         and table_name = 'show_ownership_proofs'
         and column_name = 'decision_note'
    `);
    expect(column.rows).toHaveLength(1);
    const checks = await db.query<{ count: string }>(`
      select count(*)::text as count
        from pg_constraint
       where conname = 'show_ownership_proofs_decision_note_check'
    `);
    expect(checks.rows[0].count).toBe("1");
    const tooLong = await attempt(
      "service_role",
      `update public.show_ownership_proofs set decision_note = repeat('n', 501) where id = '${PROOF_A}'`
    );
    expect(tooLong).toMatch(/show_ownership_proofs_decision_note_check|check constraint/i);
    const empty = await attempt(
      "service_role",
      `update public.show_ownership_proofs set decision_note = '' where id = '${PROOF_A}'`
    );
    expect(empty).toMatch(/show_ownership_proofs_decision_note_check|check constraint/i);
    const fiveHundred = await attempt(
      "service_role",
      `update public.show_ownership_proofs set decision_note = repeat('n', 500) where id = '${PROOF_A}'`
    );
    expect(fiveHundred).toBe("allowed");
    const ok = await attempt(
      "service_role",
      `update public.show_ownership_proofs set decision_note = 'Owner A reason' where id = '${PROOF_A}'`
    );
    expect(ok).toBe("allowed");
  });

  it("keeps the 061 grants", async () => {
    const grants = await db.query<{ grantee: string; privilege_type: string }>(`
      select grantee, privilege_type
        from information_schema.role_table_grants
       where table_schema = 'public'
         and table_name = 'show_ownership_proofs'
         and grantee in ('anon', 'authenticated', 'service_role', 'public')
       order by grantee, privilege_type
    `);
    expect(grants.rows).toEqual([
      { grantee: "authenticated", privilege_type: "SELECT" },
      { grantee: "service_role", privilege_type: "DELETE" },
      { grantee: "service_role", privilege_type: "INSERT" },
      { grantee: "service_role", privilege_type: "SELECT" },
      { grantee: "service_role", privilege_type: "UPDATE" },
    ]);
  });

  it("lets an owner read only their own decision note, and blocks anon and updates", async () => {
    const anon = await attempt("anon", "select decision_note from public.show_ownership_proofs");
    expect(anon).toMatch(/permission denied/i);
    const own = await asAuthenticated(
      USER_A,
      "select decision_note as value from public.show_ownership_proofs order by decision_note"
    );
    expect(own).toBe("Owner A reason");
    expect(own).not.toContain("Owner B reason");
    const denied = await attempt(
      "authenticated",
      `update public.show_ownership_proofs set decision_note = 'nope' where id = '${PROOF_A}'`
    );
    expect(denied).toMatch(/permission denied/i);
  });
});
