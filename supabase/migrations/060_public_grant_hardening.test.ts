// Migration 060 on a throwaway Postgres. Applies 001 through 058, grants
// the live excess privileges, then checks 060. Never uses a hosted database.

import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const LISTED = [
  "analog_matches",
  "api_cache_log",
  "brand_profiles",
  "campaign_patterns",
  "campaigns",
  "conviction_scores",
  "deals",
  "discovery_locks",
  "domain_events",
  "event_log",
  "founder_annotations",
  "insertion_orders",
  "interpretation_locks",
  "invoice_line_items",
  "invoices",
  "io_line_items",
  "outcomes",
  "outreaches",
  "payments",
  "payouts",
  "profiles",
  "ring_hypotheses",
  "show_claims",
  "show_profiles",
  "show_sponsors",
  "shows",
] as const;

const SERVICE_ONLY = [
  "api_cache_log",
  "domain_events",
  "event_log",
  "show_claims",
] as const;

const APP_TABLES = LISTED.filter(
  (table) => !(SERVICE_ONLY as readonly string[]).includes(table)
);

const sqlPath = join(__dirname, "060_public_grant_hardening.sql");
const sql = readFileSync(sqlPath, "utf8");
const statements = sql
  .split("\n")
  .filter((line) => !line.trim().startsWith("--"))
  .join("\n");

function pgBin(): string {
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
  throw new Error(
    "PostgreSQL binaries not found. Install the server or set S1_PG_BIN."
  );
}

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

function earlierMigrations(): string[] {
  return readdirSync(__dirname)
    .filter((name) => /^\d{3}_.+\.sql$/.test(name))
    .map((name) => ({ name, n: Number(name.slice(0, 3)) }))
    .filter((row) => row.n >= 1 && row.n < 60)
    .sort((a, b) => a.n - b.n || a.name.localeCompare(b.name))
    .map((row) => join(__dirname, row.name));
}

describe("migration 060 sql", () => {
  it("documents that it is not applied and does not touch service_role", () => {
    expect(sql).toContain(
      "NOT applied. Apply on ldtmhafewfifdizgfrnn only after merge and Chris's OK."
    );
    expect(sql).toContain("information_schema.role_table_grants");
    expect(statements).not.toMatch(/\bto\s+service_role\b/i);
    expect(statements).not.toMatch(/\bfrom\s+service_role\b/i);
    expect(statements).not.toMatch(/create policy/i);
    expect(statements).not.toMatch(/drop table/i);
    expect(statements).not.toMatch(/drop policy/i);
  });

  it("leaves anon exactly one grant, select on shows", () => {
    const grants = statements.match(/grant\b[^;]*\bto\s+anon\s*;/gi) ?? [];
    expect(grants.map((grant) => grant.replace(/\s+/g, " ").trim())).toEqual([
      "grant select on table public.shows to anon;",
    ]);
    expect(statements).toMatch(
      /revoke all on table public\.shows from anon;/i
    );
    expect(statements).toMatch(
      /revoke all on table public\.shows from public;/i
    );
  });

  it("revokes anon and public on the other tables and locks the four", () => {
    for (const table of LISTED) {
      if (table !== "shows") {
        expect(statements).toMatch(
          new RegExp(`revoke all on table public\\.${table} from anon;`, "i")
        );
        expect(statements).toMatch(
          new RegExp(`revoke all on table public\\.${table} from public;`, "i")
        );
      }
      expect(statements).toMatch(
        new RegExp(
          `revoke truncate, references, trigger on table public\\.${table} from authenticated;`,
          "i"
        )
      );
      expect(statements).toMatch(
        new RegExp(
          `alter table public\\.${table} enable row level security;`,
          "i"
        )
      );
    }
    for (const table of SERVICE_ONLY) {
      expect(statements).toMatch(
        new RegExp(
          `revoke all on table public\\.${table} from authenticated;`,
          "i"
        )
      );
    }
    expect(sql).toMatch(/api_cache_log is service_role only/i);
    expect(sql).toMatch(/domain_events is service_role only/i);
    expect(sql).toMatch(/event_log is service_role only/i);
    expect(sql).toMatch(/show_claims is service_role only/i);
  });
});

describe("migration 060 on throwaway postgres", () => {
  const bin = pgBin();
  const dataDir = mkdtempSync(join(tmpdir(), "s1-pg-"));
  let port = 0;
  let serviceRoleBefore = "";
  let policyCountBefore = "";

  function psql(args: string[], input?: string) {
    return spawnSync(join(bin, "psql"), args, {
      encoding: "utf8",
      input,
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH ?? ""}`,
        LC_ALL: "C",
      },
    });
  }

  function query(database: string, statement: string): string {
    const result = psql([
      "-h",
      dataDir,
      "-p",
      String(port),
      "-U",
      "postgres",
      "-d",
      database,
      "-v",
      "ON_ERROR_STOP=1",
      "-X",
      "-q",
      "-At",
      "-c",
      statement,
    ]);
    if (result.status !== 0) {
      throw new Error(
        result.stderr || result.stdout || `psql failed: ${statement}`
      );
    }
    return (result.stdout ?? "").trim();
  }

  function file(database: string, path: string): void {
    const result = psql([
      "-h",
      dataDir,
      "-p",
      String(port),
      "-U",
      "postgres",
      "-d",
      database,
      "-v",
      "ON_ERROR_STOP=1",
      "-X",
      "-q",
      "-f",
      path,
    ]);
    if (result.status !== 0) {
      throw new Error(
        `${path}\n${result.stderr || result.stdout || "psql failed"}`
      );
    }
  }

  function exec(statement: string): { status: number | null; text: string } {
    const result = psql([
      "-h",
      dataDir,
      "-p",
      String(port),
      "-U",
      "postgres",
      "-d",
      "s1",
      "-v",
      "ON_ERROR_STOP=1",
      "-X",
      "-c",
      statement,
    ]);
    return {
      status: result.status,
      text: `${result.stdout ?? ""}\n${result.stderr ?? ""}`,
    };
  }

  beforeAll(async () => {
    port = await freePort();
    const init = spawnSync(
      join(bin, "initdb"),
      [
        "-D",
        dataDir,
        "--username=postgres",
        "--auth=trust",
        "--no-sync",
        "--locale=C",
        "--encoding=UTF8",
      ],
      { encoding: "utf8" }
    );
    if (init.status !== 0) {
      throw new Error(init.stderr || init.stdout || "initdb failed");
    }

    const start = spawnSync(
      join(bin, "pg_ctl"),
      [
        "-D",
        dataDir,
        "-w",
        "-l",
        join(dataDir, "server.log"),
        "-o",
        `-p ${port} -k ${dataDir} -c listen_addresses=`,
        "start",
      ],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          PATH: `${bin}:${process.env.PATH ?? ""}`,
          LC_ALL: "C",
        },
      }
    );
    if (start.status !== 0) {
      throw new Error(start.stderr || start.stdout || "pg_ctl start failed");
    }

    query("postgres", "create database s1;");
    query(
      "s1",
      `
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
      create table if not exists public.show_claims (
        id uuid primary key default gen_random_uuid()
      );
      create table if not exists public.outcomes (
        id uuid primary key default gen_random_uuid()
      );
      `
    );

    for (const path of earlierMigrations()) file("s1", path);

    const grantList = LISTED.map((table) => `'${table}'`).join(", ");
    query(
      "s1",
      `
      do $$
      declare t text;
      begin
        foreach t in array array[${grantList}]
        loop
          execute format(
            'grant all on table public.%I to anon, authenticated, public, service_role',
            t
          );
        end loop;
      end $$;
      `
    );

    serviceRoleBefore = query(
      "s1",
      `
      select coalesce(string_agg(table_name || ' ' || privilege_type, ',' order by table_name, privilege_type), '')
        from information_schema.role_table_grants
       where table_schema = 'public'
         and grantee = 'service_role';
      `
    );
    policyCountBefore = query(
      "s1",
      "select count(*)::text from pg_policies where schemaname = 'public';"
    );

    file("s1", sqlPath);

    query(
      "s1",
      "insert into public.shows (name, platform) values ('Grant Check', 'podcast');"
    );
  }, 120_000);

  afterAll(() => {
    spawnSync(join(bin, "pg_ctl"), ["-D", dataDir, "-m", "immediate", "stop"], {
      encoding: "utf8",
    });
    rmSync(dataDir, { recursive: true, force: true });
  });

  function anonGrants(): string {
    return query(
      "s1",
      `
      select coalesce(string_agg(table_name || ' ' || privilege_type, ',' order by table_name, privilege_type), '')
        from information_schema.role_table_grants
       where table_schema = 'public'
         and grantee = 'anon';
      `
    );
  }

  it("gives anon select on shows and nothing else in public", () => {
    expect(anonGrants()).toBe("shows SELECT");
    expect(
      query(
        "s1",
        `
        select count(*)::text
          from information_schema.role_table_grants
         where table_schema = 'public'
           and grantee = 'PUBLIC';
        `
      )
    ).toBe("0");
  });

  it("drops truncate, references, and trigger for authenticated and locks four tables", () => {
    const listed = LISTED.map((table) => `'${table}'`).join(", ");
    expect(
      query(
        "s1",
        `
        select count(*)::text
          from information_schema.role_table_grants
         where table_schema = 'public'
           and grantee = 'authenticated'
           and table_name in (${listed})
           and privilege_type in ('TRUNCATE', 'REFERENCES', 'TRIGGER');
        `
      )
    ).toBe("0");

    const locked = SERVICE_ONLY.map((table) => `'${table}'`).join(", ");
    expect(
      query(
        "s1",
        `
        select count(*)::text
          from information_schema.role_table_grants
         where table_schema = 'public'
           and grantee = 'authenticated'
           and table_name in (${locked});
        `
      )
    ).toBe("0");

    const crud = query(
      "s1",
      `
      select string_agg(table_name || ':' || privileges, ',' order by table_name)
        from (
          select table_name,
                 string_agg(privilege_type, ',' order by privilege_type) as privileges
            from information_schema.role_table_grants
           where table_schema = 'public'
             and grantee = 'authenticated'
             and table_name in (${APP_TABLES.map((table) => `'${table}'`).join(", ")})
           group by table_name
        ) rows;
      `
    );
    const expected = APP_TABLES.map(
      (table) => `${table}:DELETE,INSERT,SELECT,UPDATE`
    ).join(",");
    expect(crud).toBe(expected);
  });

  it("does not change service_role or policies, and leaves RLS on", () => {
    const serviceRoleAfter = query(
      "s1",
      `
      select coalesce(string_agg(table_name || ' ' || privilege_type, ',' order by table_name, privilege_type), '')
        from information_schema.role_table_grants
       where table_schema = 'public'
         and grantee = 'service_role';
      `
    );
    expect(serviceRoleAfter).toBe(serviceRoleBefore);
    expect(
      query(
        "s1",
        "select count(*)::text from pg_policies where schemaname = 'public';"
      )
    ).toBe(policyCountBefore);

    const rls = query(
      "s1",
      `
      select string_agg(c.relname || ':' || c.relrowsecurity::text, ',' order by c.relname)
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public'
         and c.relname in (${LISTED.map((table) => `'${table}'`).join(", ")});
      `
    );
    expect(rls).toBe(LISTED.map((table) => `${table}:true`).sort().join(","));
  });

  it("rejects anon writes and truncates, and allows anon and authenticated select", () => {
    const read = exec(
      "set role anon; select name from public.shows where name = 'Grant Check';"
    );
    expect(read.status).toBe(0);
    expect(read.text).toContain("Grant Check");

    const insert = exec(
      "set role anon; insert into public.shows (name, platform) values ('Nope', 'podcast');"
    );
    expect(insert.status).not.toBe(0);
    expect(insert.text.toLowerCase()).toContain("permission denied");

    for (const statement of [
      "set role anon; truncate public.shows;",
      "set role anon; truncate public.payments;",
      "set role anon; truncate public.payouts;",
      "set role authenticated; truncate public.shows;",
      "set role authenticated; truncate public.payments;",
      "set role authenticated; truncate public.payouts;",
    ]) {
      const failed = exec(statement);
      expect(failed.status, statement).not.toBe(0);
      expect(failed.text.toLowerCase(), statement).toContain("permission denied");
    }

    const authed = exec(
      "set role authenticated; select name from public.shows where name = 'Grant Check';"
    );
    expect(authed.status).toBe(0);
    expect(authed.text).toContain("Grant Check");

    for (const table of SERVICE_ONLY) {
      const denied = exec(
        `set role authenticated; select 1 from public.${table};`
      );
      expect(denied.status, table).not.toBe(0);
      expect(denied.text.toLowerCase(), table).toContain("permission denied");
    }

    expect(
      query(
        "s1",
        "select count(*)::text from public.shows where name = 'Grant Check';"
      )
    ).toBe("1");
    expect(
      query("s1", "select count(*)::text from public.shows where name = 'Nope';")
    ).toBe("0");
  });

  it("applies a second time and keeps anon select on shows", () => {
    file("s1", sqlPath);
    expect(anonGrants()).toBe("shows SELECT");
    const read = exec(
      "set role anon; select name from public.shows where name = 'Grant Check';"
    );
    expect(read.status).toBe(0);
    expect(read.text).toContain("Grant Check");
    const truncated = exec("set role anon; truncate public.shows;");
    expect(truncated.status).not.toBe(0);
    expect(truncated.text.toLowerCase()).toContain("permission denied");
  });
});
