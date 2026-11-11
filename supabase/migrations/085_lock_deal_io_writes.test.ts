// Migration 085. Runs in PGlite. Never uses a hosted database.
// Loads on-disk migrations 001 through 085. 059, 062, 063, 064,
// and 080 may be absent. 080 is reserved. 084 is on main.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const sqlPath = join(__dirname, "085_lock_deal_io_writes.sql");
const sql = readFileSync(sqlPath, "utf8");
const statements = sql
  .split("\n")
  .filter((line) => !line.trim().startsWith("--"))
  .join("\n");

const BRAND = "11111111-1111-4111-8111-111111111111";
const SHOW_USER = "22222222-2222-4222-8222-222222222222";
const SHOW = "33333333-3333-4333-8333-333333333333";
const CAMPAIGN = "44444444-4444-4444-8444-444444444444";
const BRAND_PROFILE = "55555555-5555-4555-8555-555555555555";
const SHOW_PROFILE = "66666666-6666-4666-8666-666666666666";
const OUTREACH = "77777777-7777-4777-8777-777777777777";
const LEGACY_DEAL = "88888888-8888-4888-8888-888888888888";
const DOCUSIGN_DEAL = "99999999-9999-4999-8999-999999999999";
const LEGACY_IO = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const DOCUSIGN_IO = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";
const LEGACY_LINE = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1";
const DOCUSIGN_LINE = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2";
const LEGACY_INV = "cccccccc-cccc-4ccc-8ccc-ccccccccccc1";
const DOCUSIGN_INV = "cccccccc-cccc-4ccc-8ccc-ccccccccccc2";
const LEGACY_INV_LINE = "dddddddd-dddd-4ddd-8ddd-ddddddddddd1";
const DOCUSIGN_INV_LINE = "dddddddd-dddd-4ddd-8ddd-ddddddddddd2";

const TABLES = [
  "deals",
  "insertion_orders",
  "io_line_items",
  "invoices",
  "invoice_line_items",
  "outreaches",
  "payouts",
] as const;

const DEAL_COLUMNS = [
  "status",
  "agreed_cpm",
  "show_profile_id",
  "brand_signed_at",
  "docusign_envelope_id",
  "payment_method_id",
  "promo_code",
] as const;

function migrationFiles(): string[] {
  return readdirSync(__dirname)
    .filter((name) => /^\d{3}_.+\.sql$/.test(name))
    .map((name) => ({ name, n: Number(name.slice(0, 3)) }))
    .filter((row) => row.n >= 1 && row.n <= 85)
    .sort((a, b) => a.n - b.n || a.name.localeCompare(b.name))
    .map((row) => join(__dirname, row.name));
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
grant usage on schema auth to authenticated, service_role;
grant execute on function auth.uid() to authenticated, service_role;
grant execute on function auth.role() to authenticated, service_role;
`;

function legacyDealInsert(extra: string): string {
  return `
    insert into public.deals (
      show_id, brand_id, status, num_episodes, placement, ad_format,
      price_type, cpm_rate, guaranteed_downloads, net_per_episode, total_net,
      is_scripted, is_personal_experience, reader_type, content_type,
      pixel_required, competitor_exclusion, exclusivity_days, rofr_days,
      flight_start, flight_end${extra ? `, ${extra.split("=")[0].trim()}` : ""}
    ) values (
      '${SHOW}', '${BRAND}', 'planning', 3, 'mid-roll', 'host_read',
      'cpm', 25, 1000, 25, 75,
      false, true, 'host_read', 'evergreen',
      false, array[]::text[], 90, 30,
      '2026-12-01', '2026-12-31'${extra ? `, ${extra.split("=").slice(1).join("=").trim()}` : ""}
    )
  `;
}

describe("migration 085 lock deal writes", () => {
  it("is not applied and documents the introspection", () => {
    expect(sql).toContain("NOT applied. Apply only after merge and Chris's OK.");
    expect(sql).toContain("information_schema.role_table_grants");
    expect(sql).toContain("information_schema.column_privileges");
    expect(sql).toContain("reject_client_write_on_docusign_deal");
    expect(sql).toContain("pg_policies");
    expect(sql).not.toContain("\u2014");
    expect(statements).toContain("private.reject_client_write_on_docusign_deal");
    expect(statements).toMatch(/security definer/i);
    expect(statements).toMatch(/set search_path = public, pg_temp/i);
    expect(statements).not.toMatch(/\binsert into\b/i);
    expect(statements).not.toMatch(/\bto anon\b/i);
    expect(statements).not.toMatch(/\bto public\b/i);
  });
});

describe("migration 085 on PGlite", () => {
  const db = new PGlite();

  async function rollback() {
    try {
      await db.exec("rollback");
    } catch {
      // No open transaction.
    }
  }

  async function asJwt(role: "authenticated" | "service_role", uid: string, statement: string) {
    const claims = JSON.stringify({ sub: uid, role });
    try {
      await db.exec(`
        begin;
        select set_config('request.jwt.claims', '${claims}', true);
        set local role ${role};
        ${statement};
        commit;
      `);
    } catch (err) {
      await rollback();
      throw err;
    }
  }

  async function asJwtRows<T extends Record<string, unknown>>(
    role: "authenticated" | "service_role",
    uid: string,
    statement: string
  ): Promise<T[]> {
    const claims = JSON.stringify({ sub: uid, role });
    await db.exec("begin");
    try {
      await db.exec(`select set_config('request.jwt.claims', '${claims}', true)`);
      await db.exec(`set local role ${role}`);
      const result = await db.query<T>(statement);
      await db.exec("commit");
      return result.rows;
    } catch (err) {
      await rollback();
      throw err;
    }
  }

  function denied(role: "authenticated" | "service_role", uid: string, statement: string) {
    return expect(asJwt(role, uid, statement)).rejects.toThrow(
      /42501|permission denied|client write rejected|locked profile column rejected/i
    );
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
    await db.exec(`
      create or replace function auth.uid()
      returns uuid language sql stable as $$
        select nullif(
          nullif(current_setting('request.jwt.claims', true), '')::json ->> 'sub',
          ''
        )::uuid
      $$;
      create or replace function auth.role()
      returns text language sql stable as $$
        select case
          when nullif(current_setting('request.jwt.claims', true), '') is null then null
          else nullif(current_setting('request.jwt.claims', true), '')::json ->> 'role'
        end
      $$;
    `);
    await db.exec(`
      insert into auth.users (id, email) values
        ('${BRAND}', 'brand@example.com'),
        ('${SHOW_USER}', 'show@example.com');
      insert into public.profiles (id, email, full_name, role) values
        ('${BRAND}', 'brand@example.com', 'Brand', 'brand'),
        ('${SHOW_USER}', 'show@example.com', 'Show', 'show');
      insert into public.shows (id, name, platform)
        values ('${SHOW}', 'SEC3 Show', 'podcast');
      insert into public.campaigns (id, user_id, name, budget_total)
        values ('${CAMPAIGN}', '${BRAND}', 'SEC3', 1000);
      insert into public.brand_profiles (id, user_id)
        values ('${BRAND_PROFILE}', '${BRAND}');
      insert into public.show_profiles (id, user_id)
        values ('${SHOW_PROFILE}', '${SHOW_USER}');
      insert into public.outreaches (
        id, brand_profile_id, campaign_id, show_id, show_name,
        proposed_cpm, proposed_episode_count, proposed_placement,
        proposed_flight_start, proposed_flight_end, pitch_body,
        sent_to_email, token
      ) values (
        '${OUTREACH}', '${BRAND_PROFILE}', '${CAMPAIGN}', '${SHOW}', 'SEC3 Show',
        25, 3, 'mid-roll', '2026-12-01', '2026-12-31', 'Hello',
        'show@example.com', 'token-sec3'
      );
      insert into public.deals (
        id, show_id, brand_id, campaign_id, status, num_episodes, placement,
        ad_format, price_type, cpm_rate, gross_cpm, guaranteed_downloads,
        net_per_episode, gross_per_episode, total_net, total_gross,
        is_scripted, is_personal_experience, reader_type, content_type,
        pixel_required, competitor_exclusion, exclusivity_days, rofr_days,
        flight_start, flight_end
      ) values (
        '${LEGACY_DEAL}', '${SHOW}', '${BRAND}', '${CAMPAIGN}', 'planning', 3, 'mid-roll',
        'host_read', 'cpm', 25, 25, 1000,
        25, 25, 75, 75,
        false, true, 'host_read', 'evergreen',
        false, array[]::text[], 90, 30,
        '2026-12-01', '2026-12-31'
      );
      insert into public.deals (
        id, show_id, brand_id, campaign_id, status, num_episodes, placement,
        ad_format, price_type, cpm_rate, gross_cpm, guaranteed_downloads,
        net_per_episode, gross_per_episode, total_net, total_gross,
        is_scripted, is_personal_experience, reader_type, content_type,
        pixel_required, competitor_exclusion, exclusivity_days, rofr_days,
        flight_start, flight_end, outreach_id, brand_profile_id
      ) values (
        '${DOCUSIGN_DEAL}', '${SHOW}', '${BRAND}', '${CAMPAIGN}', 'planning', 3, 'mid-roll',
        'host_read', 'cpm', 25, 25, 1000,
        25, 25, 75, 75,
        false, true, 'host_read', 'evergreen',
        false, array[]::text[], 90, 30,
        '2026-12-01', '2026-12-31', '${OUTREACH}', '${BRAND_PROFILE}'
      );
      insert into public.insertion_orders (
        id, io_number, deal_id, advertiser_name, publisher_name,
        publisher_contact_name, publisher_contact_email,
        total_downloads, total_gross, total_net, status
      ) values
        (
          '${LEGACY_IO}', 'IO-LEGACY', '${LEGACY_DEAL}', 'Advertiser', 'SEC3 Show',
          'Pat', 'pat@example.com', 3000, 75, 75, 'draft'
        ),
        (
          '${DOCUSIGN_IO}', 'IO-DOCUSIGN', '${DOCUSIGN_DEAL}', 'Advertiser', 'SEC3 Show',
          'Pat', 'pat@example.com', 3000, 75, 75, 'draft'
        );
      insert into public.io_line_items (
        id, io_id, format, post_date, guaranteed_downloads, show_name, placement,
        gross_rate, gross_cpm, price_type, net_due
      ) values
        (
          '${LEGACY_LINE}', '${LEGACY_IO}', 'podcast', '2026-12-01', 1000, 'SEC3 Show', 'mid-roll',
          25, 25, 'cpm', 25
        ),
        (
          '${DOCUSIGN_LINE}', '${DOCUSIGN_IO}', 'podcast', '2026-12-01', 1000, 'SEC3 Show', 'mid-roll',
          25, 25, 'cpm', 25
        );
      insert into public.invoices (
        id, invoice_number, io_id, io_number, bill_to_name, bill_to_email,
        from_name, from_email, advertiser_name, campaign_period,
        subtotal, total_due, status, due_date
      ) values
        (
          '${LEGACY_INV}', 'INV-LEGACY', '${LEGACY_IO}', 'IO-LEGACY', 'Advertiser', 'brand@example.com',
          'SEC3 Show', 'pat@example.com', 'Advertiser', 'December 2026',
          75, 75, 'draft', '2027-01-31'
        ),
        (
          '${DOCUSIGN_INV}', 'INV-DOCUSIGN', '${DOCUSIGN_IO}', 'IO-DOCUSIGN', 'Advertiser', 'brand@example.com',
          'SEC3 Show', 'pat@example.com', 'Advertiser', 'December 2026',
          75, 75, 'draft', '2027-01-31'
        );
      insert into public.invoice_line_items (
        id, invoice_id, io_line_item_id, show_name, post_date, description,
        guaranteed_downloads, rate
      ) values
        (
          '${LEGACY_INV_LINE}', '${LEGACY_INV}', '${LEGACY_LINE}', 'SEC3 Show', '2026-12-01', 'Mid-roll',
          1000, 25
        ),
        (
          '${DOCUSIGN_INV_LINE}', '${DOCUSIGN_INV}', '${DOCUSIGN_LINE}', 'SEC3 Show', '2026-12-01', 'Mid-roll',
          1000, 25
        );
    `);
  }, 180_000);

  afterAll(async () => {
    await db.close();
  });

  it("keeps RLS, drops the dead policies, and leaves anon with nothing after a second apply", async () => {
    const who = await db.query<{ current_user: string }>("select current_user");
    expect(who.rows[0]?.current_user).toBe("postgres");

    for (const table of TABLES) {
      const rls = await db.query<{ relrowsecurity: boolean }>(`
        select c.relrowsecurity
          from pg_class c
          join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'public' and c.relname = '${table}'
      `);
      expect(rls.rows[0]?.relrowsecurity).toBe(true);

      const anon = await db.query(`
        select privilege_type
          from information_schema.role_table_grants
         where table_schema = 'public'
           and table_name = '${table}'
           and grantee in ('anon', 'PUBLIC')
        union all
        select privilege_type
          from information_schema.column_privileges
         where table_schema = 'public'
           and table_name = '${table}'
           and grantee in ('anon', 'PUBLIC')
      `);
      expect(anon.rows).toEqual([]);

      for (const privilege of ["SELECT", "INSERT", "UPDATE", "DELETE"]) {
        const allowed = await db.query<{ ok: boolean }>(
          `select has_table_privilege('service_role', 'public.${table}', '${privilege}') as ok`
        );
        expect(allowed.rows[0]?.ok).toBe(true);
      }
    }

    const dropped = await db.query(`
      select policyname
        from pg_policies
       where schemaname = 'public'
         and policyname in (
           'Brand updates own deals via brand_profile',
           'Deal participants update deals',
           'Brand inserts own outreach',
           'Brand updates own outreach'
         )
    `);
    expect(dropped.rows).toEqual([]);

    const kept = await db.query<{ policyname: string }>(`
      select policyname
        from pg_policies
       where schemaname = 'public'
         and policyname in (
           'Deal participants insert deals',
           'Deal participants read deals',
           'Brand reads own outreach',
           'IO insert via deal',
           'IO update via deal',
           'IO line items update via deal',
           'Invoice update via deal'
         )
       order by policyname
    `);
    expect(kept.rows.map((row) => row.policyname)).toEqual([
      "Brand reads own outreach",
      "Deal participants insert deals",
      "Deal participants read deals",
      "IO insert via deal",
      "IO line items update via deal",
      "IO update via deal",
      "Invoice update via deal",
    ]);

    const triggers = await db.query<{ relname: string }>(`
      select c.relname
        from pg_trigger t
        join pg_class c on c.oid = t.tgrelid
        join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public'
         and not t.tgisinternal
         and t.tgname = 'reject_client_write_on_docusign_deal'
       order by 1
    `);
    expect(triggers.rows.map((row) => row.relname)).toEqual([
      "insertion_orders",
      "invoice_line_items",
      "invoices",
      "io_line_items",
    ]);

    const execute = await db.query<{ ok: boolean }>(`
      select has_function_privilege(
        'authenticated',
        'private.reject_client_write_on_docusign_deal()',
        'EXECUTE'
      ) as ok
    `);
    expect(execute.rows[0]?.ok).toBe(false);
  });

  it("blocks authenticated updates and deletes on both deals", async () => {
    const assignments: Record<(typeof DEAL_COLUMNS)[number], string> = {
      status: "'cancelled'",
      agreed_cpm: "9",
      show_profile_id: `'${SHOW_PROFILE}'`,
      brand_signed_at: "now()",
      docusign_envelope_id: "'env-1'",
      payment_method_id: "'pm_x'",
      promo_code: "'CODE'",
    };
    for (const dealId of [LEGACY_DEAL, DOCUSIGN_DEAL]) {
      for (const column of DEAL_COLUMNS) {
        await denied(
          "authenticated",
          BRAND,
          `update public.deals set ${column} = ${assignments[column]} where id = '${dealId}'`
        );
      }
      await denied(
        "authenticated",
        BRAND,
        `delete from public.deals where id = '${dealId}'`
      );
    }
    const status = await db.query<{ status: string }>(
      `select status from public.deals where id = '${LEGACY_DEAL}'`
    );
    expect(status.rows[0]?.status).toBe("planning");
  });

  it("allows the legacy deal inserts and rejects money and signature columns", async () => {
    await asJwt(
      "authenticated",
      BRAND,
      `
        insert into public.deals (
          show_id, brand_id, status, num_episodes, placement, ad_format,
          price_type, cpm_rate, guaranteed_downloads, net_per_episode, total_net,
          is_scripted, is_personal_experience, reader_type, content_type,
          pixel_required, competitor_exclusion, exclusivity_days, rofr_days,
          flight_start, flight_end
        ) values (
          '${SHOW}', '${BRAND}', 'planning', 3, 'mid-roll', 'host_read',
          'cpm', 25, 1000, 25, 75,
          false, true, 'host_read', 'evergreen',
          false, array[]::text[], 90, 30,
          '2026-12-01', '2026-12-31'
        )
      `
    );

    await asJwt(
      "authenticated",
      BRAND,
      `
        insert into public.deals (
          show_id, brand_id, campaign_id, status, num_episodes, placement,
          ad_format, price_type, cpm_rate, gross_cpm, guaranteed_downloads,
          net_per_episode, gross_per_episode, total_net, total_gross,
          is_scripted, is_personal_experience, reader_type, content_type,
          pixel_required, competitor_exclusion, exclusivity_days, rofr_days,
          flight_start, flight_end, notes
        ) values (
          '${SHOW}', '${BRAND}', '${CAMPAIGN}', 'planning', 3, 'mid-roll',
          'host_read', 'cpm', 25, 25, 1000,
          25, 25, 75, 75,
          false, true, 'host_read', 'evergreen',
          false, array['Other']::text[], 90, 30,
          '2026-12-01', '2026-12-31', 'note'
        )
      `
    );

    await asJwt(
      "authenticated",
      BRAND,
      `
        insert into public.deals (
          show_id, brand_id, agent_id, status, num_episodes, placement,
          ad_format, price_type, cpm_rate, guaranteed_downloads,
          net_per_episode, total_net, is_scripted, is_personal_experience,
          reader_type, content_type, pixel_required, competitor_exclusion,
          exclusivity_days, rofr_days, flight_start, flight_end
        ) values (
          '${SHOW}', '${BRAND}', '${BRAND}', 'planning', 3, 'mid-roll',
          'host_read', 'cpm', 25, 1000,
          25, 75, false, true,
          'host_read', 'evergreen', false, array[]::text[],
          90, 30, '2026-12-01', '2026-12-31'
        )
      `
    );

    await asJwt(
      "authenticated",
      BRAND,
      `
        insert into public.deals (
          show_id, brand_id, agency_id, status, num_episodes, placement,
          ad_format, price_type, cpm_rate, guaranteed_downloads,
          net_per_episode, total_net, is_scripted, is_personal_experience,
          reader_type, content_type, pixel_required, competitor_exclusion,
          exclusivity_days, rofr_days, flight_start, flight_end
        ) values (
          '${SHOW}', '${BRAND}', '${BRAND}', 'planning', 3, 'mid-roll',
          'host_read', 'cpm', 25, 1000,
          25, 75, false, true,
          'host_read', 'evergreen', false, array[]::text[],
          90, 30, '2026-12-01', '2026-12-31'
        )
      `
    );

    await asJwt(
      "authenticated",
      BRAND,
      `
        insert into public.deals (
          campaign_id, show_id, brand_id, status, num_episodes, placement,
          ad_format, price_type, cpm_rate, guaranteed_downloads,
          net_per_episode, gross_per_episode, gross_cpm, total_net, total_gross,
          is_scripted, is_personal_experience, reader_type, content_type,
          pixel_required, competitor_exclusion, exclusivity_days, rofr_days,
          flight_start, flight_end
        ) values (
          '${CAMPAIGN}', '${SHOW}', '${BRAND}', 'planning', 3, 'mid-roll',
          'host_read', 'cpm', 25, 1000,
          25, 25, 25, 75, 75,
          false, true, 'host_read', 'evergreen',
          false, array[]::text[], 90, 30,
          '2026-12-01', '2026-12-31'
        )
      `
    );

    await asJwt(
      "authenticated",
      BRAND,
      `
        insert into public.deals (
          campaign_id, show_id, brand_id, status, num_episodes, placement,
          ad_format, price_type, cpm_rate, guaranteed_downloads,
          net_per_episode, gross_per_episode, gross_cpm, total_net, total_gross,
          is_scripted, is_personal_experience, reader_type, content_type,
          pixel_required, competitor_exclusion, exclusivity_days, rofr_days,
          flight_start, flight_end
        ) values (
          '${CAMPAIGN}', '${SHOW}', '${BRAND}', 'planning', 1, 'mid-roll',
          'integration', 'flat_rate', 0, 1000,
          500, 500, 0, 500, 500,
          false, false, 'host_read', 'evergreen',
          false, array[]::text[], 90, 30,
          '2026-12-01', '2026-12-07'
        )
      `
    );

    const extras: Array<[string, string]> = [
      ["brand_profile_id", `'${BRAND_PROFILE}'`],
      ["outreach_id", `'${OUTREACH}'`],
      ["show_profile_id", `'${SHOW_PROFILE}'`],
      ["brand_signed_at", "now()"],
      ["payment_method_id", "'pm_x'"],
      ["id", `'${LEGACY_DEAL}'`],
      ["created_at", "now()"],
      ["updated_at", "now()"],
    ];
    for (const [column, value] of extras) {
      await denied("authenticated", BRAND, legacyDealInsert(`${column} = ${value}`));
    }
    await denied(
      "authenticated",
      BRAND,
      `
        insert into public.deals (
          show_id, brand_id, status, agreed_cpm, num_episodes, placement,
          ad_format, price_type, cpm_rate, guaranteed_downloads,
          net_per_episode, total_net, is_scripted, is_personal_experience,
          reader_type, content_type, pixel_required, competitor_exclusion,
          exclusivity_days, rofr_days, flight_start, flight_end
        ) values (
          '${SHOW}', '${BRAND}', 'planning', 40, 3, 'mid-roll',
          'host_read', 'cpm', 25, 1000,
          25, 75, false, true,
          'host_read', 'evergreen', false, array[]::text[],
          90, 30, '2026-12-01', '2026-12-31'
        )
      `
    );
  });

  it("blocks IO, line, and invoice writes on the DocuSign-flow deal", async () => {
    await denied(
      "authenticated",
      BRAND,
      `update public.io_line_items set gross_rate = 1 where id = '${DOCUSIGN_LINE}'`
    );
    await denied(
      "authenticated",
      BRAND,
      `update public.insertion_orders set status = 'sent' where id = '${DOCUSIGN_IO}'`
    );
    await denied(
      "authenticated",
      BRAND,
      `update public.invoices set status = 'sent' where id = '${DOCUSIGN_INV}'`
    );
    await denied(
      "authenticated",
      BRAND,
      `
        insert into public.io_line_items (
          io_id, format, post_date, guaranteed_downloads, show_name, placement,
          gross_rate, gross_cpm, price_type, net_due
        ) values (
          '${DOCUSIGN_IO}', 'podcast', '2026-12-08', 1000, 'SEC3 Show', 'mid-roll',
          25, 25, 'cpm', 25
        )
      `
    );
    await denied(
      "authenticated",
      BRAND,
      `
        insert into public.insertion_orders (
          io_number, deal_id, advertiser_name, publisher_name,
          publisher_contact_name, publisher_contact_email,
          total_downloads, total_gross, total_net
        ) values (
          'IO-SEC3-BLOCKED', '${DOCUSIGN_DEAL}', 'Advertiser', 'SEC3 Show',
          'Pat', 'pat@example.com', 1000, 25, 25
        )
      `
    );
    await denied(
      "authenticated",
      BRAND,
      `
        insert into public.invoices (
          invoice_number, io_id, io_number, bill_to_name, bill_to_email,
          from_name, from_email, advertiser_name, campaign_period,
          subtotal, total_due, due_date
        ) values (
          'INV-SEC3-BLOCKED', '${DOCUSIGN_IO}', 'IO-DOCUSIGN', 'Advertiser', 'brand@example.com',
          'SEC3 Show', 'pat@example.com', 'Advertiser', 'December 2026',
          25, 25, '2027-01-31'
        )
      `
    );
    await denied(
      "authenticated",
      BRAND,
      `
        insert into public.invoice_line_items (
          invoice_id, io_line_item_id, show_name, post_date, description,
          guaranteed_downloads, rate
        ) values (
          '${DOCUSIGN_INV}', '${DOCUSIGN_LINE}', 'SEC3 Show', '2026-12-01', 'Mid-roll',
          1000, 25
        )
      `
    );
    const rate = await db.query<{ gross_rate: string }>(
      `select gross_rate::text from public.io_line_items where id = '${DOCUSIGN_LINE}'`
    );
    expect(Number(rate.rows[0]?.gross_rate)).toBe(25);
  });

  it("still allows the legacy IO editor and invoice status writes", async () => {
    await asJwt(
      "authenticated",
      BRAND,
      `
        update public.insertion_orders set
          advertiser_name = 'Advertiser',
          advertiser_contact_name = 'Ada',
          advertiser_contact_email = 'ada@example.com',
          publisher_name = 'SEC3 Show',
          publisher_contact_name = 'Pat',
          publisher_contact_email = 'pat@example.com',
          publisher_address = '1 Main',
          agency_name = 'Agency',
          agency_contact_name = 'Ann',
          agency_contact_email = 'ann@example.com',
          agency_billing_contact = 'bill@example.com',
          agency_address = '2 Main',
          send_invoices_to = 'bill@example.com',
          payment_terms = 'Net 30 EOM',
          payment_off_platform = false,
          competitor_exclusion = array['Other']::text[],
          exclusivity_days = 90,
          rofr_days = 30,
          rofr_enabled = true,
          cancellation_notice_days = 14,
          download_tracking_days = 45,
          download_tracking_enabled = true,
          make_good_threshold = 0.10,
          make_good_enabled = true,
          payer = 'brand',
          updated_at = now()
        where id = '${LEGACY_IO}'
      `
    );
    await asJwt(
      "authenticated",
      BRAND,
      `
        update public.insertion_orders set
          total_downloads = 1000,
          total_gross = 25,
          total_net = 25,
          updated_at = now()
        where id = '${LEGACY_IO}'
      `
    );
    await asJwt(
      "authenticated",
      BRAND,
      `
        update public.io_line_items set
          format = 'podcast',
          spot_format = null,
          show_surface_id = null,
          post_date = '2026-12-01',
          guaranteed_downloads = 1000,
          show_name = 'SEC3 Show',
          placement = 'mid-roll',
          is_scripted = false,
          is_personal_experience = true,
          reader_type = 'host_read',
          content_type = 'evergreen',
          pixel_required = false,
          gross_rate = 20,
          gross_cpm = 20,
          price_type = 'cpm',
          net_due = 20,
          actual_post_date = null,
          actual_downloads = null,
          episode_url = null,
          ad_timestamp = null,
          verified = false,
          make_good_triggered = false,
          make_good_reason = null
        where id = '${LEGACY_LINE}'
      `
    );
    await asJwt(
      "authenticated",
      BRAND,
      `
        insert into public.io_line_items (
          io_id, format, post_date, guaranteed_downloads, show_name, placement,
          is_scripted, is_personal_experience, reader_type, content_type,
          pixel_required, gross_rate, gross_cpm, price_type, net_due,
          verified, make_good_triggered
        ) values (
          '${LEGACY_IO}', 'podcast', '2026-12-08', 1000, 'SEC3 Show', 'mid-roll',
          false, true, 'host_read', 'evergreen',
          false, 25, 25, 'cpm', 25,
          false, false
        )
      `
    );
    await asJwt(
      "authenticated",
      BRAND,
      `
        insert into public.insertion_orders (
          io_number, deal_id, advertiser_name, advertiser_contact_name,
          advertiser_contact_email, publisher_name, publisher_contact_name,
          publisher_contact_email, total_downloads, total_gross, total_net,
          payment_terms, payment_off_platform, competitor_exclusion,
          exclusivity_days, rofr_days, cancellation_notice_days,
          download_tracking_days, make_good_threshold, status
        ) values (
          'IO-SEC3-CREATE', '${LEGACY_DEAL}', 'Advertiser', 'Brand',
          'brand@example.com', 'SEC3 Show', '', '',
          1000, 25, 25,
          'Net 30 EOM', false, array[]::text[],
          90, 30, 14, 45, 0.10, 'draft'
        );
        insert into public.io_line_items (
          io_id, format, post_date, guaranteed_downloads, show_name, placement,
          is_scripted, is_personal_experience, reader_type, content_type,
          pixel_required, gross_rate, gross_cpm, price_type, net_due,
          verified, make_good_triggered
        )
        select id, 'podcast', '2026-12-01', 1000, 'SEC3 Show', 'mid-roll',
          false, true, 'host_read', 'evergreen',
          false, 25, 25, 'cpm', 25,
          false, false
          from public.insertion_orders
         where io_number = 'IO-SEC3-CREATE';
      `
    );
    await asJwt(
      "authenticated",
      BRAND,
      `
        insert into public.invoices (
          invoice_number, io_id, io_number, bill_to_name, bill_to_email,
          from_name, from_email, from_address, advertiser_name, campaign_period,
          subtotal, adjustments, total_due, status, due_date
        ) values (
          'INV-SEC3-CREATE', '${LEGACY_IO}', 'IO-LEGACY', 'Advertiser', 'brand@example.com',
          'SEC3 Show', 'pat@example.com', null, 'Advertiser', 'December 2026',
          25, 0, 25, 'draft', '2027-01-31'
        );
        insert into public.invoice_line_items (
          invoice_id, io_line_item_id, show_name, post_date, description,
          guaranteed_downloads, actual_downloads, rate, make_good
        )
        select id, '${LEGACY_LINE}', 'SEC3 Show', '2026-12-01', 'Mid-roll ad',
          1000, null, 25, false
          from public.invoices
         where invoice_number = 'INV-SEC3-CREATE';
      `
    );
    await asJwt(
      "authenticated",
      BRAND,
      `
        update public.invoices
           set status = 'sent', sent_at = now(), updated_at = now()
         where id = '${LEGACY_INV}'
      `
    );
    await asJwt(
      "authenticated",
      BRAND,
      `
        update public.invoices
           set status = 'paid',
               paid_at = now(),
               payment_method = 'card',
               updated_at = now()
         where id = '${LEGACY_INV}'
      `
    );

    const saved = await db.query<{
      advertiser_contact_name: string;
      total_net: string;
      gross_rate: string;
      status: string;
      payment_method: string;
    }>(`
      select io.advertiser_contact_name,
             io.total_net::text,
             li.gross_rate::text,
             inv.status,
             inv.payment_method
        from public.insertion_orders io
        join public.io_line_items li on li.id = '${LEGACY_LINE}'
        join public.invoices inv on inv.id = '${LEGACY_INV}'
       where io.id = '${LEGACY_IO}'
    `);
    expect(saved.rows[0]).toMatchObject({
      advertiser_contact_name: "Ada",
      status: "paid",
      payment_method: "card",
    });
    expect(Number(saved.rows[0]?.total_net)).toBe(25);
    expect(Number(saved.rows[0]?.gross_rate)).toBe(20);

    await denied(
      "authenticated",
      BRAND,
      `update public.insertion_orders set status = 'sent' where id = '${LEGACY_IO}'`
    );
    await denied(
      "authenticated",
      BRAND,
      `update public.insertion_orders set signed_at = now() where id = '${LEGACY_IO}'`
    );
    await denied(
      "authenticated",
      BRAND,
      `update public.insertion_orders set sent_at = now() where id = '${LEGACY_IO}'`
    );
    await denied(
      "authenticated",
      BRAND,
      `update public.io_line_items set io_id = '${DOCUSIGN_IO}' where id = '${LEGACY_LINE}'`
    );
    await denied(
      "authenticated",
      BRAND,
      `update public.invoices set total_due = 1 where id = '${LEGACY_INV}'`
    );
    const still = await db.query<{ status: string; io_id: string; total_due: string }>(`
      select io.status, li.io_id::text, inv.total_due::text
        from public.insertion_orders io
        join public.io_line_items li on li.id = '${LEGACY_LINE}'
        join public.invoices inv on inv.id = '${LEGACY_INV}'
       where io.id = '${LEGACY_IO}'
    `);
    expect(still.rows[0]?.status).toBe("draft");
    expect(still.rows[0]?.io_id).toBe(LEGACY_IO);
    expect(Number(still.rows[0]?.total_due)).toBe(75);
  });

  it("blocks outreach and payout writes and still lets the brand read its outreach", async () => {
    await denied(
      "authenticated",
      BRAND,
      `
        insert into public.outreaches (
          brand_profile_id, campaign_id, show_name, proposed_cpm,
          proposed_episode_count, proposed_placement, proposed_flight_start,
          proposed_flight_end, pitch_body, sent_to_email, token
        ) values (
          '${BRAND_PROFILE}', '${CAMPAIGN}', 'Other', 10, 1, 'mid-roll',
          '2026-12-01', '2026-12-31', 'No', 'show@example.com', 'other-token'
        )
      `
    );
    await denied(
      "authenticated",
      BRAND,
      `update public.outreaches set response_status = 'declined' where id = '${OUTREACH}'`
    );
    await denied(
      "authenticated",
      BRAND,
      `delete from public.outreaches where id = '${OUTREACH}'`
    );
    const visible = await asJwtRows<{ id: string }>(
      "authenticated",
      BRAND,
      `select id::text as id from public.outreaches where id = '${OUTREACH}'`
    );
    expect(visible).toEqual([{ id: OUTREACH }]);

    await denied(
      "authenticated",
      BRAND,
      `insert into public.payouts (payment_id, amount_cents) values ('${LEGACY_INV}', 100)`
    );
    await denied("authenticated", BRAND, "update public.payouts set amount_cents = 1");
    await denied("authenticated", BRAND, "delete from public.payouts");
  });

  it("still blocks locked profile columns and still allows full_name", async () => {
    await asJwt(
      "authenticated",
      BRAND,
      `update public.profiles set full_name = 'Renamed' where id = '${BRAND}'`
    );
    const renamed = await db.query<{ full_name: string }>(
      `select full_name from public.profiles where id = '${BRAND}'`
    );
    expect(renamed.rows[0]?.full_name).toBe("Renamed");

    for (const [column, value] of [
      ["role", "'agent'"],
      ["plan", "'operator'"],
      ["tier", "'starter'"],
      ["platform_fee_percentage", "0"],
      ["stripe_customer_id", "'cus_x'"],
    ] as const) {
      await denied(
        "authenticated",
        BRAND,
        `update public.profiles set ${column} = ${value} where id = '${BRAND}'`
      );
    }
    const profile = await db.query<{ role: string; plan: string; tier: string }>(
      `select role, plan, tier from public.profiles where id = '${BRAND}'`
    );
    expect(profile.rows[0]).toMatchObject({ role: "brand", plan: "pay_as_you_go", tier: "free" });
  });

  it("lets service_role update both deals, insert a DocuSign IO, and update outreach", async () => {
    for (const dealId of [LEGACY_DEAL, DOCUSIGN_DEAL]) {
      await asJwt(
        "service_role",
        BRAND,
        `
          update public.deals set
            status = 'io_sent',
            agreed_cpm = 30,
            show_profile_id = '${SHOW_PROFILE}',
            brand_signed_at = now(),
            docusign_envelope_id = 'env-${dealId.slice(0, 8)}',
            payment_method_id = 'pm_${dealId.slice(0, 8)}',
            promo_code = 'SHOW20'
          where id = '${dealId}'
        `
      );
    }
    await asJwt(
      "service_role",
      BRAND,
      `
        insert into public.insertion_orders (
          io_number, deal_id, advertiser_name, publisher_name,
          publisher_contact_name, publisher_contact_email,
          total_downloads, total_gross, total_net
        ) values (
          'IO-SEC3-SERVICE', '${DOCUSIGN_DEAL}', 'Advertiser', 'SEC3 Show',
          'Pat', 'pat@example.com', 1000, 25, 25
        )
      `
    );
    await asJwt(
      "service_role",
      BRAND,
      `update public.outreaches set response_status = 'accepted', counter_cpm = 30 where id = '${OUTREACH}'`
    );
    const deal = await db.query<{ status: string; agreed_cpm: string; promo_code: string }>(
      `select status, agreed_cpm::text, promo_code from public.deals where id = '${DOCUSIGN_DEAL}'`
    );
    expect(deal.rows[0]).toMatchObject({
      status: "io_sent",
      promo_code: "SHOW20",
    });
    expect(Number(deal.rows[0]?.agreed_cpm)).toBe(30);
    const outreach = await db.query<{ response_status: string }>(
      `select response_status from public.outreaches where id = '${OUTREACH}'`
    );
    expect(outreach.rows[0]?.response_status).toBe("accepted");
  });
});
