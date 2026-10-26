// Migration 061. The SQL checks always run. The throwaway Postgres
// suite applies 001 through 060, then 065 and 066 (already on main),
// then 061 twice. 061 is reserved and is pasted after 066 on the
// live project. The suite is skipped when Postgres binaries are
// absent. Never uses a hosted database.

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

const sqlPath = join(__dirname, "061_show_ownership.sql");
const sql = readFileSync(sqlPath, "utf8");
const statements = sql
  .split("\n")
  .filter((line) => !line.trim().startsWith("--"))
  .join("\n");

const USER_A = "11111111-1111-4111-8111-111111111111";
const USER_B = "22222222-2222-4222-8222-222222222222";

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

function migrationsBefore061(): string[] {
  return readdirSync(__dirname)
    .filter((name) => /^\d{3}_.+\.sql$/.test(name))
    .map((name) => ({ name, n: Number(name.slice(0, 3)) }))
    .filter((row) => (row.n >= 1 && row.n <= 60) || row.n === 65 || row.n === 66)
    .sort((a, b) => a.n - b.n || a.name.localeCompare(b.name))
    .map((row) => join(__dirname, row.name));
}

describe("migration 061 sql", () => {
  it("documents that it is not applied and that show_claims was empty", () => {
    expect(sql).toContain(
      "NOT applied. Apply on ldtmhafewfifdizgfrnn only after merge and Chris's OK."
    );
    expect(sql).toContain("0 rows on Oct 24, 2026");
    expect(sql).toContain("select count(*) from public.show_claims;");
    expect(sql).toContain("information_schema.role_table_grants");
    expect(statements).not.toMatch(/\bpodscan_id\b/i);
  });

  it("adds the two ownership states and does not drop is_claimed", () => {
    expect(statements).toMatch(
      /add column if not exists ownership_status text not null default 'unclaimed'/i
    );
    expect(statements).toMatch(
      /check \(ownership_status in \('unclaimed', 'verified'\)\)/i
    );
    expect(statements).toMatch(/Deprecated/i);
    expect(statements).not.toMatch(/drop column[^;]*is_claimed/i);
    expect(statements).not.toMatch(/grant\b[^;]*\bon table public\.shows\b/i);
    expect(statements).not.toMatch(/revoke\b[^;]*\bon table public\.shows\b/i);
  });

  it("creates the proofs table, one verified row per show, and the status index", () => {
    expect(statements).toMatch(
      /create table if not exists public\.show_ownership_proofs/i
    );
    expect(statements).toMatch(
      /check \(method is null or method in \('rss_code', 'youtube_code', 'admin'\)\)/i
    );
    expect(statements).toMatch(
      /check \(status in \('pending', 'verified', 'rejected', 'expired', 'contested'\)\)/i
    );
    expect(statements).toMatch(/references public\.shows \(id\) on delete cascade/i);
    expect(statements).toMatch(/references public\.profiles \(id\)/i);
    expect(statements).toMatch(/references public\.show_profiles \(id\)/i);
    expect(statements).toMatch(
      /create unique index if not exists show_ownership_proofs_one_verified_per_show[\s\S]*where status = 'verified'/i
    );
    expect(statements).toMatch(
      /create index if not exists show_ownership_proofs_status_created_at[\s\S]*\(status, created_at\)/i
    );
    expect(statements).toMatch(/sha256 of the ownership code/i);
  });

  it("locks grants and lets an owner read only their own proofs", () => {
    expect(statements).toMatch(
      /grant select, insert, update, delete on table public\.show_ownership_proofs to service_role;/i
    );
    expect(statements).toMatch(
      /grant select on table public\.show_ownership_proofs to authenticated;/i
    );
    expect(statements).toMatch(
      /revoke all on table public\.show_ownership_proofs from anon;/i
    );
    expect(statements).toMatch(
      /revoke all on table public\.show_ownership_proofs from public;/i
    );
    expect(statements).toMatch(
      /revoke insert, update, delete, truncate, references, trigger\s+on table public\.show_ownership_proofs from authenticated;/i
    );
    expect(statements).toMatch(
      /alter table public\.show_ownership_proofs enable row level security;/i
    );
    expect(statements).toMatch(
      /create policy "Owners read own ownership proofs"[\s\S]*for select[\s\S]*to authenticated[\s\S]*using \(user_id = auth\.uid\(\)\);/i
    );
    expect(statements).not.toMatch(
      /grant\s+[a-z,\s]+\s+on\s+(?:table\s+)?public\.show_ownership_proofs\s+to\s+anon\b/i
    );
    expect(statements).not.toMatch(
      /grant\s+[a-z,\s]+\s+on\s+(?:table\s+)?public\.show_ownership_proofs\s+to\s+public\b/i
    );
  });

  it("drops only show_claims, and only after the row guard", () => {
    const dropped = [
      ...statements.matchAll(/drop table if exists public\.([a-z_]+)/gi),
    ].map((match) => match[1]);
    expect(dropped).toEqual(["show_claims"]);
    const guard = statements.search(/to_regclass\('public\.show_claims'\)/i);
    const drop = statements.search(/drop table if exists public\.show_claims/i);
    expect(guard).toBeGreaterThan(-1);
    expect(drop).toBeGreaterThan(guard);
    expect(statements.slice(guard, drop)).toMatch(/raise exception/i);
    expect(statements.slice(guard, drop)).toMatch(
      /execute 'select count\(\*\) from public\.show_claims'/i
    );
  });

  it("stops the three production writers from setting is_claimed true", () => {
    const files = [
      "lib/data/queries.ts",
      "app/(dashboard)/shows/shows-client.tsx",
      "lib/data/show-surfaces.ts",
    ];
    for (const file of files) {
      const src = readFileSync(join(process.cwd(), file), "utf8");
      expect(src, file).not.toMatch(/is_claimed:\s*true/);
    }
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

describe.skipIf(!bin)("migration 061 on throwaway postgres", () => {
  const pgRoot = bin ?? "";
  let dataDir = "";
  let port = 0;
  let showsGrantsBefore = "";

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
      "o1",
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

  function loose(statement: string): string {
    const result = psql([
      "-h",
      dataDir,
      "-p",
      String(port),
      "-U",
      "postgres",
      "-d",
      "o1",
      "-X",
      "-c",
      statement,
    ]);
    return `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  }

  function applyFile(path: string) {
    return psql([
      "-h",
      dataDir,
      "-p",
      String(port),
      "-U",
      "postgres",
      "-d",
      "o1",
      "-v",
      "ON_ERROR_STOP=1",
      "-X",
      "-q",
      "-f",
      path,
    ]);
  }

  function file(path: string): void {
    const result = applyFile(path);
    if (result.status !== 0) {
      throw new Error(`${path}\n${result.stderr || result.stdout || "psql failed"}`);
    }
  }

  function grants(table: string): string {
    return query(`
      select coalesce(string_agg(grantee || ' ' || privilege_type, ',' order by grantee, privilege_type), '')
        from information_schema.role_table_grants
       where table_schema = 'public'
         and table_name = '${table}'
         and grantee in ('anon', 'authenticated', 'service_role', 'PUBLIC');
    `);
  }

  beforeAll(async () => {
    dataDir = mkdtempSync(join(tmpdir(), "o1-pg-"));
    port = await freePort();
    const init = spawnSync(
      join(pgRoot, "initdb"),
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
        env: {
          ...process.env,
          PATH: `${pgRoot}:${process.env.PATH ?? ""}`,
          LC_ALL: "C",
        },
      }
    );
    if (start.status !== 0) {
      throw new Error(start.stderr || start.stdout || "pg_ctl start failed");
    }

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
      "create database o1;",
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

    for (const path of migrationsBefore061()) file(path);
    expect(query("select to_regclass('public.show_claims') is not null")).toBe("t");
    showsGrantsBefore = grants("shows");

    file(sqlPath);
    file(sqlPath);
  }, 300_000);

  afterAll(() => {
    if (!dataDir) return;
    spawnSync(join(pgRoot, "pg_ctl"), ["-D", dataDir, "-w", "-m", "immediate", "stop"], {
      encoding: "utf8",
    });
    rmSync(dataDir, { recursive: true, force: true });
  });

  it("drops show_claims, keeps is_claimed, and defaults ownership to unclaimed", () => {
    expect(query("select to_regclass('public.show_claims')")).toBe("");
    expect(
      query(`
        select column_name || ' ' || column_default
          from information_schema.columns
         where table_schema = 'public'
           and table_name = 'shows'
           and column_name in ('is_claimed', 'ownership_status')
         order by column_name;
      `)
    ).toBe("is_claimed false\nownership_status 'unclaimed'::text");
    expect(grants("shows")).toBe(showsGrantsBefore);
  });

  it("grants select to the owner, writes to service_role, and nothing to anon", () => {
    expect(grants("show_ownership_proofs")).toBe(
      "authenticated SELECT,service_role DELETE,service_role INSERT,service_role SELECT,service_role UPDATE"
    );
    expect(
      query(`
        select coalesce(string_agg(polname, ',' order by polname), '')
          from pg_policy
         where polrelid = 'public.show_ownership_proofs'::regclass;
      `)
    ).toBe("Owners read own ownership proofs");
  });

  it("lets authenticated read only its own proofs and refuses writes", () => {
    query(`
      insert into auth.users (id) values ('${USER_A}'), ('${USER_B}');
      insert into public.profiles (id, email, role)
      values ('${USER_A}', 'a@example.com', 'show'),
             ('${USER_B}', 'b@example.com', 'show');
      insert into public.shows (id, name, platform)
      values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'One', 'podcast'),
             ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Two', 'podcast');
      insert into public.show_profiles (id, user_id)
      values ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', '${USER_A}');
      insert into public.show_ownership_proofs
        (show_id, user_id, show_profile_id, method, status)
      values
        ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '${USER_A}',
         'cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'admin', 'verified'),
        ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '${USER_B}',
         null, 'rss_code', 'pending');
    `);

    expect(
      query(`
        select ownership_status
          from public.shows
         where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
      `)
    ).toBe("unclaimed");

    const own = loose(`
      select set_config('request.jwt.claim.sub', '${USER_A}', false);
      set role authenticated;
      select status from public.show_ownership_proofs order by status;
    `);
    expect(own).toContain("verified");
    expect(own).not.toContain("pending");

    const other = loose(`
      select set_config('request.jwt.claim.sub', '${USER_B}', false);
      set role authenticated;
      select status from public.show_ownership_proofs order by status;
    `);
    expect(other).toContain("pending");
    expect(other).not.toContain("verified");

    const anon = loose("set role anon; select status from public.show_ownership_proofs;");
    expect(anon.toLowerCase()).toContain("permission denied");

    const write = loose(`
      set role authenticated;
      insert into public.show_ownership_proofs (show_id, user_id)
      values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '${USER_A}');
    `);
    expect(write.toLowerCase()).toContain("permission denied");

    const second = loose(`
      insert into public.show_ownership_proofs
        (show_id, user_id, show_profile_id, method, status)
      values
        ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '${USER_A}',
         'cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'admin', 'verified');
    `);
    expect(second.toLowerCase()).toMatch(/duplicate key|unique/);

    const badState = loose(`
      insert into public.shows (name, platform, ownership_status)
      values ('Bad', 'podcast', 'pending');
    `);
    expect(badState.toLowerCase()).toContain("shows_ownership_status_check");

    file(sqlPath);
    expect(query("select count(*)::text from public.show_ownership_proofs")).toBe("2");
    expect(query("select to_regclass('public.show_claims')")).toBe("");
    expect(grants("shows")).toBe(showsGrantsBefore);
    expect(grants("show_ownership_proofs")).toBe(
      "authenticated SELECT,service_role DELETE,service_role INSERT,service_role SELECT,service_role UPDATE"
    );
  });

  it("aborts and keeps show_claims when the table has a row", () => {
    query(`
      create table public.show_claims (
        id uuid primary key default gen_random_uuid()
      );
      insert into public.show_claims default values;
    `);
    expect(query("select count(*)::text from public.show_claims")).toBe("1");

    const result = applyFile(sqlPath);
    const output = `${result.stderr ?? ""}\n${result.stdout ?? ""}`;
    expect(result.status).not.toBe(0);
    expect(output).toMatch(/refused to drop public\.show_claims/i);
    expect(query("select count(*)::text from public.show_claims")).toBe("1");
    expect(query("select to_regclass('public.show_claims') is not null")).toBe("t");
  });
});
