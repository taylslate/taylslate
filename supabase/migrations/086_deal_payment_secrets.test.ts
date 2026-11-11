// Migration 086 on PGlite. Never uses a hosted database.
// Loads on-disk migrations 001 through 083 (059, 062, 063, 064,
// 080, 084, and 085 may be absent), seeds three deals, then applies 086.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const sqlPath = join(__dirname, "086_deal_payment_secrets.sql");
const sql = readFileSync(sqlPath, "utf8");
const statements = sql
  .split("\n")
  .filter((line) => !line.trim().startsWith("--"))
  .join("\n");

const BRAND = "11111111-1111-4111-8111-111111111111";
const SHOW_USER = "22222222-2222-4222-8222-222222222222";
const SHOW_ROW = "33333333-3333-4333-8333-333333333333";
const BRAND_PROFILE = "44444444-4444-4444-8444-444444444444";
const SHOW_PROFILE = "55555555-5555-4555-8555-555555555555";
const DEAL_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const DEAL_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2";
const DEAL_C = "cccccccc-cccc-4ccc-8ccc-ccccccccccc3";
const SECRET_A = "seti_backfill_a";
const SECRET_B = "seti_backfill_b";

// SEC3's deals INSERT list. setup_intent_client_secret is not on it.
const LEGACY_INSERT = `
  campaign_id, show_id, brand_id, agent_id, agency_id, status,
  num_episodes, placement, ad_format, price_type, cpm_rate, gross_cpm,
  guaranteed_downloads, net_per_episode, gross_per_episode, total_net,
  total_gross, is_scripted, is_personal_experience, reader_type,
  content_type, pixel_required, competitor_exclusion, exclusivity_days,
  rofr_days, flight_start, flight_end, notes
`;

function migrationFiles(): string[] {
  return readdirSync(__dirname)
    .filter((name) => /^\d{3}_.+\.sql$/.test(name))
    .map((name) => ({ name, n: Number(name.slice(0, 3)) }))
    .filter((row) => row.n >= 1 && row.n <= 83)
    .sort((a, b) => a.n - b.n || a.name.localeCompare(b.name))
    .map((row) => join(__dirname, row.name));
}

function errorText(err: unknown): string {
  if (err && typeof err === "object") {
    const code = "code" in err ? String((err as { code?: unknown }).code ?? "") : "";
    const message = "message" in err ? String((err as { message?: unknown }).message ?? "") : "";
    return `${code} ${message}`.trim();
  }
  return String(err);
}

describe("migration 086 deal payment secrets", () => {
  it("documents the service-only table, the backfill, and the drop", () => {
    expect(sql).toContain("NOT applied. Apply only after merge and Chris's OK.");
    expect(sql).toContain("information_schema.role_table_grants");
    expect(sql).toContain("relrowsecurity");
    expect(sql).toContain("pg_policies");
    expect(sql).toContain("setup_intent_client_secret");
    expect(statements).toMatch(/create table if not exists public\.deal_payment_secrets/i);
    expect(statements).toMatch(/references public\.deals\(id\) on delete cascade/i);
    expect(statements).toMatch(/on conflict \(deal_id\) do update/i);
    expect(statements).toMatch(/drop column if exists setup_intent_client_secret/i);
    expect(statements).toMatch(/alter table public\.deal_payment_secrets enable row level security/i);
    expect(statements).not.toMatch(/create policy/i);
    expect(statements).not.toMatch(/\bto anon\b/i);
    expect(statements).not.toMatch(/\bto authenticated\b/i);
    expect(statements).not.toMatch(/\bto public\b/i);
    expect(statements).not.toMatch(/grant\s+insert\s*\(/i);
    const grantAt = statements.toLowerCase().indexOf(
      "grant all on table public.deal_payment_secrets to service_role;"
    );
    const rlsAt = statements.toLowerCase().indexOf(
      "alter table public.deal_payment_secrets enable row level security;"
    );
    expect(grantAt).toBeGreaterThanOrEqual(0);
    expect(grantAt).toBeLessThan(rlsAt);
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

describe.sequential("migration 086 on PGlite", () => {
  const db = new PGlite();

  async function query(statement: string): Promise<string> {
    const result = await db.query<{ value: string | null }>(statement);
    return (result.rows[0]?.value ?? "").trim();
  }

  async function asRole(
    sub: string,
    role: "authenticated" | "anon" | "service_role",
    statement: string,
    commit = false
  ): Promise<{ ok: true; rows: Record<string, unknown>[] } | { ok: false; message: string }> {
    const claims = JSON.stringify({ sub, role });
    try {
      const results = await db.exec(`
        begin;
        select set_config('request.jwt.claims', '${claims.replace(/'/g, "''")}', true);
        select set_config('request.jwt.claim.sub', '${sub}', true);
        select set_config('request.jwt.claim.role', '${role}', true);
        set local role ${role};
        ${statement};
        ${commit ? "commit" : "rollback"};
      `);
      const rows = results.flatMap((result) => result.rows as Record<string, unknown>[]);
      return { ok: true, rows };
    } catch (err) {
      await db.exec("rollback").catch(() => undefined);
      await db.exec("reset role").catch(() => undefined);
      return { ok: false, message: errorText(err) };
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
        throw new Error(`${path}\n${errorText(err)}`);
      }
    }
    await db.exec(`
      insert into auth.users (id, email) values
        ('${BRAND}', 'brand-sec4@example.com'),
        ('${SHOW_USER}', 'show-sec4@example.com');
      insert into public.profiles (id, email, role) values
        ('${BRAND}', 'brand-sec4@example.com', 'brand'),
        ('${SHOW_USER}', 'show-sec4@example.com', 'show');
      insert into public.shows (id, name, platform) values
        ('${SHOW_ROW}', 'Night Desk', 'podcast');
      insert into public.brand_profiles (id, user_id) values
        ('${BRAND_PROFILE}', '${BRAND}');
      insert into public.show_profiles (id, user_id, show_name) values
        ('${SHOW_PROFILE}', '${SHOW_USER}', 'Night Desk');
      insert into public.deals (
        id, show_id, brand_id, brand_profile_id, show_profile_id,
        num_episodes, placement, ad_format, price_type, cpm_rate,
        guaranteed_downloads, net_per_episode, total_net,
        flight_start, flight_end, setup_intent_client_secret
      ) values
        ('${DEAL_A}', '${SHOW_ROW}', '${BRAND}', '${BRAND_PROFILE}', '${SHOW_PROFILE}',
         3, 'mid-roll', 'host_read', 'cpm', 25, 10000, 250, 750,
         '2026-05-01', '2026-05-31', '${SECRET_A}'),
        ('${DEAL_B}', '${SHOW_ROW}', '${BRAND}', '${BRAND_PROFILE}', '${SHOW_PROFILE}',
         3, 'mid-roll', 'host_read', 'cpm', 25, 10000, 250, 750,
         '2026-06-01', '2026-06-30', '${SECRET_B}'),
        ('${DEAL_C}', '${SHOW_ROW}', '${BRAND}', '${BRAND_PROFILE}', '${SHOW_PROFILE}',
         3, 'mid-roll', 'host_read', 'cpm', 25, 10000, 250, 750,
         '2026-07-01', '2026-07-31', null);
    `);
    await db.exec(sql);
  }, 180_000);

  afterAll(async () => {
    await db.close();
  });

  it("backfills the two secrets and drops the deals column", async () => {
    expect(await query(`
      select count(*)::text as value from public.deal_payment_secrets;
    `)).toBe("2");
    expect(await query(`
      select setup_intent_client_secret as value
        from public.deal_payment_secrets
       where deal_id = '${DEAL_A}';
    `)).toBe(SECRET_A);
    expect(await query(`
      select setup_intent_client_secret as value
        from public.deal_payment_secrets
       where deal_id = '${DEAL_B}';
    `)).toBe(SECRET_B);
    expect(await query(`
      select count(*)::text as value
        from public.deal_payment_secrets
       where deal_id = '${DEAL_C}';
    `)).toBe("0");
    await expect(
      db.exec("select setup_intent_client_secret from public.deals")
    ).rejects.toThrow(/42703|does not exist/i);
  });

  it("applies a second time without changing the secrets", async () => {
    const beforeCount = await query(`
      select count(*)::text as value from public.deal_payment_secrets;
    `);
    const beforeValues = await query(`
      select string_agg(deal_id::text || ':' || setup_intent_client_secret, ',' order by deal_id) as value
        from public.deal_payment_secrets;
    `);
    expect(beforeCount).toBe("2");
    expect(beforeValues).toBe(`${DEAL_A}:${SECRET_A},${DEAL_B}:${SECRET_B}`);
    await db.exec(sql);
    expect(await query(`
      select count(*)::text as value from public.deal_payment_secrets;
    `)).toBe(beforeCount);
    expect(await query(`
      select string_agg(deal_id::text || ':' || setup_intent_client_secret, ',' order by deal_id) as value
        from public.deal_payment_secrets;
    `)).toBe(beforeValues);
  });

  it("keeps RLS on, zero policies, and service_role as the only grantee", async () => {
    expect(await query(`
      select c.relrowsecurity::text as value
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relname = 'deal_payment_secrets';
    `)).toBe("true");
    expect(await query(`
      select count(*)::text as value from pg_policies
       where schemaname = 'public' and tablename = 'deal_payment_secrets';
    `)).toBe("0");
    const grants = await query(`
      select coalesce(string_agg(grantee || ' ' || privilege_type, ',' order by grantee, privilege_type), '') as value
        from information_schema.role_table_grants
       where table_schema = 'public'
         and table_name = 'deal_payment_secrets'
         and grantee in ('anon', 'PUBLIC', 'authenticated', 'service_role');
    `);
    expect(grants).not.toMatch(/anon|PUBLIC|authenticated/);
    expect(grants).toContain("service_role INSERT");
    expect(grants).toContain("service_role SELECT");
    expect(grants).toContain("service_role UPDATE");
    expect(grants).toContain("service_role DELETE");
  });

  it("denies the brand owner, the show owner, and anon", async () => {
    const secretSql = [
      "select * from public.deal_payment_secrets",
      `insert into public.deal_payment_secrets (deal_id, setup_intent_client_secret) values ('${DEAL_C}', 'nope')`,
      `update public.deal_payment_secrets set setup_intent_client_secret = 'nope' where deal_id = '${DEAL_A}'`,
      `delete from public.deal_payment_secrets where deal_id = '${DEAL_A}'`,
    ];
    for (const sub of [BRAND, SHOW_USER]) {
      for (const statement of secretSql) {
        const result = await asRole(sub, "authenticated", statement);
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.message).toMatch(/permission denied/i);
      }
      const deals = await asRole(sub, "authenticated", "select * from public.deals");
      expect(deals.ok).toBe(true);
      if (deals.ok) {
        const row = deals.rows.find((item) => item.id === DEAL_A);
        expect(row).toBeTruthy();
        expect(row).not.toHaveProperty("setup_intent_client_secret");
      }
    }
    for (const statement of secretSql) {
      const result = await asRole("", "anon", statement);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.message).toMatch(/permission denied/i);
    }
  });

  it("lets service_role insert, upsert, and select", async () => {
    const inserted = await asRole(
      "",
      "service_role",
      `insert into public.deal_payment_secrets (deal_id, setup_intent_client_secret) values ('${DEAL_C}', 'seti_service_insert')`,
      true
    );
    expect(inserted.ok).toBe(true);
    const upserted = await asRole(
      "",
      "service_role",
      `insert into public.deal_payment_secrets (deal_id, setup_intent_client_secret) values ('${DEAL_C}', 'seti_service_upsert') on conflict (deal_id) do update set setup_intent_client_secret = excluded.setup_intent_client_secret, updated_at = now()`,
      true
    );
    expect(upserted.ok).toBe(true);
    expect(await query(`
      select setup_intent_client_secret as value
        from public.deal_payment_secrets
       where deal_id = '${DEAL_C}';
    `)).toBe("seti_service_upsert");
  });

  it("cascades the secret when the deal is deleted", async () => {
    await db.exec(`delete from public.deals where id = '${DEAL_A}'`);
    expect(await query(`
      select count(*)::text as value
        from public.deal_payment_secrets
       where deal_id = '${DEAL_A}';
    `)).toBe("0");
    expect(await query(`
      select setup_intent_client_secret as value
        from public.deal_payment_secrets
       where deal_id = '${DEAL_B}';
    `)).toBe(SECRET_B);
  });

  it("accepts SEC3's legacy insert list after the column is gone, and again after 086 is reapplied", async () => {
    await db.exec(`
      revoke insert on public.deals from authenticated, anon, public;
      grant insert (${LEGACY_INSERT}) on public.deals to authenticated;
    `);
    const inserted = await asRole(
      BRAND,
      "authenticated",
      `insert into public.deals (
         show_id, brand_id, status, num_episodes, placement, ad_format, price_type,
         cpm_rate, guaranteed_downloads, net_per_episode, total_net,
         flight_start, flight_end, notes
       ) values (
         '${SHOW_ROW}', '${BRAND}', 'planning', 3, 'mid-roll', 'host_read', 'cpm',
         25, 10000, 250, 750, '2026-08-01', '2026-08-31', 'legacy after 086'
       )`,
      true
    );
    expect(inserted.ok ? "allowed" : inserted.message).toBe("allowed");
    await db.exec(sql);
    const again = await asRole(
      BRAND,
      "authenticated",
      `insert into public.deals (
         show_id, brand_id, num_episodes, placement, ad_format, price_type,
         cpm_rate, guaranteed_downloads, net_per_episode, total_net,
         flight_start, flight_end, notes
       ) values (
         '${SHOW_ROW}', '${BRAND}', 3, 'mid-roll', 'host_read', 'cpm',
         25, 10000, 250, 750, '2026-09-01', '2026-09-30', 'legacy after reapply'
       )`,
      true
    );
    expect(again.ok ? "allowed" : again.message).toBe("allowed");
    expect(await query(`
      select count(*)::text as value from public.deals where notes like 'legacy after%';
    `)).toBe("2");
    await expect(
      db.exec(
        "grant insert (setup_intent_client_secret) on public.deals to authenticated"
      )
    ).rejects.toThrow(/42703|does not exist/i);
  });
});

describe("086 and an 085-shaped grant in either order", () => {
  const db = new PGlite();

  beforeAll(async () => {
    await db.exec(`
      create role authenticated nologin;
      create role anon nologin;
      create role service_role nologin bypassrls;
      create table public.deals (
        id uuid primary key,
        notes text,
        setup_intent_client_secret text
      );
      insert into public.deals (id, notes, setup_intent_client_secret) values
        ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'one', 'seti_order_a'),
        ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2', 'two', 'seti_order_b'),
        ('cccccccc-cccc-4ccc-8ccc-ccccccccccc3', 'three', null);
      revoke insert on public.deals from authenticated;
      grant insert (notes) on public.deals to authenticated;
      grant insert (setup_intent_client_secret) on public.deals to authenticated;
    `);
    await db.exec(sql);
  });

  afterAll(async () => {
    await db.close();
  });

  it("keeps the other column grant when 086 drops the secret column", async () => {
    const notes = await db.query<{ privilege_type: string }>(`
      select privilege_type
        from information_schema.column_privileges
       where table_schema = 'public'
         and table_name = 'deals'
         and column_name = 'notes'
         and grantee = 'authenticated'
         and privilege_type = 'INSERT';
    `);
    expect(notes.rows).toHaveLength(1);
    const secret = await db.query(`
      select count(*)::int as n
        from information_schema.column_privileges
       where table_schema = 'public'
         and table_name = 'deals'
         and column_name = 'setup_intent_client_secret';
    `);
    expect(secret.rows[0]).toMatchObject({ n: 0 });
    await db.exec("grant insert (notes) on public.deals to authenticated");
    await expect(
      db.exec(
        "grant insert (notes, setup_intent_client_secret) on public.deals to authenticated"
      )
    ).rejects.toThrow(/42703|does not exist/i);
    const count = await db.query<{ n: number }>(
      "select count(*)::int as n from public.deal_payment_secrets"
    );
    expect(count.rows[0]?.n).toBe(2);
  });
});
