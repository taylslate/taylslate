// Static assertions on migration 084, plus a PGlite apply of the
// on-disk migrations through 084. 059, 062, 063, 064, and 080
// are absent. That gap is expected. 084 is applied twice.
// Never uses a hosted database.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const sqlPath = join(__dirname, "084_command_agent_turn_lock.sql");
const sql = readFileSync(sqlPath, "utf8");
const statements = sql
  .split("\n")
  .filter((line) => !line.trim().startsWith("--"))
  .join("\n");

function migrationFiles(): string[] {
  return readdirSync(__dirname)
    .filter((name) => /^\d{3}_.+\.sql$/.test(name))
    .map((name) => ({ name, n: Number(name.slice(0, 3)) }))
    .filter((row) => row.n >= 1 && row.n <= 84)
    .sort((a, b) => a.n - b.n || a.name.localeCompare(b.name))
    .map((row) => join(__dirname, row.name));
}

describe("migration 084 command agent turn lock", () => {
  it("adds only the partial unique index", () => {
    expect(sql).toContain("NOT applied. Apply only after merge and Chris's OK.");
    expect(sql).toContain("083 is already applied");
    expect(statements).toMatch(
      /create unique index if not exists command_agent_conversations_one_turn_per_brand/i
    );
    expect(statements).toMatch(/on public\.command_agent_conversations \(brand_id\)/i);
    expect(statements).toMatch(/where turn_started_at is not null/i);
    expect(statements).toMatch(/order by turn_started_at desc, id desc/i);
    expect(statements).not.toMatch(/\bgrant\b/i);
    expect(statements).not.toMatch(/\brevoke\b/i);
    expect(statements).not.toMatch(/row level security/i);
    expect(statements).not.toMatch(/create policy/i);
    expect(statements).not.toMatch(/create table/i);
    expect(statements).not.toMatch(/\bto anon\b/i);
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

describe("migration 084 on PGlite", () => {
  const db = new PGlite();
  const brand = "11111111-1111-4111-8111-111111111111";
  const first = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
  const second = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";

  async function query(statement: string): Promise<string> {
    const result = await db.query<{ value: string | null }>(statement);
    return (result.rows[0]?.value ?? "").trim();
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

  it("applies twice, keeps a partial unique index, and leaves anon with nothing", async () => {
    const indexdef = await query(`
      select indexdef as value
        from pg_indexes
       where schemaname = 'public'
         and indexname = 'command_agent_conversations_one_turn_per_brand';
    `);
    expect(indexdef).toMatch(/UNIQUE/i);
    expect(indexdef).toMatch(/\(brand_id\)/i);
    expect(indexdef).toMatch(/turn_started_at IS NOT NULL/i);
    expect(await query(`
      select (indexdef ilike '%where%')::text as value
        from pg_indexes
       where schemaname = 'public'
         and indexname = 'command_agent_conversations_one_turn_per_brand';
    `)).toBe("true");

    const anon = await query(`
      select count(*)::text as value
        from information_schema.role_table_grants
       where table_schema = 'public'
         and table_name = 'command_agent_conversations'
         and grantee = 'anon';
    `);
    expect(anon).toBe("0");

    await db.exec(`
      insert into auth.users (id, email) values ('${brand}', 'brand@example.com');
      insert into public.profiles (id, email, role)
      values ('${brand}', 'brand@example.com', 'brand');
      insert into public.command_agent_conversations (id, brand_id, turn_started_at)
      values
        ('${first}', '${brand}', now()),
        ('${second}', '${brand}', null);
    `);
    await expect(
      db.exec(`
        update public.command_agent_conversations
           set turn_started_at = now()
         where id = '${second}';
      `)
    ).rejects.toThrow(/duplicate key|unique/i);

    await db.exec(`
      update public.command_agent_conversations
         set turn_started_at = null
       where id = '${first}';
      update public.command_agent_conversations
         set turn_started_at = now()
       where id = '${second}';
    `);
    expect(await query(`
      select count(*)::text as value
        from public.command_agent_conversations
       where brand_id = '${brand}'
         and turn_started_at is not null;
    `)).toBe("1");
  });
});
