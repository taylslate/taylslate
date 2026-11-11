// Static assertions on migration 083, plus a PGlite apply of the
// on-disk migrations through 083. 059, 062, 063, 064, and 080
// are absent. That gap is expected. 083 is applied twice.
// Never uses a hosted database.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const sqlPath = join(__dirname, "083_command_agent.sql");
const sql = readFileSync(sqlPath, "utf8");
const statements = sql
  .split("\n")
  .filter((line) => !line.trim().startsWith("--"))
  .join("\n");

const TABLES = [
  "api_write_actions",
  "command_agent_conversations",
  "command_agent_messages",
  "command_agent_usage",
] as const;

function migrationFiles(): string[] {
  return readdirSync(__dirname)
    .filter((name) => /^\d{3}_.+\.sql$/.test(name))
    .map((name) => ({ name, n: Number(name.slice(0, 3)) }))
    .filter((row) => row.n >= 1 && row.n <= 83)
    .sort((a, b) => a.n - b.n || a.name.localeCompare(b.name))
    .map((row) => join(__dirname, row.name));
}

describe("migration 083 command agent", () => {
  it("is not applied and documents the grant and policy introspection", () => {
    expect(sql).toContain("NOT applied. Apply only after merge and Chris's OK.");
    expect(sql).toContain("information_schema.role_table_grants");
    expect(sql).toContain("relrowsecurity");
    expect(sql).toContain("pg_policies");
    expect(sql).toContain("083");
    expect(statements).not.toMatch(/create policy/i);
    expect(statements).not.toMatch(/security definer/i);
    expect(statements).not.toMatch(/insert into/i);
    expect(statements).not.toMatch(/\bto anon\b/i);
    expect(statements).not.toMatch(/\bto authenticated\b/i);
    expect(statements).not.toMatch(/\bto public\b/i);
  });

  it("makes api_key_id nullable and adds the actor check", () => {
    expect(statements).toMatch(/alter column api_key_id drop not null/i);
    expect(statements).toMatch(/add column if not exists source text not null default 'api_key'/i);
    expect(statements).toMatch(/add column if not exists requested_by uuid/i);
    expect(statements).toMatch(
      /foreign key \(requested_by\) references public\.profiles\(id\) on delete cascade/i
    );
    expect(statements).toMatch(/check \(source in \('api_key', 'command_agent'\)\)/i);
    expect(statements).toMatch(/source = 'api_key'/i);
    expect(statements).toMatch(/api_key_id is not null/i);
    expect(statements).toMatch(/requested_by is null/i);
    expect(statements).toMatch(/source = 'command_agent'/i);
    expect(statements).toMatch(/api_key_id is null/i);
    expect(statements).toMatch(/requested_by is not null/i);
    expect(statements).toMatch(/requested_by = brand_id/i);
    expect(statements).not.toMatch(/drop constraint if exists api_write_actions_api_key_id_fkey/i);
  });

  it("creates the conversation tables, the marker, and the content cap", () => {
    expect(statements).toMatch(/create table if not exists public\.command_agent_conversations/i);
    expect(statements).toMatch(/create table if not exists public\.command_agent_messages/i);
    expect(statements).toMatch(/turn_started_at timestamptz/i);
    expect(statements).toMatch(/char_length\(title\) <= 120/i);
    expect(statements).toMatch(/role in \('user', 'assistant', 'tool'\)/i);
    expect(statements).toMatch(/octet_length\(content::text\) <= 65536/i);
    expect(statements).toMatch(/input_tokens >= 0/i);
    expect(statements).toMatch(/output_tokens >= 0/i);
    expect(statements).toMatch(/\(brand_id, updated_at desc\)/i);
    expect(statements).toMatch(/\(conversation_id, created_at\)/i);
    expect(statements).toMatch(/\(brand_id, created_at\)/i);
    expect(statements).toMatch(/create table if not exists public\.command_agent_usage/i);
    const usageStart = statements.toLowerCase().indexOf("create table if not exists public.command_agent_usage");
    const grantsStart = statements.toLowerCase().indexOf("revoke all on table public.api_write_actions");
    const usageSql = statements.slice(usageStart, grantsStart);
    expect(usageSql).not.toMatch(/conversation_id/i);
    expect(usageSql).not.toMatch(/command_agent_conversations/i);
    expect(usageSql).toMatch(/\(brand_id, created_at\)/i);
  });

  it("keeps RLS with no policies and grants only service_role", () => {
    for (const table of TABLES) {
      expect(statements).toMatch(
        new RegExp(`revoke all on table public\\.${table} from public;`, "i")
      );
      expect(statements).toMatch(
        new RegExp(`revoke all on table public\\.${table} from anon;`, "i")
      );
      expect(statements).toMatch(
        new RegExp(`revoke all on table public\\.${table} from authenticated;`, "i")
      );
      expect(statements).toMatch(
        new RegExp(`grant all on table public\\.${table} to service_role;`, "i")
      );
      expect(statements).toMatch(
        new RegExp(
          `revoke truncate, references, trigger on table public\\.${table} from authenticated;`,
          "i"
        )
      );
      expect(statements).toMatch(
        new RegExp(`alter table public\\.${table} enable row level security;`, "i")
      );
      const grantAt = statements
        .toLowerCase()
        .indexOf(`grant all on table public.${table} to service_role;`);
      const rlsAt = statements
        .toLowerCase()
        .indexOf(`alter table public.${table} enable row level security;`);
      expect(grantAt).toBeGreaterThanOrEqual(0);
      expect(grantAt).toBeLessThan(rlsAt);
    }
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
`;

describe("migration 083 on PGlite", () => {
  const db = new PGlite();
  const brand = "11111111-1111-4111-8111-111111111111";
  const other = "22222222-2222-4222-8222-222222222222";

  async function query(statement: string): Promise<string> {
    const result = await db.query<{ value: string | null }>(statement);
    return (result.rows[0]?.value ?? "").trim();
  }

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

  beforeAll(async () => {
    await db.exec(prelude);
    for (const path of migrationFiles()) {
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
    await db.exec(sql);
  }, 180_000);

  afterAll(async () => {
    await db.close();
  });

  it("keeps the columns, both checks, RLS, and zero policies after a second apply", async () => {
    for (const table of TABLES) {
      expect(await query(`
        select c.relrowsecurity::text as value
          from pg_class c
          join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'public' and c.relname = '${table}';
      `)).toBe("true");
      expect(await query(`
        select count(*)::text as value from pg_policies
         where schemaname = 'public' and tablename = '${table}';
      `)).toBe("0");
    }
    expect(await query(`
      select is_nullable as value
        from information_schema.columns
       where table_schema = 'public'
         and table_name = 'api_write_actions'
         and column_name = 'api_key_id';
    `)).toBe("YES");
    expect(await query(`
      select string_agg(column_name, ',' order by column_name) as value
        from information_schema.columns
       where table_schema = 'public'
         and table_name = 'api_write_actions'
         and column_name in ('source', 'requested_by');
    `)).toBe("requested_by,source");
    expect(await query(`
      select string_agg(column_name, ',' order by column_name) as value
        from information_schema.columns
       where table_schema = 'public'
         and table_name = 'command_agent_conversations'
         and column_name in (
           'id', 'brand_id', 'title', 'created_at', 'updated_at', 'turn_started_at'
         );
    `)).toBe("brand_id,created_at,id,title,turn_started_at,updated_at");
    expect(await query(`
      select string_agg(column_name, ',' order by column_name) as value
        from information_schema.columns
       where table_schema = 'public'
         and table_name = 'command_agent_messages'
         and column_name in (
           'id', 'conversation_id', 'brand_id', 'role', 'content', 'action_ids',
           'input_tokens', 'output_tokens', 'created_at'
         );
    `)).toBe("action_ids,brand_id,content,conversation_id,created_at,id,input_tokens,output_tokens,role");
    expect(await query(`
      select string_agg(column_name, ',' order by column_name) as value
        from information_schema.columns
       where table_schema = 'public'
         and table_name = 'command_agent_usage'
         and column_name in (
           'id', 'brand_id', 'input_tokens', 'output_tokens', 'created_at'
         );
    `)).toBe("brand_id,created_at,id,input_tokens,output_tokens");
    expect(await query(`
      select count(*)::text as value
        from information_schema.columns
       where table_schema = 'public'
         and table_name = 'command_agent_usage'
         and column_name = 'conversation_id';
    `)).toBe("0");
    expect(await query(`
      select count(*)::text as value
        from pg_constraint
       where conrelid = 'public.command_agent_usage'::regclass
         and contype = 'f'
         and pg_get_constraintdef(oid) ilike '%command_agent_conversations%';
    `)).toBe("0");
    expect(await query(`
      select indexname as value
        from pg_indexes
       where schemaname = 'public'
         and tablename = 'command_agent_usage'
         and indexdef ilike '%(brand_id, created_at)%';
    `)).toBe("command_agent_usage_brand_created_idx");
    expect(await query(`
      select string_agg(conname, ',' order by conname) as value
        from pg_constraint
       where conrelid = 'public.api_write_actions'::regclass
         and conname in (
           'api_write_actions_source_check',
           'api_write_actions_actor_check',
           'api_write_actions_api_key_id_fkey'
         );
    `)).toBe(
      "api_write_actions_actor_check,api_write_actions_api_key_id_fkey,api_write_actions_source_check"
    );
  });

  it("grants service_role only on all three tables", async () => {
    for (const table of TABLES) {
      const grants = await query(`
        select coalesce(string_agg(grantee || ' ' || privilege_type, ',' order by grantee, privilege_type), '') as value
          from information_schema.role_table_grants
         where table_schema = 'public'
           and table_name = '${table}'
           and grantee in ('anon', 'PUBLIC', 'authenticated', 'service_role');
      `);
      expect(grants).not.toMatch(/anon|PUBLIC|authenticated/);
      expect(grants).toContain("service_role INSERT");
      expect(grants).toContain("service_role UPDATE");
      expect(grants).toContain("service_role SELECT");
      expect(grants).toContain("service_role DELETE");
      const outsiders = await query(`
        select count(*)::text as value
          from information_schema.role_table_grants
         where table_schema = 'public'
           and table_name = '${table}'
           and grantee in ('anon', 'PUBLIC', 'authenticated');
      `);
      expect(outsiders).toBe("0");
    }
  });

  it("rejects a bad actor and accepts a command agent row as service_role", async () => {
    await db.exec(`
      insert into auth.users (id, email) values
        ('${brand}', 'brand@example.com'),
        ('${other}', 'other@example.com');
      insert into public.profiles (id, email, role) values
        ('${brand}', 'brand@example.com', 'brand'),
        ('${other}', 'other@example.com', 'brand');
      insert into public.api_keys (brand_id, prefix, key_hash, scopes)
      values (
        '${brand}',
        '0123456789abcdef',
        '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
        array['write:campaigns']
      );
    `);
    const keyId = await query(`select id::text as value from public.api_keys limit 1;`);
    const missingKey = await attempt(
      "service_role",
      `insert into public.api_write_actions (
         brand_id, api_key_id, kind, payload, payload_hash, idempotency_key
       ) values (
         '${brand}', null, 'campaign.create', '{}'::jsonb, 'abc', 'bad-key'
       )`
    );
    expect(missingKey).toMatch(/check constraint|api_write_actions_actor_check/i);
    const withKey = await attempt(
      "service_role",
      `insert into public.api_write_actions (
         brand_id, api_key_id, source, requested_by, kind, payload, payload_hash, idempotency_key
       ) values (
         '${brand}', '${keyId}', 'command_agent', '${brand}', 'campaign.create', '{}'::jsonb, 'abc', 'bad-agent-key'
       )`
    );
    expect(withKey).toMatch(/check constraint|api_write_actions_actor_check/i);
    const mismatch = await attempt(
      "service_role",
      `insert into public.api_write_actions (
         brand_id, api_key_id, source, requested_by, kind, payload, payload_hash, idempotency_key
       ) values (
         '${brand}', null, 'command_agent', '${other}', 'campaign.create', '{}'::jsonb, 'abc', 'bad-requester'
       )`
    );
    expect(mismatch).toMatch(/check constraint|api_write_actions_actor_check/i);
    const inserted = await attempt(
      "service_role",
      `insert into public.api_write_actions (
         brand_id, api_key_id, source, requested_by, kind, payload, payload_hash, idempotency_key
       ) values (
         '${brand}', null, 'command_agent', '${brand}', 'campaign.create', '{}'::jsonb, 'abc', 'ca-ok'
       )`
    );
    expect(inserted).toBe("allowed");
    expect(await query(`
      select count(*)::text as value
        from public.api_write_actions
       where source = 'command_agent'
         and api_key_id is null
         and requested_by = brand_id;
    `)).toBe("1");
  });

  it("denies anon and authenticated on all three tables", async () => {
    for (const role of ["anon", "authenticated"]) {
      for (const table of TABLES) {
        const read = await attempt(role, `select 1 from public.${table}`);
        expect(read).toMatch(/permission denied/i);
        const write = await attempt(
          role,
          `insert into public.${table} (id) values ('33333333-3333-4333-8333-333333333333')`
        );
        expect(write).toMatch(/permission denied/i);
      }
    }
  });
});
