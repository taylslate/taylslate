// Static assertions on migration 070, plus a throwaway Postgres apply
// of 001 through 070. The database checks skip when Postgres binaries
// are absent. Never uses a hosted database. 070 is applied twice.

import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const sqlPath = join(__dirname, "070_api_write_actions.sql");
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
    .filter((row) => row.n >= 1 && row.n <= 70)
    .sort((a, b) => a.n - b.n || a.name.localeCompare(b.name))
    .map((row) => join(__dirname, row.name));
}

describe("migration 070 api write actions", () => {
  it("is not applied and documents the grant and policy introspection", () => {
    expect(sql).toContain(
      "NOT applied. Apply on ldtmhafewfifdizgfrnn only after merge and Chris's OK."
    );
    expect(sql).toContain("information_schema.role_table_grants");
    expect(sql).toContain("relrowsecurity");
    expect(sql).toContain("pg_policies");
    expect(sql).toContain("070");
    expect(statements).not.toMatch(/create policy/i);
    expect(statements).not.toMatch(/security definer/i);
  });

  it("creates only api_write_actions, with the pending-action checks", () => {
    const created = [...statements.matchAll(/create table if not exists public\.([a-z_]+)/gi)].map(
      (match) => match[1]
    );
    expect(created).toEqual(["api_write_actions"]);
    expect(statements).toMatch(
      /brand_id\s+uuid not null references public\.profiles\(id\) on delete cascade/i
    );
    expect(statements).toMatch(/api_key_id\s+uuid not null references public\.api_keys\(id\)/i);
    expect(statements).toMatch(/payload\s+jsonb not null/i);
    expect(statements).toMatch(/payload_hash\s+text not null/i);
    expect(statements).toMatch(/idempotency_key\s+text not null/i);
    expect(statements).toMatch(/status\s+text not null default 'pending'/i);
    expect(statements).toMatch(/decided_by\s+uuid/i);
    expect(statements).toMatch(/decided_at\s+timestamptz/i);
    expect(statements).toMatch(/created_at\s+timestamptz not null default now\(\)/i);
    expect(statements).toMatch(
      /check \(kind in \('campaign\.create', 'outreach\.draft'\)\)/i
    );
    expect(statements).toMatch(
      /check \(status in \('pending', 'approved', 'rejected', 'expired'\)\)/i
    );
    expect(statements).toMatch(
      /check \(char_length\(idempotency_key\) between 1 and 128\)/i
    );
    expect(statements).toMatch(
      /add constraint api_write_actions_brand_idempotency_key\s+unique \(brand_id, idempotency_key\);/i
    );
    expect(statements).toMatch(
      /create index if not exists idx_api_write_actions_brand_status_created\s+on public\.api_write_actions \(brand_id, status, created_at\);/i
    );
  });

  it("enables RLS with no policies and grants only service_role", () => {
    expect(statements).toMatch(
      /alter table public\.api_write_actions enable row level security;/i
    );
    const rlsAt = statements.search(
      /alter table public\.api_write_actions enable row level security/i
    );
    const grantAt = statements
      .toLowerCase()
      .indexOf("grant all on table public.api_write_actions to service_role;");
    expect(grantAt).toBeGreaterThanOrEqual(0);
    expect(grantAt).toBeLessThan(rlsAt);
    expect(statements).toMatch(/revoke all on table public\.api_write_actions from public;/i);
    expect(statements).toMatch(/revoke all on table public\.api_write_actions from anon;/i);
    expect(statements).toMatch(
      /revoke all on table public\.api_write_actions from authenticated;/i
    );
    expect(statements).toMatch(
      /revoke truncate, references, trigger on table public\.api_write_actions from authenticated;/i
    );
    expect(statements).not.toMatch(/\bto anon\b/i);
    expect(statements).not.toMatch(/\bto authenticated\b/i);
    expect(statements).not.toMatch(/\bto public\b/i);
    expect(statements).not.toMatch(/using \(true\)/i);
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

describe.skipIf(!bin)("migration 070 on throwaway postgres", () => {
  const pgRoot = bin ?? "";
  let dataDir = "";
  let port = 0;

  function psql(args: string[], input?: string) {
    return spawnSync(join(pgRoot, "psql"), args, {
      encoding: "utf8",
      input,
      env: { ...process.env, PATH: `${pgRoot}:${process.env.PATH ?? ""}`, LC_ALL: "C" },
    });
  }

  function query(statement: string): string {
    const result = psql([
      "-h", dataDir, "-p", String(port), "-U", "postgres", "-d", "a3",
      "-v", "ON_ERROR_STOP=1", "-X", "-q", "-At", "-c", statement,
    ]);
    if (result.status !== 0) {
      throw new Error(result.stderr || result.stdout || statement);
    }
    return (result.stdout ?? "").trim();
  }

  function file(path: string): void {
    const result = psql([
      "-h", dataDir, "-p", String(port), "-U", "postgres", "-d", "a3",
      "-v", "ON_ERROR_STOP=1", "-X", "-q", "-f", path,
    ]);
    if (result.status !== 0) {
      throw new Error(`${path}\n${result.stderr || result.stdout || "psql failed"}`);
    }
  }

  beforeAll(async () => {
    dataDir = mkdtempSync(join(tmpdir(), "a3-pg-"));
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
        "-D", dataDir, "-w", "-l", join(dataDir, "server.log"),
        "-o", `-p ${port} -k ${dataDir} -c listen_addresses=`, "start",
      ],
      { encoding: "utf8", env: { ...process.env, PATH: `${pgRoot}:${process.env.PATH ?? ""}`, LC_ALL: "C" } }
    );
    if (start.status !== 0) throw new Error(start.stderr || start.stdout || "pg_ctl start failed");
    psql(["-h", dataDir, "-p", String(port), "-U", "postgres", "-d", "postgres", "-c", "create database a3;"]);
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
    `);

    for (const path of migrationFiles()) {
      // 001 does not add shows.agent_id. The live table has it, and 068 reads it.
      if (path.endsWith("068_past_campaign_show_match.sql")) {
        query("alter table public.shows add column if not exists agent_id uuid;");
      }
      file(path);
    }
    file(sqlPath);
  }, 180_000);

  afterAll(() => {
    if (!dataDir) return;
    spawnSync(join(pgRoot, "pg_ctl"), ["-D", dataDir, "-w", "-m", "immediate", "stop"], {
      encoding: "utf8",
    });
    rmSync(dataDir, { recursive: true, force: true });
  });

  it("keeps row security on, the checks in place, and zero policies after a second apply", () => {
    expect(query(`
      select c.relrowsecurity::text
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relname = 'api_write_actions';
    `)).toBe("true");
    expect(query(`
      select count(*)::text from pg_policies
       where schemaname = 'public' and tablename = 'api_write_actions';
    `)).toBe("0");
    expect(query(`
      select string_agg(conname, ',' order by conname)
        from pg_constraint
       where conrelid = 'public.api_write_actions'::regclass;
    `)).toBe(
      [
        "api_write_actions_api_key_id_fkey",
        "api_write_actions_brand_id_fkey",
        "api_write_actions_brand_idempotency_key",
        "api_write_actions_idempotency_key_len_check",
        "api_write_actions_kind_check",
        "api_write_actions_pkey",
        "api_write_actions_status_check",
      ].join(",")
    );
    expect(query(`
      select indexname from pg_indexes
       where schemaname = 'public' and tablename = 'api_write_actions'
         and indexname = 'idx_api_write_actions_brand_status_created';
    `)).toBe("idx_api_write_actions_brand_status_created");
  });

  it("grants service_role only, with nothing for anon, public, or authenticated", () => {
    const grants = query(`
      select coalesce(string_agg(grantee || ' ' || privilege_type, ',' order by grantee, privilege_type), '')
        from information_schema.role_table_grants
       where table_schema = 'public'
         and table_name = 'api_write_actions'
         and grantee in ('anon', 'PUBLIC', 'authenticated', 'service_role');
    `);
    expect(grants).not.toMatch(/anon|PUBLIC|authenticated/);
    expect(grants).toContain("service_role SELECT");
    expect(grants).toContain("service_role INSERT");
    expect(grants).toContain("service_role UPDATE");
    expect(grants).toContain("service_role DELETE");
    const serviceOnly = query(`
      select count(*)::text
        from information_schema.role_table_grants
       where table_schema = 'public'
         and table_name = 'api_write_actions'
         and grantee in ('anon', 'PUBLIC', 'authenticated');
    `);
    expect(serviceOnly).toBe("0");
  });

  it("lets service_role insert a pending action and denies anon and authenticated", () => {
    query(`
      insert into auth.users (id) values ('11111111-1111-4111-8111-111111111111');
      insert into public.profiles (id, email, role)
      values ('11111111-1111-4111-8111-111111111111', 'brand@example.com', 'brand');
      insert into public.api_keys (brand_id, prefix, key_hash, scopes)
      values (
        '11111111-1111-4111-8111-111111111111',
        '0123456789abcdef',
        '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
        array['write:campaigns']
      );
    `);
    const keyId = query(`select id::text from public.api_keys limit 1;`);
    expect(query(`
      set role service_role;
      insert into public.api_write_actions (brand_id, api_key_id, kind, payload, payload_hash, idempotency_key)
      values (
        '11111111-1111-4111-8111-111111111111',
        '${keyId}',
        'campaign.create',
        '{"budget_total":25000}'::jsonb,
        'abc',
        'idem-1'
      );
      reset role;
      select status from public.api_write_actions;
    `)).toBe("pending");

    const anon = psql([
      "-h", dataDir, "-p", String(port), "-U", "postgres", "-d", "a3",
      "-v", "ON_ERROR_STOP=1", "-c",
      "set role anon; insert into public.api_write_actions (brand_id, api_key_id, kind, payload, payload_hash, idempotency_key) values ('11111111-1111-4111-8111-111111111111', '" +
        keyId +
        "', 'campaign.create', '{}'::jsonb, 'abc', 'idem-2');",
    ]);
    expect(anon.status).not.toBe(0);
    expect(`${anon.stdout ?? ""}\n${anon.stderr ?? ""}`.toLowerCase()).toContain("permission denied");

    const authed = psql([
      "-h", dataDir, "-p", String(port), "-U", "postgres", "-d", "a3",
      "-v", "ON_ERROR_STOP=1", "-c",
      "set role authenticated; select id from public.api_write_actions;",
    ]);
    expect(authed.status).not.toBe(0);
    expect(`${authed.stdout ?? ""}\n${authed.stderr ?? ""}`.toLowerCase()).toContain("permission denied");
  });
});
