// Migration 065. The SQL checks always run. The throwaway Postgres
// suite is skipped when Postgres binaries are absent. Never uses a
// hosted database.

import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const OUTSIDE = [
  "agent_show_relationships",
  "show_surfaces",
  "benchmarks",
  "deal_conversion_reports",
  "learning_overrides",
  "make_goods",
  "brand_show_contacts",
  "brand_show_notes",
  "past_campaign_imports",
  "past_campaign_records",
  "api_keys",
  "api_rate_windows",
  "airchecks",
  "login_otp_limits",
  "pooled_import_priors",
] as const;

const sqlPath = join(__dirname, "065_shows_login_only.sql");
const sql = readFileSync(sqlPath, "utf8");
const statements = sql
  .split("\n")
  .filter((line) => !line.trim().startsWith("--"))
  .join("\n");

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

describe("migration 065 sql", () => {
  it("documents that it is not applied and does not touch service_role", () => {
    expect(sql).toContain(
      "NOT applied. Apply on ldtmhafewfifdizgfrnn only after merge and Chris's OK."
    );
    expect(sql).toContain("information_schema.role_table_grants");
    expect(statements).not.toMatch(/\bto\s+service_role\b/i);
    expect(statements).not.toMatch(/\bfrom\s+service_role\b/i);
    expect(statements).not.toMatch(/\bgrant\b/i);
    expect(statements).not.toMatch(/drop policy/i);
    expect(statements).not.toMatch(/revoke (select|insert|update|delete)/i);
  });

  it("revokes anon and public on shows and on every public table", () => {
    expect(statements).toMatch(/revoke all on table public\.shows from anon;/i);
    expect(statements).toMatch(
      /revoke all on table public\.shows from public;/i
    );
    expect(statements).toMatch(
      /revoke all on all tables in schema public from anon;/i
    );
    expect(statements).toMatch(
      /revoke all on all tables in schema public from public;/i
    );
    expect(statements).toMatch(
      /revoke all on all sequences in schema public from anon;/i
    );
  });

  it("stops new public tables, sequences, and functions from granting anon", () => {
    expect(statements).toMatch(
      /alter default privileges in schema public revoke all on tables from anon;/i
    );
    expect(statements).toMatch(
      /alter default privileges in schema public revoke all on tables from public;/i
    );
    expect(statements).toMatch(
      /alter default privileges in schema public revoke all on sequences from anon;/i
    );
    expect(statements).toMatch(
      /alter default privileges in schema public revoke all on functions from anon;/i
    );
    expect(statements).toContain("supabase_admin");
    expect(statements).toContain("insufficient_privilege");
  });

  it("names the tables outside migration 060 and only revokes the three excess privileges", () => {
    for (const table of OUTSIDE) {
      expect(sql).toContain(`'${table}'`);
    }
    expect(statements).toMatch(
      /revoke truncate, references, trigger on table public\.%I from authenticated/i
    );
    expect(sql).toMatch(/agent_show_relationships: SELECT/i);
    expect(sql).toMatch(/api_keys: column SELECT/i);
    expect(sql).toMatch(/airchecks, login_otp_limits, api_rate_windows, pooled_import_priors/);
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

describe.skipIf(!bin)("migration 065 on throwaway postgres", () => {
  const pgRoot = bin ?? "";
  let dataDir = "";
  let port = 0;

  function psql(args: string[], input?: string) {
    return spawnSync(join(pgRoot, "psql"), args, {
      encoding: "utf8",
      input,
      env: {
        ...process.env,
        PATH: `${pgRoot}:${process.env.PATH ?? ""}`,
        LC_ALL: "C",
      },
    });
  }

  function query(statement: string): string {
    const result = psql([
      "-h",
      dataDir,
      "-p",
      String(port),
      "-U",
      "postgres",
      "-d",
      "s2",
      "-v",
      "ON_ERROR_STOP=1",
      "-X",
      "-q",
      "-At",
      "-c",
      statement,
    ]);
    if (result.status !== 0) {
      throw new Error(result.stderr || result.stdout || statement);
    }
    return (result.stdout ?? "").trim();
  }

  beforeAll(async () => {
    dataDir = mkdtempSync(join(tmpdir(), "s2-pg-"));
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
    psql(["-h", dataDir, "-p", String(port), "-U", "postgres", "-d", "postgres", "-c", "create database s2;"]);

    const tables = ["shows", "brand_show_notes", ...OUTSIDE.filter((name) => name !== "brand_show_notes")];
    query(`
      do $$ begin
        if not exists (select 1 from pg_roles where rolname = 'anon') then
          create role anon nologin;
        end if;
        if not exists (select 1 from pg_roles where rolname = 'authenticated') then
          create role authenticated nologin;
        end if;
        if not exists (select 1 from pg_roles where rolname = 'supabase_admin') then
          create role supabase_admin nologin;
        end if;
      end $$;
      ${tables.map((name) => `create table public.${name} (id int primary key);`).join("\n")}
      ${tables
        .map(
          (name) =>
            `grant all on table public.${name} to anon, authenticated, public;`
        )
        .join("\n")}
      alter default privileges in schema public grant all on tables to anon;
      alter default privileges for role supabase_admin in schema public grant all on tables to anon;
    `);
    const applied = psql([
      "-h", dataDir, "-p", String(port), "-U", "postgres", "-d", "s2",
      "-v", "ON_ERROR_STOP=1", "-X", "-q", "-f", sqlPath,
    ]);
    if (applied.status !== 0) {
      throw new Error(applied.stderr || applied.stdout || "065 failed");
    }
  });

  afterAll(() => {
    if (!dataDir) return;
    spawnSync(join(pgRoot, "pg_ctl"), ["-D", dataDir, "-w", "-m", "immediate", "stop"], {
      encoding: "utf8",
    });
    rmSync(dataDir, { recursive: true, force: true });
  });

  it("leaves anon and public with no table privileges", () => {
    expect(
      query(`
        select count(*)::text
          from information_schema.role_table_grants
         where table_schema = 'public'
           and grantee in ('anon', 'PUBLIC');
      `)
    ).toBe("0");
  });

  it("does not grant anon on a table created after the default-privilege change", () => {
    query("create table public.created_after (id int primary key);");
    query(`
      grant usage, create on schema public to supabase_admin;
      set role supabase_admin;
      create table public.created_after_admin (id int primary key);
      reset role;
    `);
    expect(
      query(`
        select count(*)::text
          from information_schema.role_table_grants
         where table_schema = 'public'
           and table_name in ('created_after', 'created_after_admin')
           and grantee = 'anon';
      `)
    ).toBe("0");
  });

  it("keeps authenticated DML and drops truncate, references, and trigger", () => {
    expect(
      query(`
        select coalesce(string_agg(privilege_type, ',' order by privilege_type), '')
          from information_schema.role_table_grants
         where table_schema = 'public'
           and table_name = 'brand_show_notes'
           and grantee = 'authenticated';
      `)
    ).toBe("DELETE,INSERT,SELECT,UPDATE");
  });
});
