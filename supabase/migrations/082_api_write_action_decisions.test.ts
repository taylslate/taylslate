// Static assertions on migration 082, plus a PGlite apply of the
// on-disk migrations through 082. 059, 062, 063, 064, 080, and 081
// are absent. That gap is expected. 082 is applied twice.
// Never uses a hosted database.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const sqlPath = join(__dirname, "082_api_write_action_decisions.sql");
const sql = readFileSync(sqlPath, "utf8");
const statements = sql
  .split("\n")
  .filter((line) => !line.trim().startsWith("--"))
  .join("\n");

function migrationFiles(): string[] {
  return readdirSync(__dirname)
    .filter((name) => /^\d{3}_.+\.sql$/.test(name))
    .map((name) => ({ name, n: Number(name.slice(0, 3)) }))
    .filter((row) => row.n >= 1 && row.n <= 82)
    .sort((a, b) => a.n - b.n || a.name.localeCompare(b.name))
    .map((row) => join(__dirname, row.name));
}

describe("migration 082 api write action decisions", () => {
  it("is not applied and documents the grant and policy introspection", () => {
    expect(sql).toContain("NOT applied. Apply only after merge and Chris's OK.");
    expect(sql).toContain("information_schema.role_table_grants");
    expect(sql).toContain("relrowsecurity");
    expect(sql).toContain("pg_policies");
    expect(sql).toContain("082");
    expect(statements).not.toMatch(/create policy/i);
    expect(statements).not.toMatch(/security definer/i);
    expect(statements).not.toMatch(/insert into/i);
  });

  it("adds only the decision and execution columns on api_write_actions", () => {
    expect(statements).not.toMatch(/create table/i);
    expect(statements).toMatch(/add column if not exists decision_note text/i);
    expect(statements).toMatch(/add column if not exists execution_started_at timestamptz/i);
    expect(statements).toMatch(/add column if not exists executed_at timestamptz/i);
    expect(statements).toMatch(/add column if not exists result_campaign_id uuid/i);
    expect(statements).toMatch(/add column if not exists execution_error text/i);
    expect(statements).toMatch(
      /foreign key \(result_campaign_id\) references public\.campaigns\(id\) on delete set null/i
    );
    expect(statements).toMatch(
      /check \(decision_note is null or char_length\(decision_note\) <= 500\)/i
    );
    expect(statements).toMatch(
      /check \(execution_error is null or char_length\(execution_error\) <= 300\)/i
    );
    expect(statements).toMatch(
      /status not in \('approved', 'rejected'\)\s+or \(decided_by is not null and decided_at is not null\)/i
    );
  });

  it("keeps RLS with no policies and grants only service_role", () => {
    expect(statements).toMatch(
      /alter table public\.api_write_actions enable row level security;/i
    );
    const rlsAt = statements.search(
      /alter table public\.api_write_actions enable row level security/i
    );
    const grantAt = statements
      .toLowerCase()
      .indexOf("grant all on table public.api_write_actions to service_role;");
    expect(grantAt).toBeGreaterThanOrEqual(0);
    expect(grantAt).toBeLessThan(rlsAt);
    expect(statements).toMatch(/revoke all on table public\.api_write_actions from public;/i);
    expect(statements).toMatch(/revoke all on table public\.api_write_actions from anon;/i);
    expect(statements).toMatch(
      /revoke all on table public\.api_write_actions from authenticated;/i
    );
    expect(statements).toMatch(
      /revoke truncate, references, trigger on table public\.api_write_actions from authenticated;/i
    );
    expect(statements).not.toMatch(/\bto anon\b/i);
    expect(statements).not.toMatch(/\bto authenticated\b/i);
    expect(statements).not.toMatch(/\bto public\b/i);
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
`;

describe("migration 082 on PGlite", () => {
  const db = new PGlite();

  async function query(statement: string): Promise<string> {
    const result = await db.query<{ value: string | null }>(statement);
    return (result.rows[0]?.value ?? "").trim();
  }

  beforeAll(async () => {
    await db.exec(prelude);
    for (const path of migrationFiles()) {
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
  }, 180_000);

  afterAll(async () => {
    await db.close();
  });

  it("keeps the new columns, checks, RLS, and zero policies after a second apply", async () => {
    expect(await query(`
      select c.relrowsecurity::text as value
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relname = 'api_write_actions';
    `)).toBe("true");
    expect(await query(`
      select count(*)::text as value from pg_policies
       where schemaname = 'public' and tablename = 'api_write_actions';
    `)).toBe("0");
    expect(await query(`
      select string_agg(column_name, ',' order by column_name) as value
        from information_schema.columns
       where table_schema = 'public'
         and table_name = 'api_write_actions'
         and column_name in (
           'decision_note', 'execution_started_at', 'executed_at',
           'result_campaign_id', 'execution_error'
         );
    `)).toBe("decision_note,executed_at,execution_error,execution_started_at,result_campaign_id");
    expect(await query(`
      select string_agg(conname, ',' order by conname) as value
        from pg_constraint
       where conrelid = 'public.api_write_actions'::regclass
         and conname in (
           'api_write_actions_decision_note_len_check',
           'api_write_actions_decision_present_check',
           'api_write_actions_execution_error_len_check',
           'api_write_actions_result_campaign_id_fkey'
         );
    `)).toBe(
      [
        "api_write_actions_decision_note_len_check",
        "api_write_actions_decision_present_check",
        "api_write_actions_execution_error_len_check",
        "api_write_actions_result_campaign_id_fkey",
      ].join(",")
    );
  });

  it("grants service_role only", async () => {
    const grants = await query(`
      select coalesce(string_agg(grantee || ' ' || privilege_type, ',' order by grantee, privilege_type), '') as value
        from information_schema.role_table_grants
       where table_schema = 'public'
         and table_name = 'api_write_actions'
         and grantee in ('anon', 'PUBLIC', 'authenticated', 'service_role');
    `);
    expect(grants).not.toMatch(/anon|PUBLIC|authenticated/);
    expect(grants).toContain("service_role INSERT");
    expect(grants).toContain("service_role UPDATE");
    const outsiders = await query(`
      select count(*)::text as value
        from information_schema.role_table_grants
       where table_schema = 'public'
         and table_name = 'api_write_actions'
         and grantee in ('anon', 'PUBLIC', 'authenticated');
    `);
    expect(outsiders).toBe("0");
  });

  it("requires a decider on approved and rejected rows and caps the note", async () => {
    const brand = "11111111-1111-4111-8111-111111111111";
    await db.exec(`
      insert into auth.users (id, email) values ('${brand}', 'brand@example.com');
      insert into public.profiles (id, email, role)
      values ('${brand}', 'brand@example.com', 'brand');
      insert into public.api_keys (brand_id, prefix, key_hash, scopes)
      values (
        '${brand}',
        '0123456789abcdef',
        '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
        array['write:campaigns']
      );
    `);
    const keyId = await query(`select id::text as value from public.api_keys limit 1;`);
    await db.exec(`
      insert into public.api_write_actions (
        brand_id, api_key_id, kind, payload, payload_hash, idempotency_key
      ) values (
        '${brand}', '${keyId}', 'campaign.create', '{}'::jsonb, 'abc', 'idem-1'
      );
    `);
    const approved = await db.exec(`
      update public.api_write_actions set status = 'approved';
    `).then(
      () => "allowed",
      () => "rejected"
    );
    expect(approved).toBe("rejected");
    await db.exec(`
      update public.api_write_actions
         set status = 'approved',
             decided_by = '${brand}',
             decided_at = now();
    `);
    const longNote = await db.exec(`
      update public.api_write_actions set decision_note = repeat('a', 501);
    `).then(
      () => "allowed",
      () => "rejected"
    );
    expect(longNote).toBe("rejected");
    const longError = await db.exec(`
      update public.api_write_actions set execution_error = repeat('b', 301);
    `).then(
      () => "allowed",
      () => "rejected"
    );
    expect(longError).toBe("rejected");
    await db.exec(`
      update public.api_write_actions
         set status = 'expired', decided_by = null, decided_at = null;
    `);
    const anon = await db.query<{ allowed: boolean }>(`
      select has_table_privilege('anon', 'public.api_write_actions', 'select') as allowed
    `);
    expect(anon.rows[0]?.allowed).toBe(false);
  });
});
