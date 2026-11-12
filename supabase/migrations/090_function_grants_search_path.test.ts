// Migration 090 on PGlite. Loads 001 through 089 that exist on disk,
// then 090 twice. Never uses a hosted database.
// 059, 062, 063, and 064 are absent. That gap is expected.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const sqlPath = join(__dirname, "090_function_grants_search_path.sql");
const sql = readFileSync(sqlPath, "utf8");
const statements = sql
  .split("\n")
  .filter((line) => !line.trim().startsWith("--"))
  .join("\n");

const USER = "11111111-1111-4111-8111-111111111111";
const BRAND = "22222222-2222-4222-8222-222222222222";
const SHOW_A = "a1111111-1111-4111-8111-111111111111";
const SHOW_B = "a2222222-2222-4222-8222-222222222222";
const DEAL_100 = "b1111111-1111-4111-8111-111111111111";
const DEAL_200 = "b2222222-2222-4222-8222-222222222222";
const DEAL_300 = "b3333333-3333-4333-8333-333333333333";
const SHOW_PROFILE = "44444444-4444-4444-8444-444444444444";
const BRAND_PROFILE = "55555555-5555-4555-8555-555555555555";
const CAMPAIGN = "66666666-6666-4666-8666-666666666666";
const OUTREACH = "77777777-7777-4777-8777-777777777777";

const PINNED = ["update_updated_at", "reset_monthly_campaigns", "get_avg_negotiated_cpm"] as const;

function migrationFiles(max: number): string[] {
  return readdirSync(__dirname)
    .filter((name) => /^\d{3}_.+\.sql$/.test(name))
    .map((name) => ({ name, n: Number(name.slice(0, 3)) }))
    .filter((row) => row.n >= 1 && row.n <= max)
    .sort((a, b) => a.n - b.n || a.name.localeCompare(b.name))
    .map((row) => join(__dirname, row.name));
}

describe("migration 090 function grants and search_path", () => {
  it("alters search_path and grants only", () => {
    expect(sql).toContain("NOT applied. Apply on ldtmhafewfifdizgfrnn only after merge");
    expect(sql).toContain("when Chris names 090");
    expect(statements).toMatch(/alter function public\.update_updated_at\(\) set search_path = ''/);
    expect(statements).toMatch(/alter function public\.reset_monthly_campaigns\(\) set search_path = ''/);
    expect(statements).toMatch(
      /alter function public\.get_avg_negotiated_cpm\(uuid\) set search_path = ''/
    );
    expect(statements).toMatch(
      /revoke all on function public\.get_avg_negotiated_cpm\(uuid\) from public/
    );
    expect(statements).toMatch(
      /revoke all on function public\.get_avg_negotiated_cpm\(uuid\) from anon/
    );
    expect(statements).toMatch(
      /revoke all on function public\.get_avg_negotiated_cpm\(uuid\) from authenticated/
    );
    expect(statements).toMatch(
      /grant execute on function public\.get_avg_negotiated_cpm\(uuid\) to service_role/
    );
    expect(statements).toMatch(/revoke all on function public\.auth_login_email\(\) from public/);
    expect(statements).toMatch(/revoke all on function public\.auth_login_email\(\) from anon/);
    expect(statements).toMatch(
      /grant execute on function public\.auth_login_email\(\) to authenticated/
    );
    expect(statements).toMatch(
      /grant execute on function public\.auth_login_email\(\) to service_role/
    );
    expect(statements).not.toMatch(/create or replace/i);
    expect(statements).not.toMatch(/\bto anon\b/i);
    expect(statements).not.toMatch(/security definer/i);
    expect(statements).not.toMatch(/create table/i);
    expect(statements).not.toMatch(/add column/i);
    expect(statements).not.toMatch(/create policy/i);
    expect(statements).not.toMatch(/revoke .*update_updated_at/i);
    expect(statements).not.toMatch(/revoke .*reset_monthly_campaigns/i);
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

interface FnRow {
  proname: string;
  prosecdef: boolean;
  prosrc: string;
  proconfig: string;
  cfg: string;
  proacl: string;
  anon_x: boolean;
  auth_x: boolean;
  svc_x: boolean;
  public_x: boolean;
}

function publicExecute(proacl: string): boolean {
  return proacl.includes("{=X") || proacl.includes(",=X");
}

describe("migration 090 on PGlite", () => {
  const db = new PGlite();
  let before = new Map<string, FnRow>();

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

  async function readFunctions(): Promise<Map<string, FnRow>> {
    const result = await db.query<FnRow>(`
      select p.proname,
             p.prosecdef,
             p.prosrc,
             coalesce(p.proconfig::text, '') as proconfig,
             coalesce((select string_agg(cfg, ' | ') from unnest(p.proconfig) as cfg), '') as cfg,
             coalesce(p.proacl::text, '') as proacl,
             has_function_privilege('anon', p.oid, 'execute') as anon_x,
             has_function_privilege('authenticated', p.oid, 'execute') as auth_x,
             has_function_privilege('service_role', p.oid, 'execute') as svc_x,
             coalesce(p.proacl::text, '') like '%{=X%'
               or coalesce(p.proacl::text, '') like '%,=X%' as public_x
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public'
         and p.proname in (
           'get_avg_negotiated_cpm',
           'auth_login_email',
           'update_updated_at',
           'reset_monthly_campaigns'
         )
    `);
    return new Map(result.rows.map((row) => [row.proname, row]));
  }

  async function asAuthenticated(statement: string): Promise<string> {
    await db.exec(`select set_config('request.jwt.claim.sub', '${USER}', false)`);
    await db.exec(`select set_config('request.jwt.claim.role', 'authenticated', false)`);
    await db.exec("set role authenticated");
    try {
      const result = await db.query<{ value: string }>(statement);
      return result.rows[0]?.value ?? "";
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
    for (const path of migrationFiles(89)) {
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
    before = await readFunctions();
    await db.exec(sql);
    await db.exec(sql);
    await db.exec(`
      insert into auth.users (id, email) values
        ('${USER}', 'show@example.com'),
        ('${BRAND}', 'brand@example.com');
      insert into public.profiles (id, email, role) values
        ('${USER}', 'show@example.com', 'show'),
        ('${BRAND}', 'brand@example.com', 'brand');
      insert into public.shows (id, name, platform, is_discoverable, data_sources, contact_email) values
        ('${SHOW_A}', 'Three spots', 'podcast', true, '{}', null),
        ('${SHOW_B}', 'Owner only', 'podcast', false, '{show_owner}', 'show@example.com');
      insert into public.show_profiles (id, user_id) values ('${SHOW_PROFILE}', '${USER}');
      insert into public.deals (
        id, show_id, brand_id, status, num_episodes, placement, ad_format,
        price_type, cpm_rate, guaranteed_downloads, net_per_episode, total_net, flight_start, flight_end
      ) values
        ('${DEAL_100}', '${SHOW_A}', '${BRAND}', 'signed', 1, 'mid-roll', 'host_read', 'cpm', 100, 1000, 100, 100, '2026-11-01', '2026-11-30'),
        ('${DEAL_200}', '${SHOW_A}', '${BRAND}', 'signed', 1, 'mid-roll', 'host_read', 'cpm', 200, 1000, 200, 200, '2026-11-01', '2026-11-30'),
        ('${DEAL_300}', '${SHOW_A}', '${BRAND}', 'signed', 1, 'mid-roll', 'host_read', 'cpm', 300, 1000, 300, 300, '2026-11-01', '2026-11-30');
      insert into public.brand_profiles (id, user_id) values ('${BRAND_PROFILE}', '${BRAND}');
      insert into public.campaigns (id, user_id, name, budget_total) values
        ('${CAMPAIGN}', '${BRAND}', 'SEC7', 1000);
      insert into public.outreaches (
        id, brand_profile_id, campaign_id, show_id, show_name, proposed_cpm,
        proposed_episode_count, proposed_placement, proposed_flight_start, proposed_flight_end,
        pitch_body, sent_to_email, token
      ) values (
        '${OUTREACH}', '${BRAND_PROFILE}', '${CAMPAIGN}', '${SHOW_B}', 'Owner only', 25,
        3, 'mid-roll', '2026-11-01', '2026-11-30',
        'Hello', 'show@example.com', 'sec7-not-a-credential'
      );
    `);
  }, 300_000);

  afterAll(async () => {
    await db.close();
  });

  it("pins search_path and leaves bodies and security mode in place", async () => {
    const after = await readFunctions();
    for (const name of PINNED) {
      const row = after.get(name);
      expect(row?.cfg).toBe('search_path=""');
      expect(row?.proconfig).toBe('{"search_path=\\"\\""}');
      expect(row?.prosrc).toBe(before.get(name)?.prosrc);
      expect(row?.prosecdef).toBe(before.get(name)?.prosecdef);
    }
    const login = after.get("auth_login_email");
    expect(login?.cfg).toBe("search_path=auth, public, pg_temp");
    expect(login?.proconfig).toBe('{"search_path=auth, public, pg_temp"}');
    expect(login?.prosrc).toBe(before.get("auth_login_email")?.prosrc);
    expect(login?.prosecdef).toBe(true);
    expect(after.get("get_avg_negotiated_cpm")?.prosecdef).toBe(true);
    expect(after.get("update_updated_at")?.prosecdef).toBe(false);
    expect(after.get("reset_monthly_campaigns")?.prosecdef).toBe(false);
  });

  it("keeps update_updated_at and reset_monthly_campaigns grants", async () => {
    const after = await readFunctions();
    for (const name of ["update_updated_at", "reset_monthly_campaigns"] as const) {
      const next = after.get(name);
      const prev = before.get(name);
      expect(next?.anon_x).toBe(prev?.anon_x);
      expect(next?.auth_x).toBe(prev?.auth_x);
      expect(next?.svc_x).toBe(prev?.svc_x);
      expect(next?.public_x).toBe(prev?.public_x);
      expect(next?.proacl).toBe(prev?.proacl);
    }
  });

  it("denies anon and authenticated on get_avg_negotiated_cpm and allows service_role", async () => {
    const row = (await readFunctions()).get("get_avg_negotiated_cpm");
    expect(publicExecute(row?.proacl ?? "")).toBe(false);
    expect(row?.proacl.split(",").some((entry) => entry.startsWith("=") || entry.startsWith("{="))).toBe(
      false
    );
    const call = `select public.get_avg_negotiated_cpm('${SHOW_A}'::uuid)`;
    for (const role of ["anon", "authenticated"]) {
      expect(await attempt(role, call)).toMatch(/permission denied/i);
    }
    expect(await attempt("service_role", call)).toBe("allowed");
    expect(await attempt("service_role", "select public.reset_monthly_campaigns()")).toBe("allowed");
  });

  it("keeps auth_login_email executable by authenticated and service_role", async () => {
    const row = (await readFunctions()).get("auth_login_email");
    expect(row?.anon_x).toBe(false);
    expect(row?.auth_x).toBe(true);
    expect(row?.svc_x).toBe(true);
    expect(row?.public_x).toBe(false);
    expect(publicExecute(row?.proacl ?? "")).toBe(false);
    expect(await attempt("anon", "select public.auth_login_email()")).toMatch(/permission denied/i);
    expect(await attempt("authenticated", "select public.auth_login_email()")).toBe("allowed");
    expect(await attempt("service_role", "select public.auth_login_email()")).toBe("allowed");
  });

  it("returns 200 for three signed deals and null for two", async () => {
    await db.exec("set role service_role");
    try {
      const three = await db.query<{ value: string | null }>(
        `select public.get_avg_negotiated_cpm('${SHOW_A}'::uuid)::text as value`
      );
      expect(Number(three.rows[0]?.value)).toBe(200);
      const none = await db.query<{ value: string | null }>(
        `select public.get_avg_negotiated_cpm('${SHOW_B}'::uuid)::text as value`
      );
      expect(none.rows[0]?.value).toBeNull();
    } finally {
      await db.exec("reset role");
    }

    await db.exec(`delete from public.deals where id = '${DEAL_300}'`);

    await db.exec("set role service_role");
    try {
      const two = await db.query<{ value: string | null }>(
        `select public.get_avg_negotiated_cpm('${SHOW_A}'::uuid)::text as value`
      );
      expect(two.rows[0]?.value).toBeNull();
    } finally {
      await db.exec("reset role");
    }
  });

  it("advances updated_at on profiles and deals", async () => {
    await db.exec(`
      alter table public.profiles disable trigger update_profiles_timestamp;
      update public.profiles set updated_at = '2020-01-01T00:00:00Z' where id = '${USER}';
      alter table public.profiles enable trigger update_profiles_timestamp;
      alter table public.deals disable trigger update_deals_timestamp;
      update public.deals set updated_at = '2020-01-01T00:00:00Z' where id = '${DEAL_100}';
      alter table public.deals enable trigger update_deals_timestamp;
    `);

    expect(
      await attempt("service_role", `update public.profiles set full_name = 'Show Host' where id = '${USER}'`)
    ).toBe("allowed");
    expect(
      await attempt("service_role", `update public.deals set notes = 'sec7' where id = '${DEAL_100}'`)
    ).toBe("allowed");

    const stamps = await db.query<{ profile_advanced: boolean; deal_advanced: boolean }>(`
      select
        (select updated_at > '2021-01-01'::timestamptz from public.profiles where id = '${USER}') as profile_advanced,
        (select updated_at > '2021-01-01'::timestamptz from public.deals where id = '${DEAL_100}') as deal_advanced
    `);
    expect(stamps.rows[0]?.profile_advanced).toBe(true);
    expect(stamps.rows[0]?.deal_advanced).toBe(true);
  });

  it("lets a signed-in caller read shows and outreaches", async () => {
    const shows = await asAuthenticated(`select count(*)::text as value from public.shows`);
    const outreaches = await asAuthenticated(`select count(*)::text as value from public.outreaches`);
    const owns = await asAuthenticated(
      `select public.user_owns_show('${SHOW_B}'::uuid)::text as value`
    );
    expect(shows).not.toMatch(/permission denied for function/i);
    expect(outreaches).not.toMatch(/permission denied for function/i);
    expect(owns).not.toMatch(/permission denied for function/i);
    expect(shows).toBe("2");
    expect(outreaches).toBe("1");
    expect(owns).toBe("true");
  });
});
