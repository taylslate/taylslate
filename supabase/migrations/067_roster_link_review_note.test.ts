// Migration 067. The SQL checks always run. The throwaway Postgres
// suite applies 001 through 067, then applies 067 again. It is
// skipped when Postgres binaries are absent. Never uses a hosted
// database.

import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const sqlPath = join(__dirname, "067_roster_link_review_note.sql");
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
    if (existsSync(join(dir, "initdb")) && existsSync(join(dir, "psql"))) return dir;
  }
  return null;
}

function migrationFiles(): string[] {
  return readdirSync(__dirname)
    .filter((name) => /^\d{3}_.+\.sql$/.test(name))
    .map((name) => ({ name, n: Number(name.slice(0, 3)) }))
    .filter((row) => row.n >= 1 && row.n <= 67)
    .sort((a, b) => a.n - b.n || a.name.localeCompare(b.name))
    .map((row) => join(__dirname, row.name));
}

describe("migration 067 sql", () => {
  it("is not applied until merge and Chris's OK", () => {
    expect(sql).toContain(
      "NOT applied. Apply on ldtmhafewfifdizgfrnn only after merge and Chris's OK."
    );
    expect(sql).toContain("information_schema.role_table_grants");
  });

  it("adds the three nullable columns and does not rewrite rows", () => {
    expect(statements).toMatch(
      /add column if not exists review_note text/i
    );
    expect(statements).toMatch(/add column if not exists rejected_by uuid/i);
    expect(statements).toMatch(/add column if not exists rejected_at timestamptz/i);
    expect(statements).not.toMatch(/review_note text not null/i);
    expect(statements).not.toMatch(/rejected_by uuid not null/i);
    expect(statements).not.toMatch(/rejected_at timestamptz not null/i);
    expect(statements).not.toMatch(/\bupdate\s+public\./i);
    expect(statements).not.toMatch(/\bdelete\s+from\b/i);
    expect(statements).not.toMatch(/\bpublic\.shows\b/i);
  });

  it("points rejected_by at profiles and limits the note length", () => {
    expect(statements).toMatch(
      /drop constraint if exists agent_show_relationships_rejected_by_fkey/i
    );
    expect(statements).toMatch(
      /foreign key \(rejected_by\) references public\.profiles \(id\) on delete set null/i
    );
    expect(statements).toMatch(
      /drop constraint if exists agent_show_relationships_review_note_check/i
    );
    expect(statements).toMatch(
      /check \(review_note is null or char_length\(review_note\) between 1 and 500\)/i
    );
  });

  it("re-asserts service_role and does not grant anon or authenticated", () => {
    expect(statements).toMatch(
      /grant select, insert, update, delete on table public\.agent_show_relationships to service_role;/i
    );
    expect(statements).toMatch(
      /alter table public\.agent_show_relationships enable row level security;/i
    );
    const grants = statements.match(/grant\b[^;]*;/gi) ?? [];
    expect(grants).toHaveLength(1);
    expect(statements).not.toMatch(/\bto\s+anon\b/i);
    expect(statements).not.toMatch(/\bto\s+authenticated\b/i);
    expect(statements).not.toMatch(/\bto\s+public\b/i);
    expect(statements).not.toMatch(/create policy/i);
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
      "b3",
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

  function file(path: string): void {
    const result = psql([
      "-h",
      dataDir,
      "-p",
      String(port),
      "-U",
      "postgres",
      "-d",
      "b3",
      "-v",
      "ON_ERROR_STOP=1",
      "-X",
      "-q",
      "-f",
      path,
    ]);
    if (result.status !== 0) {
      throw new Error(`${path}\n${result.stderr || result.stdout || "psql failed"}`);
    }
  }

  beforeAll(async () => {
    dataDir = mkdtempSync(join(tmpdir(), "b3-pg-"));
    port = await freePort();
    const init = spawnSync(
      join(pgRoot, "initdb"),
      ["-D", dataDir, "--username=postgres", "--auth=trust", "--no-sync", "--locale=C", "--encoding=UTF8"],
      { encoding: "utf8" }
    );
    if (init.status !== 0) throw new Error(init.stderr || init.stdout || "initdb failed");
    const start = spawnSync(
      join(pgRoot, "pg_ctl"),
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
        env: { ...process.env, PATH: `${pgRoot}:${process.env.PATH ?? ""}`, LC_ALL: "C" },
      }
    );
    if (start.status !== 0) throw new Error(start.stderr || start.stdout || "pg_ctl start failed");
    psql([
      "-h",
      dataDir,
      "-p",
      String(port),
      "-U",
      "postgres",
      "-d",
      "postgres",
      "-c",
      "create database b3;",
    ]);
    query(`
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
    `);
    for (const path of migrationFiles()) file(path);
    file(sqlPath);
  }, 300_000);

  afterAll(() => {
    if (!dataDir) return;
    spawnSync(join(pgRoot, "pg_ctl"), ["-D", dataDir, "-w", "-m", "immediate", "stop"], {
      encoding: "utf8",
    });
    rmSync(dataDir, { recursive: true, force: true });
  });

  it("adds the columns once and keeps the 065 grants", () => {
    expect(
      query(`
        select column_name || ' ' || data_type || ' ' || is_nullable
          from information_schema.columns
         where table_schema = 'public'
           and table_name = 'agent_show_relationships'
           and column_name in ('review_note', 'rejected_by', 'rejected_at')
         order by column_name;
      `)
    ).toBe(
      [
        "rejected_at timestamp with time zone YES",
        "rejected_by uuid YES",
        "review_note text YES",
      ].join("\n")
    );
    expect(
      query(`
        select coalesce(string_agg(grantee || ' ' || privilege_type, ',' order by grantee, privilege_type), '')
          from information_schema.role_table_grants
         where table_schema = 'public'
           and table_name = 'agent_show_relationships'
           and grantee in ('anon', 'authenticated', 'service_role', 'PUBLIC');
      `)
    ).toBe(
      [
        "authenticated SELECT",
        "service_role DELETE",
        "service_role INSERT",
        "service_role SELECT",
        "service_role UPDATE",
      ].join(",")
    );
  });

  it("stores a 1 to 500 character note and rejects anything else", () => {
    const agent = "11111111-1111-1111-1111-111111111111";
    const show = "22222222-2222-2222-2222-222222222222";
    const link = "33333333-3333-3333-3333-333333333333";
    query(`
      insert into auth.users (id) values ('${agent}');
      insert into public.profiles (id, email, role) values ('${agent}', 'rep@example.com', 'agent');
      insert into public.shows (id, name, platform) values ('${show}', 'Odd Lots', 'podcast');
      insert into public.agent_show_relationships (id, agent_id, show_id, status, source)
      values ('${link}', '${agent}', '${show}', 'pending', 'import');
    `);
    expect(
      query(`
        update public.agent_show_relationships
           set review_note = repeat('a', 500),
               rejected_by = '${agent}',
               rejected_at = now(),
               status = 'rejected'
         where id = '${link}' and status = 'pending'
        returning status;
      `)
    ).toBe("rejected");
    const tooLong = psql([
      "-h",
      dataDir,
      "-p",
      String(port),
      "-U",
      "postgres",
      "-d",
      "b3",
      "-v",
      "ON_ERROR_STOP=1",
      "-c",
      `update public.agent_show_relationships set review_note = repeat('b', 501) where id = '${link}';`,
    ]);
    expect(`${tooLong.stderr ?? ""}`.toLowerCase()).toContain("check");
    expect(
      query(`select review_note from public.agent_show_relationships where id = '${link}';`)
    ).toBe("a".repeat(500));
    expect(
      query(`select is_discoverable::text from public.shows where id = '${show}';`)
    ).toBe("true");
  });
});
