// Migration 087. Runs in PGlite. Never uses a hosted database.
// Loads on-disk migrations 001 through 084 (080, 085, and 086 may
// be absent), seeds two JWT-shaped outreach tokens, then applies 087.
// When 085 is on disk, the same assertions run after loading through 085.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const sqlPath = join(__dirname, "087_outreach_token_retire.sql");
const sql = readFileSync(sqlPath, "utf8");
const statements = sql
  .split("\n")
  .filter((line) => !line.trim().startsWith("--"))
  .join("\n");

const BRAND = "11111111-1111-4111-8111-111111111111";
const SHOW_A = "22222222-2222-4222-8222-222222222222";
const SHOW_B = "33333333-3333-4333-8333-333333333333";
const BRAND_PROFILE = "44444444-4444-4444-8444-444444444444";
const SHOW_PROFILE_A = "55555555-5555-4555-8555-555555555555";
const SHOW_PROFILE_B = "66666666-6666-4666-8666-666666666666";
const CAMPAIGN = "77777777-7777-4777-8777-777777777777";
const OUTREACH_A = "88888888-8888-4888-8888-888888888888";
const OUTREACH_B = "99999999-9999-4999-8999-999999999999";
const SHOW_A_EMAIL = "show-a@example.test";
const SHOW_B_EMAIL = "show-b@example.test";
const TOKEN_A =
  "eyJhbGciOiJIUzI1NiJ9.eyJvdXRyZWFjaF9pZCI6ImEiLCJpYXQiOjEsInYiOjF9.aaaaaaaa";
const TOKEN_B =
  "eyJhbGciOiJIUzI1NiJ9.eyJvdXRyZWFjaF9pZCI6ImIiLCJpYXQiOjEsInYiOjF9.bbbbbbbb";

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

const claimsFns = `
create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claims', true)::json ->> 'sub', '')::uuid
$$;

create or replace function auth.role()
returns text
language sql
stable
as $$
  select case
    when nullif(current_setting('request.jwt.claims', true), '') is null then null
    else nullif(current_setting('request.jwt.claims', true), '')::json ->> 'role'
  end
$$;

grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
grant execute on function auth.role() to anon, authenticated, service_role;
`;

function migrationFiles(max: number): string[] {
  return readdirSync(__dirname)
    .filter((name) => /^\d{3}_.+\.sql$/.test(name))
    .map((name) => ({ name, n: Number(name.slice(0, 3)) }))
    .filter((row) => row.n >= 1 && row.n <= max && row.n !== 87)
    .sort((a, b) => a.n - b.n || a.name.localeCompare(b.name))
    .map((row) => join(__dirname, row.name));
}

function hasMigration(n: number): boolean {
  return readdirSync(__dirname).some((name) => new RegExp(`^${String(n).padStart(3, "0")}_.+\\.sql$`).test(name));
}

interface TokenRow {
  id: string;
  token: string | null;
}

describe("migration 087 source", () => {
  it("retires the column inside a guarded block and changes no grant or policy", () => {
    expect(sql).toContain("NOT applied. Apply only after merge and Chris's OK.");
    expect(sql).toContain("token not like 'retired:%'");
    expect(sql).toContain("is_nullable");
    expect(statements).toMatch(/if exists/i);
    expect(statements).toMatch(
      /update public\.outreaches\s+set token = 'retired:' \|\| id::text\s+where token is distinct from 'retired:' \|\| id::text/i
    );
    expect(statements).toMatch(/alter column token drop not null/i);
    expect(statements).not.toMatch(/\bgrant\b/i);
    expect(statements).not.toMatch(/\brevoke\b/i);
    expect(statements).not.toMatch(/create policy/i);
    expect(statements).not.toMatch(/drop policy/i);
    expect(statements).not.toMatch(/create table/i);
    expect(statements).not.toMatch(/outreach_tokens/i);
  });
});

function registerSuite(title: string, max: number, skip: boolean) {
  const block = skip ? describe.skip : describe;
  block(title, () => {
    const db = new PGlite();

    async function rowsAs(
      role: "authenticated" | "anon" | "service_role",
      userId: string | null,
      statement: string
    ): Promise<{ ok: true; rows: TokenRow[] } | { ok: false; message: string }> {
      const claims = JSON.stringify({
        sub: userId,
        role: role === "authenticated" ? "authenticated" : role,
      });
      await db.exec("begin");
      try {
        await db.exec(
          `select set_config('request.jwt.claims', '${claims}', true)`
        );
        await db.exec(`set local role ${role}`);
        const result = await db.query<TokenRow>(statement);
        return { ok: true, rows: result.rows };
      } catch (err) {
        return { ok: false, message: err instanceof Error ? err.message : String(err) };
      } finally {
        await db.exec("rollback");
      }
    }

    beforeAll(async () => {
      await db.exec(prelude);
      for (const path of migrationFiles(max)) {
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
      await db.exec(claimsFns);
      await db.exec(`
        insert into auth.users (id, email) values
          ('${BRAND}', 'brand@example.test'),
          ('${SHOW_A}', '${SHOW_A_EMAIL}'),
          ('${SHOW_B}', '${SHOW_B_EMAIL}');
        insert into public.profiles (id, email, role) values
          ('${BRAND}', 'brand@example.test', 'brand'),
          ('${SHOW_A}', '${SHOW_A_EMAIL}', 'show'),
          ('${SHOW_B}', '${SHOW_B_EMAIL}', 'show');
        insert into public.brand_profiles (id, user_id, brand_identity)
        values ('${BRAND_PROFILE}', '${BRAND}', 'Example Brand');
        insert into public.show_profiles (id, user_id, show_name) values
          ('${SHOW_PROFILE_A}', '${SHOW_A}', 'Show A'),
          ('${SHOW_PROFILE_B}', '${SHOW_B}', 'Show B');
        insert into public.campaigns (id, user_id, name, budget_total, brand_profile_id)
        values ('${CAMPAIGN}', '${BRAND}', 'SEC5', 1000, '${BRAND_PROFILE}');
        insert into public.outreaches (
          id, brand_profile_id, campaign_id, podscan_id, show_name,
          proposed_cpm, proposed_episode_count, proposed_placement,
          proposed_flight_start, proposed_flight_end, pitch_body,
          sent_to_email, token
        ) values
          (
            '${OUTREACH_A}', '${BRAND_PROFILE}', '${CAMPAIGN}', 'pod-a', 'Show A',
            25, 3, 'mid-roll', '2026-06-01', '2026-06-30',
            'Pitch body for show A that is long enough to store.',
            '${SHOW_A_EMAIL}', '${TOKEN_A}'
          ),
          (
            '${OUTREACH_B}', '${BRAND_PROFILE}', '${CAMPAIGN}', 'pod-b', 'Show B',
            30, 3, 'pre-roll', '2026-07-01', '2026-07-31',
            'Pitch body for show B that is long enough to store.',
            '${SHOW_B_EMAIL}', '${TOKEN_B}'
          );
      `);
      await db.exec(sql);
    }, 180_000);

    afterAll(async () => {
      await db.close();
    });

    it("backfills retired placeholders and keeps the unique key", async () => {
      const rows = await db.query<TokenRow>(
        `select id::text as id, token from public.outreaches order by id`
      );
      expect(rows.rows).toEqual([
        { id: OUTREACH_A, token: `retired:${OUTREACH_A}` },
        { id: OUTREACH_B, token: `retired:${OUTREACH_B}` },
      ]);
      const nullable = await db.query<{ is_nullable: string }>(`
        select is_nullable
          from information_schema.columns
         where table_schema = 'public'
           and table_name = 'outreaches'
           and column_name = 'token'
      `);
      expect(nullable.rows[0]?.is_nullable).toBe("YES");
      const key = await db.query<{ conname: string }>(`
        select conname
          from pg_constraint
         where conrelid = 'public.outreaches'::regclass
           and conname = 'outreaches_token_key'
      `);
      expect(key.rows).toEqual([{ conname: "outreaches_token_key" }]);
    });

    it("lets the brand read only retired placeholders", async () => {
      const result = await rowsAs(
        "authenticated",
        BRAND,
        `select id::text as id, token from public.outreaches order by id`
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.rows.map((row) => row.id)).toEqual([OUTREACH_A, OUTREACH_B]);
      expect(result.rows.every((row) => row.token?.startsWith("retired:"))).toBe(true);
    });

    it("lets show A read only the outreach sent to its login email", async () => {
      const result = await rowsAs(
        "authenticated",
        SHOW_A,
        `select id::text as id, token, sent_to_email from public.outreaches order by id`
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.rows).toEqual([
        {
          id: OUTREACH_A,
          token: `retired:${OUTREACH_A}`,
          sent_to_email: SHOW_A_EMAIL,
        },
      ]);
    });

    it("denies anon", async () => {
      const result = await rowsAs(
        "anon",
        null,
        `select id::text as id, token from public.outreaches`
      );
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.message).toMatch(/permission denied/i);
    });

    it("lets service_role select and insert a row with no token", async () => {
      const selected = await rowsAs(
        "service_role",
        null,
        `select id::text as id, token from public.outreaches order by id`
      );
      expect(selected.ok).toBe(true);
      if (!selected.ok) return;
      expect(selected.rows).toHaveLength(2);

      const inserted = await rowsAs(
        "service_role",
        null,
        `insert into public.outreaches (
           brand_profile_id, campaign_id, podscan_id, show_name,
           proposed_cpm, proposed_episode_count, proposed_placement,
           proposed_flight_start, proposed_flight_end, pitch_body,
           sent_to_email
         ) values (
           '${BRAND_PROFILE}', '${CAMPAIGN}', 'pod-null', 'Null Token Show',
           25, 3, 'mid-roll', '2026-08-01', '2026-08-31',
           'Pitch body for a row that omits the token column.',
           'null-token@example.test'
         ) returning id::text as id, token`
      );
      expect(inserted.ok).toBe(true);
      if (!inserted.ok) return;
      expect(inserted.rows).toHaveLength(1);
      expect(inserted.rows[0]?.token).toBeNull();
    });

    it("applies a second time without changing the retired values", async () => {
      await db.exec(sql);
      const rows = await db.query<TokenRow>(
        `select id::text as id, token from public.outreaches order by id`
      );
      expect(rows.rows).toEqual([
        { id: OUTREACH_A, token: `retired:${OUTREACH_A}` },
        { id: OUTREACH_B, token: `retired:${OUTREACH_B}` },
      ]);
    });
  });
}

registerSuite("migration 087 on PGlite through 084", 84, false);
registerSuite("migration 087 on PGlite through 085", 85, !hasMigration(85));
