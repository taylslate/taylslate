// Migration 071. The SQL checks always run. The throwaway Postgres
// suite applies 001 through 066, adds shows.agent_id, then every
// migration from 067 through 070 that is on disk, then 071 twice.
// It skips when Postgres binaries are absent. Never uses a hosted database.
//
// 068_past_campaign_show_match.sql must be on disk. The #42 case
// fails when that file is missing. O1 has not merged, so 061 is not applied.

import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const sqlPath = join(__dirname, "071_shows_select_policy.sql");
const sql = readFileSync(sqlPath, "utf8");
const statements = sql
  .split("\n")
  .filter((line) => !line.trim().startsWith("--"))
  .join("\n");

const AGENT_A = "11111111-1111-4111-8111-111111111111";
const BRAND_B = "22222222-2222-4222-8222-222222222222";
const REP_OK = "33333333-3333-4333-8333-333333333333";
const REP_PENDING = "44444444-4444-4444-8444-444444444444";
const REP_REJECTED = "55555555-5555-4555-8555-555555555555";
const SHOW_USER = "66666666-6666-4666-8666-666666666666";
const OWNER_USER = "77777777-7777-4777-8777-777777777777";
const HIDDEN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const DEAL_HIDDEN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";
const TIE_HIDDEN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3";
const OWNER_HIDDEN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4";
const OPEN_SHOW = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5";

function pgBin(): string | null {
  const fromEnv = process.env.S1_PG_BIN;
  const candidates = [
    fromEnv,
    "/usr/lib/postgresql/16/bin",
    "/usr/lib/postgresql/17/bin",
    "/usr/lib/postgresql/15/bin",
  ].filter((dir): dir is string => Boolean(dir));
  for (const dir of candidates) {
    if (existsSync(join(dir, "initdb")) && existsSync(join(dir, "psql"))) {
      return dir;
    }
  }
  return null;
}

function i2bSqlPath(): string {
  return join(__dirname, "068_past_campaign_show_match.sql");
}

describe("migration 071 sql", () => {
  it("documents that it is not applied and does not touch service_role", () => {
    expect(sql).toContain(
      "NOT applied. Apply on ldtmhafewfifdizgfrnn only after merge and Chris's OK."
    );
    expect(sql).toContain("information_schema.role_table_grants");
    expect(statements).not.toMatch(/\bto\s+service_role\b/i);
    expect(statements).not.toMatch(/\bfrom\s+service_role\b/i);
    expect(statements).not.toMatch(/\bgrant\b/i);
    expect(statements).not.toMatch(/show_ownership_proofs/i);
    expect(statements).not.toMatch(/podscan_id/i);
    expect(statements).not.toMatch(/security definer/i);
    expect(statements).not.toMatch(/\badmin\b/i);
  });

  it("replaces the open read policy and keeps authenticated select only", () => {
    expect(statements).toMatch(
      /drop policy if exists "Shows are publicly readable" on public\.shows;/i
    );
    expect(statements).toMatch(
      /create policy "Shows readable by signed-in participants"/i
    );
    expect(statements).toMatch(/for select\s+to authenticated/i);
    expect(statements).toMatch(/is_discoverable = true/i);
    expect(statements).toMatch(/agent_id = \(select auth\.uid\(\)\)/i);
    expect(statements).toMatch(/a\.status = 'approved'/i);
    expect(statements).toMatch(
      /\(select auth\.uid\(\)\) in \(d\.brand_id, d\.agency_id, d\.agent_id\)/i
    );
    expect(statements).toMatch(/d\.show_profile_id = sp\.id/i);
    expect(statements).toMatch(/'show_owner' = any \(data_sources\)/i);
    expect(statements).toMatch(/lower\(contact_email\) = lower\(p\.email\)/i);
    expect(statements).not.toMatch(/auth\.uid\(\)(?!\))/);
    expect(statements).toMatch(
      /revoke all on table public\.shows from anon;/i
    );
    expect(statements).toMatch(
      /revoke all on table public\.shows from public;/i
    );
    expect(statements).toMatch(
      /revoke insert, update, delete, truncate, references, trigger/i
    );
    expect(statements).not.toMatch(/revoke select/i);
    expect(statements).toMatch(
      /create index if not exists idx_agent_shows_show_agent_approved/i
    );
    expect(statements).toMatch(/where status = 'approved'/i);
    expect(statements).toMatch(
      /create index if not exists idx_show_profiles_user/i
    );
  });
});

const bin = pgBin();

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

function chainMigrations(min: number, max: number): string[] {
  return readdirSync(__dirname)
    .filter((name) => /^\d{3}_.+\.sql$/.test(name))
    .map((name) => ({ name, n: Number(name.slice(0, 3)) }))
    .filter((row) => row.n >= min && row.n <= max)
    .sort((a, b) => a.n - b.n || a.name.localeCompare(b.name))
    .map((row) => join(__dirname, row.name));
}

describe.skipIf(!bin)("migration 071 on throwaway postgres", () => {
  const pgRoot = bin ?? "";
  let dataDir = "";
  let port = 0;
  let explainText = "";

  function psql(args: string[]) {
    return spawnSync(join(pgRoot, "psql"), args, {
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${pgRoot}:${process.env.PATH ?? ""}`,
        LC_ALL: "C",
      },
    });
  }

  function query(statement: string): string {
    const result = psql([
      "-h", dataDir, "-p", String(port), "-U", "postgres", "-d", "s4",
      "-v", "ON_ERROR_STOP=1", "-X", "-q", "-At", "-c", statement,
    ]);
    if (result.status !== 0) {
      throw new Error(result.stderr || result.stdout || statement);
    }
    return (result.stdout ?? "").trim();
  }

  function loose(statement: string): string {
    const result = psql([
      "-h", dataDir, "-p", String(port), "-U", "postgres", "-d", "s4",
      "-X", "-c", statement,
    ]);
    return `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  }

  function file(path: string): void {
    const result = psql([
      "-h", dataDir, "-p", String(port), "-U", "postgres", "-d", "s4",
      "-v", "ON_ERROR_STOP=1", "-X", "-q", "-f", path,
    ]);
    if (result.status !== 0) {
      throw new Error(`${path}\n${result.stderr || result.stdout || "psql failed"}`);
    }
  }

  function asUser(userId: string, statement: string): string {
    return query(`
      do $$ begin
        perform set_config(
          'request.jwt.claims',
          json_build_object('sub', '${userId}', 'role', 'authenticated')::text,
          false
        );
      end $$;
      set role authenticated;
      ${statement}
    `);
  }

  beforeAll(async () => {
    dataDir = mkdtempSync(join(tmpdir(), "s4-pg-"));
    port = await freePort();
    const init = spawnSync(
      join(pgRoot, "initdb"),
      ["-D", dataDir, "--username=postgres", "--auth=trust", "--no-sync", "--locale=C", "--encoding=UTF8"],
      { encoding: "utf8" }
    );
    if (init.status !== 0) throw new Error(init.stderr || init.stdout || "initdb failed");
    const start = spawnSync(
      join(pgRoot, "pg_ctl"),
      ["-D", dataDir, "-w", "-l", join(dataDir, "server.log"), "-o", `-p ${port} -k ${dataDir} -c listen_addresses=`, "start"],
      { encoding: "utf8", env: { ...process.env, PATH: `${pgRoot}:${process.env.PATH ?? ""}`, LC_ALL: "C" } }
    );
    if (start.status !== 0) throw new Error(start.stderr || start.stdout || "pg_ctl start failed");
    psql(["-h", dataDir, "-p", String(port), "-U", "postgres", "-d", "postgres", "-c", "create database s4;"]);
    query(`
      create schema if not exists auth;
      create table if not exists auth.users (id uuid primary key);
      create or replace function auth.uid()
      returns uuid language sql stable as $$
        select nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'sub', '')::uuid
      $$;
      create schema if not exists storage;
      create table if not exists storage.objects (
        id uuid primary key default gen_random_uuid(),
        bucket_id text
      );
      alter table storage.objects enable row level security;
      do $$ begin
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
      grant usage on schema auth to anon, authenticated, service_role;
      grant execute on function auth.uid() to anon, authenticated, service_role;
      create table if not exists public.show_claims (id uuid primary key default gen_random_uuid());
      create table if not exists public.outcomes (id uuid primary key default gen_random_uuid());
    `);

    for (const path of chainMigrations(1, 66)) file(path);

    // 001's CREATE TABLE omits shows.agent_id. 000 and the live table
    // have the column and idx_shows_agent. 068 and 071 read that column,
    // so it has to exist before 067 through 070.
    query(`
      alter table public.shows
        add column if not exists agent_id uuid references public.profiles(id);
      create index if not exists idx_shows_agent on public.shows (agent_id);
    `);

    for (const path of chainMigrations(67, 70)) file(path);
    file(sqlPath);
    file(sqlPath);

    const users = [AGENT_A, BRAND_B, REP_OK, REP_PENDING, REP_REJECTED, SHOW_USER, OWNER_USER];
    query(`
      insert into auth.users (id) values ${users.map((id) => `('${id}')`).join(", ")};
      insert into public.profiles (id, email, full_name, role) values
        ('${AGENT_A}', 'agent-a@example.test', 'Agent A', 'agent'),
        ('${BRAND_B}', 'brand-b@example.test', 'Brand B', 'brand'),
        ('${REP_OK}', 'rep-ok@example.test', 'Rep Ok', 'agent'),
        ('${REP_PENDING}', 'rep-pending@example.test', 'Rep Pending', 'agent'),
        ('${REP_REJECTED}', 'rep-rejected@example.test', 'Rep Rejected', 'agent'),
        ('${SHOW_USER}', 'show-user@example.test', 'Show User', 'show'),
        ('${OWNER_USER}', 'Owner@Show.test', 'Owner User', 'show');
      insert into public.shows (id, name, platform, is_discoverable, agent_id, contact_email, data_sources) values
        ('${HIDDEN}', 'Hidden Desk', 'podcast', false, '${AGENT_A}', null, '{}'),
        ('${DEAL_HIDDEN}', 'Deal Desk', 'podcast', false, '${AGENT_A}', null, '{}'),
        ('${TIE_HIDDEN}', 'Tie Desk', 'podcast', false, '${AGENT_A}', null, '{}'),
        ('${OWNER_HIDDEN}', 'Owner Desk', 'podcast', false, '${AGENT_A}', 'owner@show.test', '{show_owner}'),
        ('${OPEN_SHOW}', 'Open Desk', 'podcast', true, '${AGENT_A}', null, '{}');
      insert into public.agent_show_relationships (agent_id, show_id, status) values
        ('${REP_OK}', '${HIDDEN}', 'approved'),
        ('${REP_PENDING}', '${HIDDEN}', 'pending'),
        ('${REP_REJECTED}', '${HIDDEN}', 'rejected');
      insert into public.show_profiles (user_id, show_name) values
        ('${SHOW_USER}', 'Tie Desk'),
        ('${OWNER_USER}', 'Owner Desk');
      insert into public.deals (
        show_id, brand_id, status, num_episodes, placement, ad_format, price_type,
        cpm_rate, guaranteed_downloads, net_per_episode, total_net, flight_start, flight_end,
        show_profile_id
      ) values (
        '${DEAL_HIDDEN}', '${BRAND_B}', 'planning', 3, 'mid-roll', 'host_read', 'cpm',
        25, 1000, 25, 75, '2026-01-01', '2026-02-01', null
      );
      insert into public.deals (
        show_id, brand_id, status, num_episodes, placement, ad_format, price_type,
        cpm_rate, guaranteed_downloads, net_per_episode, total_net, flight_start, flight_end,
        show_profile_id
      ) values (
        '${TIE_HIDDEN}', '${BRAND_B}', 'planning', 3, 'mid-roll', 'host_read', 'cpm',
        25, 1000, 25, 75, '2026-01-01', '2026-02-01',
        (select id from public.show_profiles where user_id = '${SHOW_USER}')
      );
      insert into public.shows (name, platform, is_discoverable)
      select 'Bulk ' || g, 'podcast', true
      from generate_series(1, 400) g;
      insert into public.agent_show_relationships (agent_id, show_id, status)
      select '${REP_OK}', id, 'approved'
        from public.shows
       where name like 'Bulk %';
      analyze public.shows;
      analyze public.agent_show_relationships;
    `);

    explainText = query(`
      do $$ begin
        perform set_config(
          'request.jwt.claims',
          json_build_object('sub', '${BRAND_B}', 'role', 'authenticated')::text,
          false
        );
      end $$;
      set role authenticated;
      explain (costs off)
      select id from public.shows where id = '${HIDDEN}';
    `);
  }, 180000);

  afterAll(() => {
    if (!dataDir) return;
    spawnSync(join(pgRoot, "pg_ctl"), ["-D", dataDir, "-w", "-m", "immediate", "stop"], {
      encoding: "utf8",
    });
    rmSync(dataDir, { recursive: true, force: true });
  });

  function visible(userId: string, showId: string): string {
    return asUser(
      userId,
      `select coalesce(string_agg(id::text, ','), '') from public.shows where id = '${showId}';`
    );
  }

  it("hides an agent's hidden show from another brand", () => {
    expect(visible(BRAND_B, HIDDEN)).toBe("");
  });

  it("lets the creating agent read the hidden show", () => {
    expect(visible(AGENT_A, HIDDEN)).toBe(HIDDEN);
  });

  it("lets an approved rep read it and blocks pending and rejected reps", () => {
    expect(visible(REP_OK, HIDDEN)).toBe(HIDDEN);
    expect(visible(REP_PENDING, HIDDEN)).toBe("");
    expect(visible(REP_REJECTED, HIDDEN)).toBe("");
  });

  it("lets a deal participant read the hidden show on that deal", () => {
    expect(visible(BRAND_B, DEAL_HIDDEN)).toBe(DEAL_HIDDEN);
    expect(visible(SHOW_USER, DEAL_HIDDEN)).toBe("");
  });

  it("lets a verified show tie read the hidden show", () => {
    expect(visible(SHOW_USER, TIE_HIDDEN)).toBe(TIE_HIDDEN);
    expect(visible(OWNER_USER, OWNER_HIDDEN)).toBe(OWNER_HIDDEN);
    expect(visible(BRAND_B, OWNER_HIDDEN)).toBe("");
  });

  it("shows a discoverable row to every signed-in user", () => {
    expect(visible(BRAND_B, OPEN_SHOW)).toBe(OPEN_SHOW);
    expect(visible(REP_PENDING, OPEN_SHOW)).toBe(OPEN_SHOW);
  });

  it("denies anon and lets service_role read the hidden show", () => {
    const denied = loose("set role anon; select id from public.shows;");
    expect(denied.toLowerCase()).toContain("permission denied");
    expect(
      query(`
        set role service_role;
        select id::text from public.shows where id = '${HIDDEN}';
      `)
    ).toBe(HIDDEN);
  });

  it("leaves the grants and the one select policy", () => {
    expect(
      query(`
        select coalesce(string_agg(privilege_type, ',' order by privilege_type), '')
          from information_schema.role_table_grants
         where table_schema = 'public' and table_name = 'shows' and grantee = 'anon';
      `)
    ).toBe("");
    expect(
      query(`
        select coalesce(string_agg(privilege_type, ',' order by privilege_type), '')
          from information_schema.role_table_grants
         where table_schema = 'public' and table_name = 'shows' and grantee = 'PUBLIC';
      `)
    ).toBe("");
    expect(
      query(`
        select coalesce(string_agg(privilege_type, ',' order by privilege_type), '')
          from information_schema.role_table_grants
         where table_schema = 'public' and table_name = 'shows' and grantee = 'authenticated';
      `)
    ).toBe("SELECT");
    expect(
      query(`
        select coalesce(string_agg(privilege_type, ',' order by privilege_type), '')
          from information_schema.role_table_grants
         where table_schema = 'public' and table_name = 'shows'
           and grantee = 'service_role'
           and privilege_type in ('SELECT', 'INSERT', 'UPDATE', 'DELETE');
      `)
    ).toBe("DELETE,INSERT,SELECT,UPDATE");
    expect(
      query(`
        select coalesce(string_agg(polname, ',' order by polname), '')
          from pg_policy where polrelid = 'public.shows'::regclass;
      `)
    ).toBe("Shows readable by signed-in participants");
    expect(
      query(`
        select indexname
          from pg_indexes
         where schemaname = 'public'
           and indexname = 'idx_agent_shows_show_agent_approved';
      `)
    ).toBe("idx_agent_shows_show_agent_approved");
    expect(
      query(`
        select column_name
          from information_schema.columns
         where table_schema = 'public'
           and table_name = 'agent_show_relationships'
           and column_name = 'review_note';
      `)
    ).toBe("review_note");
  });

  it("uses an index for a hidden-show lookup", () => {
    expect(explainText).toContain("Index Scan using shows_pkey");
    expect(explainText).toContain("idx_deals_show");
    expect(explainText).toContain("idx_show_profiles_user");
  });

  it("returns the caller's own hidden shows from the #42 functions and no others", () => {
    expect(
      existsSync(i2bSqlPath()),
      "068_past_campaign_show_match.sql is not on disk"
    ).toBe(true);
    expect(
      asUser(
        BRAND_B,
        `select coalesce(string_agg(id::text, ',' order by id::text), '')
           from public.past_campaign_show_candidates(
             public.normalize_show_match_key('Hidden Desk')
           );`
      )
    ).toBe("");
    expect(
      asUser(
        AGENT_A,
        `select id::text
           from public.past_campaign_show_candidates(
             public.normalize_show_match_key('Hidden Desk')
           );`
      )
    ).toBe(HIDDEN);

    const agentImport = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1";
    const brandImport = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2";
    query(`
      insert into public.past_campaign_imports (id, brand_id, source_kind, status) values
        ('${agentImport}', '${AGENT_A}', 'csv', 'confirmed'),
        ('${brandImport}', '${BRAND_B}', 'csv', 'confirmed');
    `);
    expect(
      asUser(
        AGENT_A,
        `insert into public.past_campaign_records (import_id, brand_id, show_name)
         values ('${agentImport}', '${AGENT_A}', 'Hidden Desk')
         returning matched_show_id::text;`
      )
    ).toBe(HIDDEN);
    expect(
      asUser(
        BRAND_B,
        `insert into public.past_campaign_records (import_id, brand_id, show_name)
         values ('${brandImport}', '${BRAND_B}', 'Hidden Desk')
         returning coalesce(matched_show_id::text, '');`
      )
    ).toBe("");
    expect(
      query(`
        set role service_role;
        insert into public.past_campaign_records (import_id, brand_id, show_name)
        values ('${agentImport}', '${AGENT_A}', 'Hidden Desk')
        returning matched_show_id::text;
      `)
    ).toBe(HIDDEN);
  });
});
