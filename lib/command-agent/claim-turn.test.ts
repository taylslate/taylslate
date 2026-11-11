// claimTurn against PGlite with migrations through 084.
// Never uses a hosted database.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const COLUMNS = new Set([
  "id",
  "brand_id",
  "title",
  "created_at",
  "updated_at",
  "turn_started_at",
]);

type SqlDb = {
  query<T extends Record<string, unknown>>(
    sql: string,
    params?: unknown[]
  ): Promise<{ rows: T[] }>;
};

const harness = vi.hoisted(() => {
  const state: { db: SqlDb | null } = { db: null };

  function column(name: string): string {
    if (!COLUMNS.has(name)) throw new Error(`column ${name}`);
    return name;
  }

  function orSql(expression: string, params: unknown[]): string {
    const parts = expression.split(",").map((part) => {
      const match = part.match(/^([a-z_]+)\.(is|lt|gte|eq)\.(.*)$/);
      if (!match) throw new Error(`or ${part}`);
      const [, name, op, raw] = match;
      const field = column(name);
      if (op === "is" && raw === "null") return `${field} is null`;
      const value = raw.replace(/^"|"$/g, "");
      params.push(value);
      const cast = field.endsWith("_at") ? "::timestamptz" : "";
      if (op === "lt") return `${field} < $${params.length}${cast}`;
      if (op === "gte") return `${field} >= $${params.length}${cast}`;
      return `${field} = $${params.length}${cast}`;
    });
    return `(${parts.join(" or ")})`;
  }

  function pgCode(err: unknown): string {
    if (err && typeof err === "object" && "code" in err) {
      const code = (err as { code?: unknown }).code;
      if (typeof code === "string") return code;
    }
    const message = err instanceof Error ? err.message : String(err);
    if (/duplicate key|unique/i.test(message)) return "23505";
    return "";
  }

  function buildQuery(table: string) {
    if (table !== "command_agent_conversations") {
      throw new Error(`table ${table}`);
    }
    const filters: { column: string; op: string; value: unknown }[] = [];
    const ors: string[] = [];
    let op: "select" | "update" = "select";
    let patch: Record<string, unknown> | null = null;

    function whereSql(params: unknown[]): string {
      const parts: string[] = [];
      for (const filter of filters) {
        const field = column(filter.column);
        if (filter.op === "is") {
          if (filter.value !== null) throw new Error("only is null");
          parts.push(`${field} is null`);
          continue;
        }
        params.push(filter.value);
        const cast = field.endsWith("_at") ? "::timestamptz" : "";
        if (filter.op === "eq") parts.push(`${field} = $${params.length}`);
        else if (filter.op === "gte") parts.push(`${field} >= $${params.length}${cast}`);
        else if (filter.op === "lt") parts.push(`${field} < $${params.length}${cast}`);
        else throw new Error(filter.op);
      }
      for (const expression of ors) parts.push(orSql(expression, params));
      return parts.length > 0 ? parts.join(" and ") : "true";
    }

    async function execute(): Promise<{
      data: Record<string, unknown>[] | null;
      error: { code?: string; message: string } | null;
    }> {
      const db = state.db;
      if (!db) return { data: null, error: { message: "db not ready" } };
      const params: unknown[] = [];
      let sql: string;
      if (op === "update") {
        const sets: string[] = [];
        for (const [key, value] of Object.entries(patch ?? {})) {
          const field = column(key);
          if (value === null) {
            sets.push(`${field} = null`);
            continue;
          }
          params.push(value);
          const cast = field.endsWith("_at") ? "::timestamptz" : "";
          sets.push(`${field} = $${params.length}${cast}`);
        }
        const where = whereSql(params);
        sql = `update public.command_agent_conversations set ${sets.join(", ")} where ${where} returning id, brand_id, title, created_at, updated_at, turn_started_at`;
      } else {
        const where = whereSql(params);
        sql = `select id, brand_id, title, created_at, updated_at, turn_started_at from public.command_agent_conversations where ${where}`;
      }
      try {
        const result = await db.query<Record<string, unknown>>(sql, params);
        return { data: result.rows, error: null };
      } catch (err) {
        return {
          data: null,
          error: {
            code: pgCode(err),
            message: err instanceof Error ? err.message : String(err),
          },
        };
      }
    }

    const builder = {
      select() {
        return builder;
      },
      update(next: Record<string, unknown>) {
        op = "update";
        patch = next;
        return builder;
      },
      eq(columnName: string, value: unknown) {
        filters.push({ column: columnName, op: "eq", value });
        return builder;
      },
      is(columnName: string, value: unknown) {
        filters.push({ column: columnName, op: "is", value });
        return builder;
      },
      gte(columnName: string, value: unknown) {
        filters.push({ column: columnName, op: "gte", value });
        return builder;
      },
      or(expression: string) {
        ors.push(expression);
        return builder;
      },
      maybeSingle() {
        return execute().then((result) => ({
          data: result.data?.[0] ?? null,
          error: result.error,
        }));
      },
      then(
        onFulfilled: (value: unknown) => unknown,
        onRejected?: (reason: unknown) => unknown
      ) {
        return execute().then(onFulfilled, onRejected);
      },
    };
    return builder;
  }

  return { state, buildQuery };
});

vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: { from: (table: string) => harness.buildQuery(table) },
}));

import { claimTurn, releaseTurn } from "@/lib/command-agent/store";

const BRAND = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const A1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const A2 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";
const B1 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1";

function migrationFiles(maxN: number): string[] {
  const dir = join(process.cwd(), "supabase/migrations");
  return readdirSync(dir)
    .filter((name) => /^\d{3}_.+\.sql$/.test(name))
    .map((name) => ({ name, n: Number(name.slice(0, 3)) }))
    .filter((row) => row.n >= 1 && row.n <= maxN)
    .sort((a, b) => a.n - b.n || a.name.localeCompare(b.name))
    .map((row) => join(dir, row.name));
}

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

async function applyMigrations(db: PGlite, maxN: number): Promise<void> {
  await db.exec(prelude);
  for (const path of migrationFiles(maxN)) {
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
}

describe("claimTurn on PGlite", () => {
  const db = new PGlite();

  beforeAll(async () => {
    harness.state.db = db;
    await applyMigrations(db, 84);
    await db.exec(`
      insert into auth.users (id, email) values
        ('${BRAND}', 'brand-a@example.com'),
        ('${OTHER}', 'brand-b@example.com');
      insert into public.profiles (id, email, role) values
        ('${BRAND}', 'brand-a@example.com', 'brand'),
        ('${OTHER}', 'brand-b@example.com', 'brand');
    `);
  }, 180_000);

  afterAll(async () => {
    await db.close();
  });

  beforeEach(async () => {
    await db.exec("delete from public.command_agent_conversations;");
  });

  async function addConversation(id: string, brandId: string, stale = false): Promise<void> {
    await db.query(
      `insert into public.command_agent_conversations (id, brand_id, turn_started_at)
       values ($1, $2, case when $3 then now() - interval '121 seconds' else null end)`,
      [id, brandId, stale]
    );
  }

  async function held(brandId: string): Promise<number> {
    const result = await db.query<{ n: string }>(
      `select count(*)::text as n
         from public.command_agent_conversations
        where brand_id = $1
          and turn_started_at is not null`,
      [brandId]
    );
    return Number(result.rows[0]?.n ?? 0);
  }

  it("lets one of two parallel conversations claim the brand", async () => {
    await addConversation(A1, BRAND);
    await addConversation(A2, BRAND);
    const results = await Promise.all([claimTurn(BRAND, A1), claimTurn(BRAND, A2)]);
    expect(results.filter((result) => result === "claimed")).toHaveLength(1);
    expect(results.filter((result) => result === "busy")).toHaveLength(1);
    expect(await held(BRAND)).toBe(1);
  });

  it("lets one of two parallel claims on the same conversation win", async () => {
    await addConversation(A1, BRAND);
    const results = await Promise.all([claimTurn(BRAND, A1), claimTurn(BRAND, A1)]);
    expect(results.filter((result) => result === "claimed")).toHaveLength(1);
    expect(results.filter((result) => result === "busy")).toHaveLength(1);
    expect(await held(BRAND)).toBe(1);
  });

  it("reclaims a lock older than 120 seconds", async () => {
    await addConversation(A1, BRAND, true);
    expect(await claimTurn(BRAND, A1)).toBe("claimed");
    expect(await held(BRAND)).toBe(1);
  });

  it("claims again after release", async () => {
    await addConversation(A1, BRAND);
    expect(await claimTurn(BRAND, A1)).toBe("claimed");
    await releaseTurn(BRAND, A1);
    expect(await held(BRAND)).toBe(0);
    expect(await claimTurn(BRAND, A1)).toBe("claimed");
    expect(await held(BRAND)).toBe(1);
  });

  it("does not block a second brand", async () => {
    await addConversation(A1, BRAND);
    await addConversation(B1, OTHER);
    const [left, right] = await Promise.all([claimTurn(BRAND, A1), claimTurn(OTHER, B1)]);
    expect(left).toBe("claimed");
    expect(right).toBe("claimed");
    expect(await held(BRAND)).toBe(1);
    expect(await held(OTHER)).toBe(1);
  });
});

describe("claimTurn before migration 084", () => {
  const db = new PGlite();

  beforeAll(async () => {
    harness.state.db = db;
    await applyMigrations(db, 83);
    await db.exec(`
      insert into auth.users (id, email) values
        ('${BRAND}', 'brand-a@example.com'),
        ('${OTHER}', 'brand-b@example.com');
      insert into public.profiles (id, email, role) values
        ('${BRAND}', 'brand-a@example.com', 'brand'),
        ('${OTHER}', 'brand-b@example.com', 'brand');
    `);
  }, 180_000);

  afterAll(async () => {
    await db.close();
  });

  it("lets one of two parallel conversations claim the brand", async () => {
    const index = await db.query<{ n: string }>(
      `select count(*)::text as n
         from pg_indexes
        where schemaname = 'public'
          and indexname = 'command_agent_conversations_one_turn_per_brand'`
    );
    expect(index.rows[0]?.n).toBe("0");
    await db.query(
      `insert into public.command_agent_conversations (id, brand_id)
       values ($1, $2), ($3, $2)`,
      [A1, BRAND, A2]
    );
    const results = await Promise.all([claimTurn(BRAND, A1), claimTurn(BRAND, A2)]);
    expect(results.filter((result) => result === "claimed")).toHaveLength(1);
    expect(results.filter((result) => result === "busy")).toHaveLength(1);
  });
});
