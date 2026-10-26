// Migration 069. Static SQL checks always run. The throwaway Postgres
// suite applies 001 through 069 and is skipped when Postgres binaries
// are absent. Never uses a hosted database.

import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const sqlPath = join(__dirname, "069_pooled_deal_priors.sql");
const sql = readFileSync(sqlPath, "utf8");
const statements = sql
  .split("\n")
  .filter((line) => !line.trim().startsWith("--"))
  .join("\n");

function tableBody(): string {
  const start = statements.search(/create table if not exists public\.pooled_deal_priors/i);
  expect(start).toBeGreaterThanOrEqual(0);
  const end = statements.indexOf(";", start);
  return statements.slice(start, end);
}

describe("migration 069 sql", () => {
  it("is not applied and documents the grant introspection", () => {
    expect(sql).toContain(
      "NOT applied. Apply on ldtmhafewfifdizgfrnn only after merge and Chris's OK."
    );
    expect(sql).toContain("information_schema.role_table_grants");
    expect(sql).toContain("information_schema.routine_privileges");
    expect(statements).not.toMatch(/cron\.schedule|pg_cron/i);
  });

  it("creates an anonymized deal prior table with no identifier columns", () => {
    const body = tableBody();
    expect(body).toMatch(/category\s+text not null/i);
    expect(body).toMatch(/brand_count\s+integer not null/i);
    expect(body).toMatch(/deal_count\s+integer not null/i);
    expect(body).toMatch(/median_cpm\s+numeric/i);
    expect(body).toMatch(/median_conversions_per_1k_downloads\s+numeric/i);
    expect(body).not.toMatch(
      /\bbrand_id\b|\bdeal_id\b|\bshow_id\b|\buser_id\b|\bbooking_id\b|\bmatched_show_id\b/i
    );
    const insert = statements.match(
      /insert into public\.pooled_deal_priors \(([\s\S]*?)\)/i
    );
    expect(insert?.[1] ?? "").not.toMatch(/brand_id|deal_id|show_id|user_id|booking_id/);
    expect(statements).toMatch(/check \(brand_count >= 5\)/i);
    expect(statements).toMatch(/having count\(distinct rows\.brand_key\) >= 5/i);
    expect(statements).toMatch(/delete from public\.pooled_deal_priors where true/i);
  });

  it("grants DML and execute to service_role only", () => {
    expect(statements).toMatch(
      /grant select, insert, update, delete on public\.pooled_deal_priors to service_role;/i
    );
    expect(statements).toMatch(/revoke all on table public\.pooled_deal_priors from public;/i);
    expect(statements).toMatch(/revoke all on table public\.pooled_deal_priors from anon;/i);
    expect(statements).toMatch(
      /revoke all on table public\.pooled_deal_priors from authenticated;/i
    );
    expect(statements).toMatch(
      /revoke truncate, references, trigger on table public\.pooled_deal_priors from authenticated;/i
    );
    expect(statements).not.toMatch(
      /grant\s+[a-z,\s]+\s+on\s+(?:table\s+)?public\.pooled_deal_priors\s+to\s+(authenticated|anon|public)\b/i
    );
    expect(statements).toMatch(
      /grant execute on function public\.refresh_pooled_deal_priors\(\) to service_role;/i
    );
    expect(statements).not.toMatch(
      /grant execute on function public\.refresh_pooled_deal_priors\(\) to (authenticated|anon|public)/i
    );
    expect(statements).toMatch(/security invoker/i);
    expect(statements).not.toMatch(/security definer/i);
    expect(statements).not.toMatch(/create policy/i);
  });

  it("does not write shows or public show stats", () => {
    expect(statements).not.toMatch(
      /\b(insert into|update|delete from)\s+public\.(shows|show_profiles|show_surfaces|benchmarks|pooled_import_priors)\b/i
    );
  });

  it("leaves refresh_pooled_import_priors to 068", () => {
    expect(statements).not.toMatch(
      /create or replace function public\.refresh_pooled_import_priors/i
    );
    expect(statements).not.toMatch(
      /grant execute on function public\.refresh_pooled_import_priors/i
    );
    expect(statements).not.toMatch(
      /revoke all on function public\.refresh_pooled_import_priors/i
    );
    expect(statements).not.toMatch(
      /comment on function public\.refresh_pooled_import_priors/i
    );
    expect(sql).toContain("-- 069:");
    expect(sql).not.toMatch(/^-- 067:/m);
  });
});

function pgBin(): string | null {
  const fromEnv = process.env.S1_PG_BIN;
  const candidates = [
    fromEnv,
    "/usr/lib/postgresql/16/bin",
    "/usr/lib/postgresql/17/bin",
    "/usr/lib/postgresql/15/bin",
  ].filter((dir): dir is string => Boolean(dir));
  for (const dir of candidates) {
    if (existsSync(join(dir, "initdb")) && existsSync(join(dir, "psql"))) return dir;
  }
  return null;
}

function migrationsThrough069(): string[] {
  return readdirSync(__dirname)
    .filter((name) => /^\d{3}_.+\.sql$/.test(name))
    .map((name) => ({ name, n: Number(name.slice(0, 3)) }))
    .filter((row) => row.n >= 1 && row.n <= 69)
    .sort((a, b) => a.n - b.n || a.name.localeCompare(b.name))
    .map((row) => join(__dirname, row.name));
}

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

describe.skipIf(!bin)("migration 069 on throwaway postgres", () => {
  const pgRoot = bin ?? "";
  let dataDir = "";
  let port = 0;

  function psql(args: string[], db = "l2") {
    return spawnSync(join(pgRoot, "psql"), args, {
      encoding: "utf8",
      env: { ...process.env, PATH: `${pgRoot}:${process.env.PATH ?? ""}`, LC_ALL: "C" },
    });
  }

  function query(statement: string): string {
    const result = psql([
      "-h", dataDir, "-p", String(port), "-U", "postgres", "-d", "l2",
      "-v", "ON_ERROR_STOP=1", "-X", "-q", "-At", "-c", statement,
    ]);
    if (result.status !== 0) throw new Error(result.stderr || result.stdout || statement);
    return (result.stdout ?? "").trim();
  }

  function loose(statement: string): string {
    const result = psql([
      "-h", dataDir, "-p", String(port), "-U", "postgres", "-d", "l2",
      "-X", "-c", statement,
    ]);
    return `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  }

  function file(path: string): void {
    const result = psql([
      "-h", dataDir, "-p", String(port), "-U", "postgres", "-d", "l2",
      "-v", "ON_ERROR_STOP=1", "-X", "-q", "-f", path,
    ]);
    if (result.status !== 0) {
      throw new Error(`${path}\n${result.stderr || result.stdout || "migration failed"}`);
    }
  }

  function uid(n: number): string {
    return `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  }

  beforeAll(async () => {
    dataDir = mkdtempSync(join(tmpdir(), "l2-pg-"));
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
    psql(
      ["-h", dataDir, "-p", String(port), "-U", "postgres", "-d", "postgres", "-c", "create database l2;"],
      "postgres"
    );
    const stub = psql([
      "-h", dataDir, "-p", String(port), "-U", "postgres", "-d", "l2",
      "-v", "ON_ERROR_STOP=1", "-X", "-q", "-c", `
        create schema if not exists auth;
        create table if not exists auth.users (id uuid primary key);
        create or replace function auth.uid()
        returns uuid language sql stable as $$
          select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
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
        end $$;
        create table if not exists public.show_claims (id uuid primary key default gen_random_uuid());
        create table if not exists public.outcomes (id uuid primary key default gen_random_uuid());
      `,
    ]);
    if (stub.status !== 0) throw new Error(stub.stderr || stub.stdout || "stub failed");

    for (const path of migrationsThrough069()) {
      // 001 does not add shows.agent_id. The live table has it, and 068 reads it.
      if (path.endsWith("068_past_campaign_show_match.sql")) {
        query("alter table public.shows add column if not exists agent_id uuid;");
      }
      file(path);
    }
    file(sqlPath);
    seed();
  }, 180_000);

  function seed(): void {
    const brand = (n: number) => uid(n);
    const show = (n: number) => uid(100 + n);
    const deal = (n: number) => uid(200 + n);
    const lines: string[] = [];
    for (let n = 1; n <= 24; n += 1) {
      lines.push(`insert into auth.users (id) values ('${brand(n)}');`);
      lines.push(
        `insert into public.profiles (id, email, role) values ('${brand(n)}', 'b${n}@example.com', 'brand');`
      );
    }
    lines.push(`
      insert into public.shows (id, name, platform, categories) values
        ('${show(1)}', 'Crime', 'podcast', array['True Crime']),
        ('${show(2)}', 'News', 'podcast', array['News']),
        ('${show(3)}', 'Comedy', 'podcast', array['Comedy']),
        ('${show(4)}', 'Health', 'podcast', array['Health']),
        ('${show(5)}', 'Imports', 'podcast', array['Imports']);
      insert into public.campaigns (id, user_id, name, budget_total)
        values ('${uid(900)}', '${brand(1)}', 'Pool', 1000);
      insert into public.brand_profiles (id, user_id)
        values ('${uid(800)}', '${brand(21)}'), ('${uid(801)}', '${brand(22)}');
    `);
    const addDeal = (opts: {
      n: number;
      showN: number;
      brandN: number;
      status: string;
      price?: string;
      agreed?: number | null;
      cancelled?: boolean;
      profile?: string | null;
    }) => {
      lines.push(`
        insert into public.deals (
          id, show_id, brand_id, brand_profile_id, status, num_episodes, placement,
          ad_format, price_type, cpm_rate, agreed_cpm, agreed_episode_count,
          guaranteed_downloads, net_per_episode, total_net, flight_start, flight_end,
          cancelled_at
        ) values (
          '${deal(opts.n)}', '${show(opts.showN)}', '${brand(opts.brandN)}',
          ${opts.profile ? `'${opts.profile}'` : "null"},
          '${opts.status}', 1, 'pre-roll', 'host_read', '${opts.price ?? "cpm"}',
          1, ${opts.agreed ?? "null"}, 1, 1000, 10, 10, '2026-01-01', '2026-02-01',
          ${opts.cancelled ? "now()" : "null"}
        );
      `);
    };
    const crimeCpms = [20, 25, 30, 40, 50];
    crimeCpms.forEach((cpm, index) => {
      addDeal({
        n: index + 1,
        showN: 1,
        brandN: index + 1,
        status: index === 4 ? "signed" : "completed",
        agreed: cpm,
      });
    });
    addDeal({ n: 6, showN: 1, brandN: 6, status: "completed", agreed: 999, cancelled: true });
    addDeal({ n: 9, showN: 1, brandN: 9, status: "show_signed", agreed: 999 });
    addDeal({ n: 7, showN: 1, brandN: 7, status: "brand_signed", agreed: 999 });
    addDeal({ n: 8, showN: 1, brandN: 8, status: "planning", agreed: 999 });
    for (let n = 1; n <= 4; n += 1) {
      addDeal({ n: 10 + n, showN: 2, brandN: 8 + n, status: "completed", agreed: 15 });
    }
    for (let n = 1; n <= 5; n += 1) {
      addDeal({
        n: 20 + n,
        showN: 3,
        brandN: 12 + n,
        status: "live",
        price: "flat_rate",
        agreed: 400,
      });
    }
    addDeal({ n: 30, showN: 4, brandN: 21, status: "completed", agreed: 10, profile: uid(800) });
    addDeal({ n: 31, showN: 4, brandN: 22, status: "completed", agreed: 10, profile: uid(800) });
    addDeal({ n: 32, showN: 4, brandN: 23, status: "delivering", agreed: 12 });
    addDeal({ n: 33, showN: 4, brandN: 24, status: "signed", agreed: 14 });
    for (let n = 1; n <= 5; n += 1) {
      lines.push(`
        insert into public.deal_conversion_reports (deal_id, campaign_id, reported_conversions)
        values ('${deal(n)}', '${uid(900)}', 10);
      `);
    }
    for (let n = 1; n <= 5; n += 1) {
      lines.push(`
        insert into public.past_campaign_imports (id, brand_id, source_kind, status, pooling_consent)
        values ('${uid(400 + n)}', '${brand(n)}', 'csv', 'confirmed', true);
        insert into public.past_campaign_records (
          import_id, brand_id, show_name, matched_show_id, placement, price_type, rate, downloads, conversions
        ) values (
          '${uid(400 + n)}', '${brand(n)}', 'Imports', '${show(5)}', 'mid-roll', 'cpm', ${20 + n}, 1000, 5
        );
      `);
    }
    lines.push(`
      insert into public.past_campaign_imports (id, brand_id, source_kind, status, pooling_consent)
      values ('${uid(406)}', '${brand(6)}', 'csv', 'confirmed', false);
      insert into public.past_campaign_records (
        import_id, brand_id, show_name, matched_show_id, placement, price_type, rate
      ) values (
        '${uid(406)}', '${brand(6)}', 'Imports', '${show(5)}', 'mid-roll', 'cpm', 99
      );
    `);
    query(lines.join("\n"));
  }

  afterAll(() => {
    if (!dataDir) return;
    spawnSync(join(pgRoot, "pg_ctl"), ["-D", dataDir, "-w", "-m", "immediate", "stop"], {
      encoding: "utf8",
    });
    rmSync(dataDir, { recursive: true, force: true });
  });

  function refreshDeals(): string {
    return query("set role service_role; select public.refresh_pooled_deal_priors();");
  }

  it("pools 5 booked brands, ignores 4, and ignores cancelled or unsigned deals", () => {
    expect(refreshDeals()).toBe("2");
    const rows = query(`
      select category || '|' || coalesce(placement, '') || '|' || coalesce(price_type, '')
             || '|' || brand_count || '|' || deal_count || '|' || coalesce(median_cpm::text, '')
             || '|' || coalesce(median_conversions_per_1k_downloads::text, '')
        from public.pooled_deal_priors
       order by category;
    `);
    expect(rows).toBe(["Comedy|pre-roll|flat|5|5||", "True Crime|pre-roll|cpm|5|5|30|10"].join("\n"));
    expect(query("select count(*)::text from public.pooled_deal_priors where category = 'News';")).toBe("0");
    expect(query("select count(*)::text from public.pooled_deal_priors where category = 'Health';")).toBe("0");
    const columns = query(`
      select string_agg(column_name, ',' order by ordinal_position)
        from information_schema.columns
       where table_schema = 'public' and table_name = 'pooled_deal_priors';
    `);
    expect(columns).toBe(
      "id,category,placement,price_type,brand_count,deal_count,median_cpm,median_conversions_per_1k_downloads,refreshed_at"
    );
    expect(columns).not.toMatch(/brand_id|deal_id|show_id|user_id/);
  });

  it("prefers outcome impressions when those columns exist", () => {
    query(`
      alter table public.outcomes
        add column if not exists booking_id uuid,
        add column if not exists show_id uuid,
        add column if not exists reported_impressions integer,
        add column if not exists reported_conversions integer,
        add column if not exists created_at timestamptz default now();
      insert into public.outcomes (booking_id, show_id, reported_impressions, reported_conversions)
      select id, show_id, 2000, 40 from public.deals
       where status in ('signed', 'live', 'delivering', 'completed');
    `);
    refreshDeals();
    expect(
      query(`
        select median_conversions_per_1k_downloads::text
          from public.pooled_deal_priors
         where category = 'True Crime';
      `)
    ).toBe("20");
  });

  it("keeps ambiguous and hidden-show rows out of the import pool", () => {
    const definition = query(
      "select pg_get_functiondef('public.refresh_pooled_import_priors()'::regprocedure);"
    );
    expect(definition).toContain("rec.matched_show_id is not null");
    expect(definition).toContain("rec.show_match_status is null");
    expect(definition).toContain("rec.show_match_status = 'matched'");
    expect(definition).toContain("sh.is_discoverable");
    expect(query("set role service_role; select public.refresh_pooled_import_priors();")).toBe("1");
    expect(
      query(`
        select brand_count::text || '|' || coalesce(median_cpm::text, '')
          from public.pooled_import_priors
         where category = 'Imports';
      `)
    ).toBe("5|23");

    query(`
      update public.past_campaign_records
         set show_match_status = 'ambiguous',
             matched_show_id = null,
             show_match_reason = 'no_normalized_match',
             show_match_confidence = 0
       where brand_id = '${uid(1)}';
    `);
    expect(query("set role service_role; select public.refresh_pooled_import_priors();")).toBe("0");

    query(`
      update public.past_campaign_records
         set show_match_status = 'matched',
             matched_show_id = (select id from public.shows where name = 'Imports'),
             show_match_reason = 'unique_normalized_name',
             show_match_confidence = 1
       where brand_id = '${uid(1)}';
    `);
    expect(query("set role service_role; select public.refresh_pooled_import_priors();")).toBe("1");

    query(`update public.shows set is_discoverable = false where name = 'Imports';`);
    expect(query("set role service_role; select public.refresh_pooled_import_priors();")).toBe("0");
    query(`update public.shows set is_discoverable = true where name = 'Imports';`);
    expect(query("set role service_role; select public.refresh_pooled_import_priors();")).toBe("1");

    query(`update public.past_campaign_records set matched_show_id = null, show_match_status = null, show_match_reason = null, show_match_confidence = null;`);
    expect(query("set role service_role; select public.refresh_pooled_import_priors();")).toBe("0");
  });

  it("denies anon and authenticated, and re-runs cleanly", () => {
    const tableGrants = query(`
      select coalesce(string_agg(grantee || ' ' || privilege_type, ',' order by grantee, privilege_type), '')
        from information_schema.role_table_grants
       where table_schema = 'public'
         and table_name = 'pooled_deal_priors'
         and grantee in ('anon', 'authenticated', 'PUBLIC', 'service_role');
    `);
    expect(tableGrants).toBe(
      "service_role DELETE,service_role INSERT,service_role SELECT,service_role UPDATE"
    );
    const routines = query(`
      select coalesce(string_agg(routine_name || ' ' || grantee || ' ' || privilege_type, ','
                    order by routine_name, grantee, privilege_type), '')
        from information_schema.routine_privileges
       where routine_schema = 'public'
         and routine_name in ('refresh_pooled_deal_priors', 'refresh_pooled_import_priors')
         and grantee in ('anon', 'authenticated', 'PUBLIC', 'service_role');
    `);
    expect(routines).toBe(
      "refresh_pooled_deal_priors service_role EXECUTE,refresh_pooled_import_priors service_role EXECUTE"
    );

    for (const statement of [
      "set role anon; select * from public.pooled_deal_priors;",
      "set role authenticated; select * from public.pooled_deal_priors;",
      "set role anon; truncate public.pooled_deal_priors;",
      "set role authenticated; truncate public.pooled_deal_priors;",
      "set role anon; select public.refresh_pooled_deal_priors();",
      "set role authenticated; select public.refresh_pooled_deal_priors();",
    ]) {
      const failed = loose(statement);
      expect(failed.toLowerCase(), statement).toContain("permission denied");
    }

    file(sqlPath);
    expect(refreshDeals()).toBe("2");
    expect(tableGrants).toBe(
      query(`
        select coalesce(string_agg(grantee || ' ' || privilege_type, ',' order by grantee, privilege_type), '')
          from information_schema.role_table_grants
         where table_schema = 'public'
           and table_name = 'pooled_deal_priors'
           and grantee in ('anon', 'authenticated', 'PUBLIC', 'service_role');
      `)
    );
  });
});
