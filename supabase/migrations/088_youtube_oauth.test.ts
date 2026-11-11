// Migration 088 on PGlite. Loads 001 through 087 that exist on disk,
// then 088 twice. Never uses a hosted database.
// 059, 062, 063, 064, and 080 are absent. That gap is expected.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const sqlPath = join(__dirname, "088_youtube_oauth.sql");
const sql = readFileSync(sqlPath, "utf8");
const statements = sql
  .split("\n")
  .filter((line) => !line.trim().startsWith("--"))
  .join("\n");

const USER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const CHANNEL = "UCaaaaaaaaaaaaaaaaaaaaaa";

function migrationFiles(max: number): string[] {
  return readdirSync(__dirname)
    .filter((name) => /^\d{3}_.+\.sql$/.test(name))
    .map((name) => ({ name, n: Number(name.slice(0, 3)) }))
    .filter((row) => row.n >= 1 && row.n <= max)
    .sort((a, b) => a.n - b.n || a.name.localeCompare(b.name))
    .map((row) => join(__dirname, row.name));
}

describe("migration 088 youtube oauth", () => {
  it("documents the grant, retention, and quota rules and is not applied", () => {
    expect(sql).toContain("NOT applied. Apply only after merge and Chris's OK.");
    expect(sql).toContain("aircheck_captions");
    expect(sql).toContain("youtube_quota_set_reserve");
    expect(sql).toContain("30 days");
    expect(sql).toContain("7 days");
    expect(statements).not.toMatch(/create policy/i);
    expect(statements).not.toMatch(/\bto anon\b/i);
    expect(statements).not.toMatch(/grant select, insert, update, delete on table public\.youtube_oauth_connections to authenticated/i);
    expect(statements).toMatch(/refresh_token_enc = null/i);
    expect(statements).not.toMatch(/match_result\s*=/i);
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

describe("migration 088 on PGlite", () => {
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

  beforeAll(async () => {
    await db.exec(prelude);
    for (const path of migrationFiles(87)) {
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
    await db.exec(`insert into auth.users (id, email) values ('${USER}', 'show@example.com'), ('${OTHER}', 'other@example.com')`);
  }, 300_000);

  afterAll(async () => {
    await db.close();
  });

  it("denies anon and authenticated, and lets service_role do all four", async () => {
    for (const table of ["youtube_oauth_connections", "youtube_aircheck_metrics"]) {
      for (const role of ["anon", "authenticated"]) {
        expect(await attempt(role, `select * from public.${table}`)).toMatch(/permission denied/i);
        expect(await attempt(role, `insert into public.${table} default values`)).toMatch(/permission denied/i);
      }
      const rls = await db.query<{ relrowsecurity: boolean }>(
        `select c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'public' and c.relname = '${table}'`
      );
      expect(rls.rows[0]?.relrowsecurity).toBe(true);
    }
    const policies = await db.query<{ count: string }>(
      `select count(*)::text as count from pg_policies
        where schemaname = 'public'
          and tablename in ('youtube_oauth_connections', 'youtube_aircheck_metrics')`
    );
    expect(policies.rows[0]?.count).toBe("0");

    expect(
      await attempt(
        "service_role",
        `insert into public.youtube_oauth_connections
          (user_id, channel_id, scopes, refresh_token_enc, status)
         values ('${USER}', '${CHANNEL}', array['https://www.googleapis.com/auth/youtube.force-ssl'], 'v1.cipher', 'active')`
      )
    ).toBe("allowed");
    expect(await attempt("service_role", `select channel_id from public.youtube_oauth_connections`)).toBe("allowed");
    expect(
      await attempt(
        "service_role",
        `update public.youtube_oauth_connections set channel_title = 'Show' where user_id = '${USER}'`
      )
    ).toBe("allowed");
  });

  it("allows only one active connection per channel", async () => {
    const second = await attempt(
      "service_role",
      `insert into public.youtube_oauth_connections
        (user_id, channel_id, scopes, refresh_token_enc, status)
       values ('${OTHER}', '${CHANNEL}', array['https://www.googleapis.com/auth/youtube.force-ssl'], 'v1.other', 'active')`
    );
    expect(second).toMatch(/duplicate key|unique/i);
  });

  it("accepts the caption job, rejects an unknown job, and keeps reserve service_role only", async () => {
    const accepted = await db.query<{ value: string }>(
      `select public.youtube_quota_commit('2026-11-11', 250, 'aircheck_captions', 9800)->>'accepted' as value`
    );
    expect(accepted.rows[0]?.value).toBe("250");
    const rejected = await attempt(
      "service_role",
      `select public.youtube_quota_commit('2026-11-11', 1, 'other', 9800)`
    );
    expect(rejected).toMatch(/unknown job/i);

    const reserve = await db.query<{ aircheck_reserve: number }>(
      `select count(*)::int as aircheck_reserve from information_schema.columns
        where table_schema = 'public' and table_name = 'youtube_quota_days' and column_name = 'aircheck_reserve'`
    );
    expect(Number(reserve.rows[0]?.aircheck_reserve)).toBe(1);
    expect(await attempt("anon", `select public.youtube_quota_set_reserve('2026-11-12', 1800)`)).toMatch(/permission denied/i);
    expect(await attempt("authenticated", `select public.youtube_quota_set_reserve('2026-11-12', 1800)`)).toMatch(
      /permission denied/i
    );
    expect(await attempt("service_role", `select public.youtube_quota_set_reserve('2026-11-12', 1800)`)).toBe("allowed");
    const tooHigh = await attempt("service_role", `select public.youtube_quota_set_reserve('2026-11-12', 4001)`);
    expect(tooHigh).toMatch(/0 to 4000|check constraint/i);
    const row = await db.query<{ units: number; aircheck_reserve: number }>(
      `select units, aircheck_reserve from public.youtube_quota_days where pacific_day = '2026-11-12'`
    );
    expect(row.rows[0]?.units).toBe(0);
    expect(row.rows[0]?.aircheck_reserve).toBe(1800);
    expect(await attempt("service_role", `select public.youtube_quota_set_reserve('2026-11-12', 1800)`)).toBe("allowed");
  });

  it("lets service_role delete a connection row", async () => {
    expect(
      await attempt("service_role", `delete from public.youtube_oauth_connections where user_id = '${USER}'`)
    ).toBe("allowed");
  });
});
