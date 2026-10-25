// Migration 067. The SQL checks always run. The throwaway Postgres
// suite is skipped when Postgres binaries are absent. Never uses a
// hosted database.

import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const sqlPath = join(__dirname, "067_past_campaign_show_match.sql");
const sql = readFileSync(sqlPath, "utf8");
const statements = sql
  .split("\n")
  .filter((line) => !line.trim().startsWith("--"))
  .join("\n");

const BRAND = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const ACQUIRED = "33333333-3333-4333-8333-333333333333";
const SECOND = "44444444-4444-4444-8444-444444444444";
const HIDDEN_OTHER = "55555555-5555-4555-8555-555555555555";
const HIDDEN_MINE = "66666666-6666-4666-8666-666666666666";

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

describe("migration 067 sql", () => {
  it("documents that it is not applied and follows 066", () => {
    expect(sql).toContain(
      "NOT applied. Apply on ldtmhafewfifdizgfrnn only after merge and Chris's OK."
    );
    expect(sql).toContain("Apply only after 066.");
    expect(sql).toContain("061 is reserved.");
    expect(sql).not.toMatch(/migrations\/061/);
  });

  it("keeps the punctuation string aligned with the TypeScript key", () => {
    const match = sql.match(/\$punct\$(.*)\$punct\$/);
    expect(match?.[1]).toHaveLength(32);
    expect(match?.[1]).toBe("!\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~");
    expect(statements).toContain("repeat(' ', 37)");
  });

  it("skips ambiguous rows in the pool and does not grant anon", () => {
    expect(statements).toMatch(
      /rec\.show_match_status is null\s+or rec\.show_match_status = 'matched'/
    );
    expect(statements).toMatch(
      /revoke all on table public\.past_campaign_records from anon;/i
    );
    expect(statements).toMatch(
      /revoke truncate, references, trigger on table public\.past_campaign_records from authenticated;/i
    );
    expect(statements).not.toMatch(/\bgrant\b[^;]*\bto\s+anon\b/i);
    expect(statements).not.toMatch(/\bgrant\b[^;]*\bto\s+public\b/i);
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

describe.skipIf(!bin)("migration 067 on throwaway postgres", () => {
  const pgRoot = bin ?? "";
  let dataDir = "";
  let port = 0;

  function psql(args: string[]) {
    return spawnSync(join(pgRoot, "psql"), args, {
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${pgRoot}:${process.env.PATH ?? ""}`,
        LC_ALL: "C",
        PGCLIENTENCODING: "UTF8",
      },
    });
  }

  function query(statement: string): string {
    const result = psql([
      "-h", dataDir, "-p", String(port), "-U", "postgres", "-d", "i2b",
      "-v", "ON_ERROR_STOP=1", "-X", "-q", "-At", "-c", statement,
    ]);
    if (result.status !== 0) {
      throw new Error(result.stderr || result.stdout || statement);
    }
    return (result.stdout ?? "").trim();
  }

  function loose(statement: string): string {
    const result = psql([
      "-h", dataDir, "-p", String(port), "-U", "postgres", "-d", "i2b",
      "-X", "-c", statement,
    ]);
    return `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  }

  beforeAll(async () => {
    dataDir = mkdtempSync(join(tmpdir(), "i2b-pg-"));
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
    psql(["-h", dataDir, "-p", String(port), "-U", "postgres", "-d", "postgres", "-c", "create database i2b;"]);
    query(`
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
      end $$;

      create schema if not exists auth;
      create table public.test_auth_uid (id uuid);
      insert into public.test_auth_uid (id) values (null);
      create or replace function auth.uid() returns uuid
      language sql stable security definer set search_path = public
      as $fn$ select id from public.test_auth_uid limit 1; $fn$;
      grant usage on schema auth to authenticated;
      grant execute on function auth.uid() to authenticated;

      create table public.shows (
        id uuid primary key,
        name text not null,
        is_discoverable boolean not null default true,
        agent_id uuid,
        categories text[] not null default '{}'
      );
      alter table public.shows enable row level security;
      create policy "Shows are publicly readable" on public.shows for select using (true);
      grant select on table public.shows to anon;
      grant select on table public.shows to authenticated;

      create table public.past_campaign_imports (
        id uuid primary key,
        brand_id uuid not null,
        status text not null default 'confirmed',
        pooling_consent boolean not null default false
      );

      create table public.past_campaign_records (
        id uuid primary key default gen_random_uuid(),
        import_id uuid not null,
        brand_id uuid not null,
        show_name text not null,
        matched_show_id uuid references public.shows(id) on delete set null,
        placement text,
        price_type text,
        rate numeric,
        conversions integer,
        downloads integer
      );

      create table public.pooled_import_priors (
        id uuid primary key default gen_random_uuid(),
        category text not null,
        placement text,
        price_type text,
        brand_count integer not null,
        record_count integer not null,
        median_cpm numeric,
        median_conversions_per_1k_downloads numeric,
        refreshed_at timestamptz not null default now()
      );

      grant select, insert, update, delete, truncate, references, trigger
        on public.past_campaign_records to authenticated;
      grant select on public.past_campaign_records to anon;
      grant select, insert, update, delete on public.past_campaign_records to service_role;
      grant select, insert, update, delete on public.past_campaign_imports to service_role;
      grant select on public.shows to service_role;
      grant select, insert, update, delete on public.pooled_import_priors to service_role;
    `);
    const applied = psql([
      "-h", dataDir, "-p", String(port), "-U", "postgres", "-d", "i2b",
      "-v", "ON_ERROR_STOP=1", "-X", "-q", "-f", sqlPath,
    ]);
    if (applied.status !== 0) {
      throw new Error(applied.stderr || applied.stdout || "067 failed");
    }
    const again = psql([
      "-h", dataDir, "-p", String(port), "-U", "postgres", "-d", "i2b",
      "-v", "ON_ERROR_STOP=1", "-X", "-q", "-f", sqlPath,
    ]);
    if (again.status !== 0) {
      throw new Error(again.stderr || again.stdout || "067 re-run failed");
    }
  });

  afterAll(() => {
    if (!dataDir) return;
    spawnSync(join(pgRoot, "pg_ctl"), ["-D", dataDir, "-w", "-m", "immediate", "stop"], {
      encoding: "utf8",
    });
    rmSync(dataDir, { recursive: true, force: true });
  });

  function resetRows(): void {
    query(`
      truncate public.past_campaign_records, public.past_campaign_imports,
        public.pooled_import_priors, public.shows, public.test_auth_uid;
      insert into public.test_auth_uid (id) values ('${BRAND}');
    `);
  }

  it("normalizes the same cases as the TypeScript key", () => {
    expect(
      query(`
        select coalesce(public.normalize_show_match_key(input), '')
          from (values
            (1, 'Acquired'),
            (2, 'ACQUIRED'),
            (3, 'The Acquired'),
            (4, 'The The Acquired'),
            (5, 'Acquired Podcast'),
            (6, 'Acquired Show'),
            (7, 'The Acquired Podcast'),
            (8, 'The Acquired Show!'),
            (9, '  the   acquired   podcast  '),
            (10, E'the\\tacquired\\tpodcast'),
            (11, 'Odd Lots, Bloomberg'),
            (12, 'Joe''s Podcast'),
            (13, 'Acquired (Podcast)'),
            (14, 'My-Show'),
            (15, 'Daily Show Podcast'),
            (16, 'The Show'),
            (17, 'Show'),
            (18, 'theater'),
            (19, 'showing'),
            (20, 'the'),
            (21, '!!!'),
            (22, 'Café Podcast')
          ) as samples(ord, input)
         order by ord;
      `)
    ).toBe(
      [
        "acquired",
        "acquired",
        "acquired",
        "acquired",
        "acquired",
        "acquired",
        "acquired",
        "acquired",
        "acquired",
        "acquired",
        "odd lots bloomberg",
        "joe s",
        "acquired",
        "my",
        "daily",
        "show",
        "show",
        "theater",
        "showing",
        "the",
        "",
        "café",
      ].join("\n")
    );
  });

  it("overwrites a hand-picked show id and keeps hidden shows private", () => {
    resetRows();
    query(`
      insert into public.shows (id, name, is_discoverable, agent_id) values
        ('${ACQUIRED}', 'Acquired', true, null),
        ('${SECOND}', 'Other Show', true, null),
        ('${HIDDEN_OTHER}', 'Secret', false, '${OTHER}'),
        ('${HIDDEN_MINE}', 'Mine', false, '${BRAND}');
    `);

    expect(
      query(`
        insert into public.past_campaign_records
          (import_id, brand_id, show_name, matched_show_id)
        values
          ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', '${BRAND}', 'The Acquired Podcast!', '${SECOND}')
        returning matched_show_id::text || '|' || show_match_status || '|' ||
          show_match_reason || '|' || show_match_confidence::text;
      `)
    ).toBe(`${ACQUIRED}|matched|unique_normalized_name|1`);

    expect(
      query(`
        insert into public.past_campaign_records (import_id, brand_id, show_name)
        values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2', '${BRAND}', 'Mystery Hour')
        returning coalesce(matched_show_id::text, '') || '|' || show_match_status || '|' ||
          show_match_reason || '|' || show_match_confidence::text;
      `)
    ).toBe("|ambiguous|no_normalized_match|0");

    query(`
      insert into public.shows (id, name, is_discoverable, agent_id)
      values ('${SECOND}', 'Acquired Show', true, null)
      on conflict (id) do update set name = excluded.name, is_discoverable = true;
    `);
    expect(
      query(`
        insert into public.past_campaign_records (import_id, brand_id, show_name, matched_show_id)
        values (
          'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3',
          '${BRAND}',
          'Acquired',
          '${ACQUIRED}'
        )
        returning coalesce(matched_show_id::text, '') || '|' || show_match_reason;
      `)
    ).toBe("|multiple_normalized_matches");

    expect(
      query(`
        insert into public.past_campaign_records (import_id, brand_id, show_name, matched_show_id)
        values (
          'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4',
          '${BRAND}',
          'Secret Podcast',
          '${ACQUIRED}'
        )
        returning coalesce(matched_show_id::text, '') || '|' || show_match_reason;
      `)
    ).toBe("|no_normalized_match");

    expect(
      query(`
        insert into public.past_campaign_records (import_id, brand_id, show_name)
        values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5', '${BRAND}', 'The Mine Show')
        returning matched_show_id::text || '|' || show_match_reason;
      `)
    ).toBe(`${HIDDEN_MINE}|unique_normalized_name`);

    expect(
      query(`
        update public.past_campaign_records
           set show_name = 'Nope', matched_show_id = '${ACQUIRED}'
         where import_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
        returning coalesce(matched_show_id::text, '') || '|' || show_match_reason;
      `)
    ).toBe("|no_normalized_match");
  });

  it("rejects a matched status without a show id when the trigger is off", () => {
    query(`
      do $$
      begin
        alter table public.past_campaign_records
          disable trigger past_campaign_records_show_match;
        begin
          insert into public.past_campaign_records (
            import_id, brand_id, show_name, show_match_status,
            show_match_reason, show_match_confidence
          ) values (
            'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa9',
            '${BRAND}',
            'Acquired',
            'matched',
            'unique_normalized_name',
            1
          );
          raise exception 'check did not fire';
        exception
          when check_violation then
            null;
        end;
        alter table public.past_campaign_records
          enable trigger past_campaign_records_show_match;
      end $$;
    `);
    expect(
      query(`
        select tgenabled::text
          from pg_trigger
         where tgname = 'past_campaign_records_show_match'
           and not tgisinternal;
      `)
    ).toBe("O");
    expect(
      query(`
        select count(*)::text
          from public.past_campaign_records
         where import_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa9';
      `)
    ).toBe("0");
  });

  it("returns only shows this caller may link", () => {
    resetRows();
    query(`
      insert into public.shows (id, name, is_discoverable, agent_id) values
        ('${ACQUIRED}', 'Acquired', true, null),
        ('${HIDDEN_OTHER}', 'The Acquired Podcast', false, '${OTHER}'),
        ('${HIDDEN_MINE}', 'Secret', false, '${BRAND}');
      update public.test_auth_uid set id = '${BRAND}';
    `);

    expect(
      query(`
        set role authenticated;
        select coalesce(string_agg(id::text, ',' order by id::text), '')
          from public.past_campaign_show_candidates('acquired');
      `)
    ).toBe(ACQUIRED);

    expect(
      query(`
        set role authenticated;
        select coalesce(string_agg(id::text, ',' order by id::text), '')
          from public.past_campaign_show_candidates('secret');
      `)
    ).toBe(HIDDEN_MINE);

    query(`update public.test_auth_uid set id = '${OTHER}';`);
    expect(
      query(`
        set role authenticated;
        select coalesce(string_agg(id::text, ',' order by id::text), '')
          from public.past_campaign_show_candidates('secret');
      `)
    ).toBe("");

    query(`
      insert into public.shows (id, name, is_discoverable, agent_id)
      values ('${SECOND}', 'Acquired Show', true, null);
    `);
    expect(
      query(`
        set role authenticated;
        select count(*)::text from public.past_campaign_show_candidates('acquired');
      `)
    ).toBe("2");

    const anon = loose(`
      set role anon;
      select * from public.past_campaign_show_candidates('acquired');
    `);
    expect(anon.toLowerCase()).toContain("permission denied");
  });

  it("keeps an ambiguous consented row out of the pool", () => {
    resetRows();
    query(`
      insert into public.shows (id, name, is_discoverable, agent_id, categories)
      values ('${ACQUIRED}', 'Acquired', true, null, array['Business']);

      insert into public.past_campaign_imports (id, brand_id, status, pooling_consent)
      select (
          '20000000-0000-4000-8000-' || lpad(n::text, 12, '0')
        )::uuid,
        (
          '10000000-0000-4000-8000-' || lpad(n::text, 12, '0')
        )::uuid,
        'confirmed',
        true
      from generate_series(1, 7) as n;

      insert into public.past_campaign_records
        (import_id, brand_id, show_name, placement, price_type, rate)
      select (
          '20000000-0000-4000-8000-' || lpad(n::text, 12, '0')
        )::uuid,
        (
          '10000000-0000-4000-8000-' || lpad(n::text, 12, '0')
        )::uuid,
        'The Acquired Podcast',
        'mid-roll',
        'cpm',
        25
      from generate_series(1, 5) as n;
    `);

    query(`
      alter table public.past_campaign_records disable trigger past_campaign_records_show_match;
      insert into public.past_campaign_records
        (import_id, brand_id, show_name, matched_show_id, placement, price_type, rate)
      values (
        '20000000-0000-4000-8000-000000000006',
        '10000000-0000-4000-8000-000000000006',
        'Legacy name',
        '${ACQUIRED}',
        'mid-roll',
        'cpm',
        30
      );
      alter table public.past_campaign_records enable trigger past_campaign_records_show_match;
    `);

    query(`
      insert into public.past_campaign_records
        (import_id, brand_id, show_name, matched_show_id, placement, price_type, rate)
      values (
        '20000000-0000-4000-8000-000000000007',
        '10000000-0000-4000-8000-000000000007',
        'Nope',
        '${ACQUIRED}',
        'mid-roll',
        'cpm',
        99
      );
    `);

    expect(
      query(`
        select coalesce(matched_show_id::text, '') || '|' || show_match_status
          from public.past_campaign_records
         where brand_id = '10000000-0000-4000-8000-000000000007';
      `)
    ).toBe("|ambiguous");

    expect(
      query(`
        set role service_role;
        select public.refresh_pooled_import_priors()::text;
      `)
    ).toBe("1");

    expect(
      query(`
        select brand_count::text || '|' || record_count::text || '|' || category
          from public.pooled_import_priors;
      `)
    ).toBe("6|6|Business");

    const denied = loose(`
      set role authenticated;
      select public.refresh_pooled_import_priors();
    `);
    expect(denied.toLowerCase()).toContain("permission denied");
  });

  it("leaves anon and public with nothing on past_campaign_records", () => {
    expect(
      query(`
        select count(*)::text
          from information_schema.role_table_grants
         where table_schema = 'public'
           and table_name = 'past_campaign_records'
           and grantee in ('anon', 'PUBLIC');
      `)
    ).toBe("0");

    expect(
      query(`
        select coalesce(string_agg(privilege_type, ',' order by privilege_type), '')
          from information_schema.role_table_grants
         where table_schema = 'public'
           and table_name = 'past_campaign_records'
           and grantee = 'authenticated';
      `)
    ).toBe("DELETE,INSERT,SELECT,UPDATE");

    expect(
      query(`
        select count(*)::text
          from information_schema.routine_privileges
         where routine_schema = 'public'
           and routine_name in (
             'normalize_show_match_key',
             'past_campaign_show_candidates',
             'enforce_past_campaign_show_match',
             'refresh_pooled_import_priors'
           )
           and grantee in ('anon', 'PUBLIC');
      `)
    ).toBe("0");

    expect(
      query(`
        select count(*)::text
          from pg_trigger
         where tgname = 'past_campaign_records_show_match'
           and not tgisinternal;
      `)
    ).toBe("1");
  });
});
