// Migration 066. The SQL checks always run. The throwaway Postgres
// suite is skipped when Postgres binaries are absent. Never uses a
// hosted database.

import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const sqlPath = join(__dirname, "066_shows_write_policy.sql");
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

describe("migration 066 sql", () => {
  it("documents that it is not applied and does not touch service_role", () => {
    expect(sql).toContain(
      "NOT applied. Apply on ldtmhafewfifdizgfrnn only after merge and Chris's OK."
    );
    expect(sql).toContain("information_schema.role_table_grants");
    expect(statements).not.toMatch(/\bto\s+service_role\b/i);
    expect(statements).not.toMatch(/\bfrom\s+service_role\b/i);
    expect(statements).not.toMatch(/\bgrant\b/i);
  });

  it("drops the open write policies and revokes authenticated writes", () => {
    expect(statements).toMatch(
      /drop policy if exists "Shows insert by authenticated" on public\.shows;/i
    );
    expect(statements).toMatch(
      /drop policy if exists "Shows update by authenticated" on public\.shows;/i
    );
    expect(statements).not.toMatch(/Shows are publicly readable/i);
    expect(statements).toMatch(
      /revoke insert, update, delete on table public\.shows from authenticated;/i
    );
    expect(statements).toMatch(
      /revoke truncate, references, trigger on table public\.shows from authenticated;/i
    );
    expect(statements).not.toMatch(/revoke select/i);
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

describe.skipIf(!bin)("migration 066 on throwaway postgres", () => {
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
      "-h", dataDir, "-p", String(port), "-U", "postgres", "-d", "s3",
      "-v", "ON_ERROR_STOP=1", "-X", "-q", "-At", "-c", statement,
    ]);
    if (result.status !== 0) {
      throw new Error(result.stderr || result.stdout || statement);
    }
    return (result.stdout ?? "").trim();
  }

  function loose(statement: string): string {
    const result = psql([
      "-h", dataDir, "-p", String(port), "-U", "postgres", "-d", "s3",
      "-X", "-c", statement,
    ]);
    return `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  }

  beforeAll(async () => {
    dataDir = mkdtempSync(join(tmpdir(), "s3-pg-"));
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
    psql(["-h", dataDir, "-p", String(port), "-U", "postgres", "-d", "postgres", "-c", "create database s3;"]);
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
      create table public.shows (id int primary key);
      alter table public.shows enable row level security;
      create policy "Shows are publicly readable" on public.shows for select using (true);
      create policy "Shows insert by authenticated" on public.shows for insert with check (true);
      create policy "Shows update by authenticated" on public.shows for update using (true);
      grant select on table public.shows to anon;
      grant select, insert, update, delete, truncate, references, trigger on table public.shows to authenticated;
      grant select, insert, update, delete on table public.shows to service_role;
    `);
    const applied = psql([
      "-h", dataDir, "-p", String(port), "-U", "postgres", "-d", "s3",
      "-v", "ON_ERROR_STOP=1", "-X", "-q", "-f", sqlPath,
    ]);
    if (applied.status !== 0) throw new Error(applied.stderr || applied.stdout || "066 failed");
    const again = psql([
      "-h", dataDir, "-p", String(port), "-U", "postgres", "-d", "s3",
      "-v", "ON_ERROR_STOP=1", "-X", "-q", "-f", sqlPath,
    ]);
    if (again.status !== 0) throw new Error(again.stderr || again.stdout || "066 re-run failed");
  });

  afterAll(() => {
    if (!dataDir) return;
    spawnSync(join(pgRoot, "pg_ctl"), ["-D", dataDir, "-w", "-m", "immediate", "stop"], {
      encoding: "utf8",
    });
    rmSync(dataDir, { recursive: true, force: true });
  });

  it("leaves authenticated with SELECT only and keeps the read policy", () => {
    expect(
      query(`
        select coalesce(string_agg(privilege_type, ',' order by privilege_type), '')
          from information_schema.role_table_grants
         where table_schema = 'public'
           and table_name = 'shows'
           and grantee = 'authenticated';
      `)
    ).toBe("SELECT");
    expect(
      query(`
        select coalesce(string_agg(polname, ',' order by polname), '')
          from pg_policy
         where polrelid = 'public.shows'::regclass;
      `)
    ).toBe("Shows are publicly readable");
  });

  it("denies authenticated writes and lets service_role insert", () => {
    const inserted = loose(
      "set role authenticated; insert into public.shows (id) values (1);"
    );
    expect(inserted.toLowerCase()).toContain("permission denied");
    const updated = loose(
      "set role authenticated; update public.shows set id = 2 where id = 1;"
    );
    expect(updated.toLowerCase()).toContain("permission denied");
    expect(
      query(`
        set role service_role;
        insert into public.shows (id) values (1);
        reset role;
        select count(*)::text from public.shows;
      `)
    ).toBe("1");
  });
});
