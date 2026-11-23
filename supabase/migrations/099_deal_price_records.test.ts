import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const sql = readFileSync(join(__dirname, "099_deal_price_records.sql"), "utf8");
const statements = sql
  .split("\n")
  .filter((line) => !line.trim().startsWith("--"))
  .join("\n");

const BRAND = "11111111-1111-4111-8111-111111111111";
const SHOW_USER = "22222222-2222-4222-8222-222222222222";
const AGENT = "33333333-3333-4333-8333-333333333333";
const STRANGER = "44444444-4444-4444-8444-444444444444";
const SHOW = "55555555-5555-4555-8555-555555555555";
const BRAND_PROFILE = "66666666-6666-4666-8666-666666666666";
const SHOW_PROFILE = "77777777-7777-4777-8777-777777777777";
const DEAL = "88888888-8888-4888-8888-888888888888";
const OTHER_DEAL = "99999999-9999-4999-8999-999999999999";

describe("migration 099 sql", () => {
  it("is not applied live and names the grants", () => {
    expect(sql).toContain("NOT APPLIED LIVE, CHRIS MUST NAME IT.");
    expect(statements).toMatch(
      /grant select, insert, update, delete on table public\.deal_price_records to service_role;/i
    );
    expect(statements).toMatch(
      /grant select on table public\.deal_price_records to authenticated;/i
    );
    expect(statements).toMatch(/revoke all on table public\.deal_price_records from anon;/i);
    expect(statements).not.toMatch(
      /grant\s+(select,\s*)?(insert|update|delete)[^;]*on table public\.deal_price_records to (anon|authenticated|public)\b/i
    );
    expect(statements).toMatch(/for select/i);
    expect(statements).toMatch(/auth\.uid\(\)/);
    expect(statements).toMatch(/pricing_basis in \('cpm', 'flat', 'per_engaged_view'\)/);
    expect(statements).toMatch(/medium in \('podcast', 'youtube', 'social'\)/);
    expect(statements).toMatch(/deal_price_records_lock_snapshot/);
    expect(statements).toMatch(/on delete restrict/i);
    expect(statements).not.toMatch(/deals\(id\) on delete cascade/i);
    expect(statements).not.toMatch(/grant select, insert, update, delete on table public\.deal_price_records to authenticated/i);
  });
});

describe("migration 099 on PGlite", () => {
  const db = new PGlite();

  async function rollback() {
    try {
      await db.exec("rollback");
    } catch {
      // No open transaction.
    }
  }

  async function asJwt<T extends Record<string, unknown>>(uid: string, statement: string): Promise<T[]> {
    const claims = JSON.stringify({ sub: uid, role: "authenticated" });
    await db.exec("begin");
    try {
      await db.exec(`select set_config('request.jwt.claims', '${claims}', true)`);
      await db.exec("set local role authenticated");
      const result = await db.query<T>(statement);
      await db.exec("commit");
      return result.rows;
    } catch (err) {
      await rollback();
      throw err;
    }
  }

  beforeAll(async () => {
    await db.exec(`
      create schema if not exists auth;
      create or replace function auth.uid()
      returns uuid language sql stable as $$
        select nullif(
          nullif(current_setting('request.jwt.claims', true), '')::json ->> 'sub',
          ''
        )::uuid
      $$;
      do $$ begin
        if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
        if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
        if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin; end if;
      end $$;
      grant usage on schema auth to authenticated, service_role;
      grant usage on schema public to authenticated, anon, service_role;
      grant execute on function auth.uid() to authenticated, service_role;

      create table public.profiles (id uuid primary key);
      create table public.shows (id uuid primary key);
      create table public.brand_profiles (id uuid primary key, user_id uuid);
      create table public.show_profiles (id uuid primary key, user_id uuid);
      create table public.deals (
        id uuid primary key,
        brand_id uuid,
        agent_id uuid,
        agency_id uuid,
        brand_profile_id uuid,
        show_profile_id uuid,
        show_id uuid
      );
      create table public.insertion_orders (id uuid primary key);

      create or replace function update_updated_at()
      returns trigger language plpgsql as $$
      begin
        new.updated_at = now();
        return new;
      end;
      $$;

      insert into public.profiles (id) values ('${BRAND}'), ('${SHOW_USER}'), ('${AGENT}');
      insert into public.shows (id) values ('${SHOW}');
      insert into public.brand_profiles (id, user_id) values ('${BRAND_PROFILE}', '${BRAND}');
      insert into public.show_profiles (id, user_id) values ('${SHOW_PROFILE}', '${SHOW_USER}');
      insert into public.deals (id, brand_id, show_id, brand_profile_id, show_profile_id)
        values ('${DEAL}', '${BRAND}', '${SHOW}', '${BRAND_PROFILE}', '${SHOW_PROFILE}');
      insert into public.deals (id, brand_id, agent_id, show_id)
        values ('${OTHER_DEAL}', '${BRAND}', '${AGENT}', '${SHOW}');
    `);
    await db.exec(sql);
    await db.exec(`
      alter table public.deals enable row level security;
      alter table public.brand_profiles enable row level security;
      alter table public.show_profiles enable row level security;
      grant select on public.deals, public.brand_profiles, public.show_profiles to authenticated;
      create policy "Deal participants read deals" on public.deals for select to authenticated
        using (auth.uid() = agent_id or auth.uid() = brand_id or auth.uid() = agency_id);
      create policy "Brand reads own deals via brand_profile" on public.deals for select to authenticated
        using (
          brand_profile_id is not null and exists (
            select 1 from public.brand_profiles bp
            where bp.id = deals.brand_profile_id and bp.user_id = auth.uid()
          )
        );
      create policy "Show reads own deals via show_profile" on public.deals for select to authenticated
        using (
          show_profile_id is not null and exists (
            select 1 from public.show_profiles sp
            where sp.id = deals.show_profile_id and sp.user_id = auth.uid()
          )
        );
      create policy "own brand profile" on public.brand_profiles for select to authenticated
        using (user_id = auth.uid());
      create policy "own show profile" on public.show_profiles for select to authenticated
        using (user_id = auth.uid());

      insert into public.deal_price_records (deal_id, show_id, brand_id, brand_profile_id, agreed_total_gross, pricing_basis, medium)
        values ('${DEAL}', '${SHOW}', '${BRAND}', '${BRAND_PROFILE}', 1500, 'cpm', 'podcast');
      insert into public.deal_price_records (deal_id, show_id, brand_id, agreed_total_gross, pricing_basis, medium)
        values ('${OTHER_DEAL}', '${SHOW}', '${BRAND}', 800, 'flat', 'youtube');
    `);
  });

  afterAll(async () => {
    await db.close();
  });

  it("grants select to authenticated and full DML to service_role", async () => {
    for (const privilege of ["SELECT", "INSERT", "UPDATE", "DELETE"]) {
      const auth = await db.query<{ ok: boolean }>(
        `select has_table_privilege('authenticated', 'public.deal_price_records', '${privilege}') as ok`
      );
      expect(auth.rows[0]?.ok).toBe(privilege === "SELECT");
      const anon = await db.query<{ ok: boolean }>(
        `select has_table_privilege('anon', 'public.deal_price_records', '${privilege}') as ok`
      );
      expect(anon.rows[0]?.ok).toBe(false);
      const service = await db.query<{ ok: boolean }>(
        `select has_table_privilege('service_role', 'public.deal_price_records', '${privilege}') as ok`
      );
      expect(service.rows[0]?.ok).toBe(true);
    }
  });

  it("lets a deal party read and hides the row from everyone else", async () => {
    const brand = await asJwt<{ deal_id: string }>(
      BRAND,
      `select deal_id::text from public.deal_price_records order by agreed_total_gross`
    );
    expect(brand.map((row) => row.deal_id)).toEqual([OTHER_DEAL, DEAL]);

    const show = await asJwt<{ deal_id: string }>(
      SHOW_USER,
      `select deal_id::text from public.deal_price_records`
    );
    expect(show.map((row) => row.deal_id)).toEqual([DEAL]);

    const agent = await asJwt<{ deal_id: string }>(
      AGENT,
      `select deal_id::text from public.deal_price_records`
    );
    expect(agent.map((row) => row.deal_id)).toEqual([OTHER_DEAL]);

    const stranger = await asJwt<{ deal_id: string }>(
      STRANGER,
      `select deal_id::text from public.deal_price_records`
    );
    expect(stranger).toEqual([]);
  });

  it("refuses an authenticated insert", async () => {
    await expect(
      asJwt(
        BRAND,
        `insert into public.deal_price_records (deal_id) values ('${DEAL}')`
      )
    ).rejects.toThrow(/permission denied|42501/i);
  });

  it("locks snapshot columns and still allows outcome and rebook updates", async () => {
    await expect(
      db.exec(
        `update public.deal_price_records set agreed_total_gross = 1 where deal_id = '${DEAL}'`
      )
    ).rejects.toThrow(/deal_price_record_snapshot_locked|42501/i);

    await db.exec(
      `update public.deal_price_records
          set delivered_units = 2,
              outcome_status = 'delivering',
              rebooked = true
        where deal_id = '${DEAL}'`
    );
    const row = await db.query<{
      delivered_units: number;
      outcome_status: string;
      agreed_total_gross: string;
      rebooked: boolean;
    }>(
      `select delivered_units, outcome_status, agreed_total_gross::text, rebooked
         from public.deal_price_records where deal_id = '${DEAL}'`
    );
    expect(row.rows[0]).toMatchObject({
      delivered_units: 2,
      outcome_status: "delivering",
      agreed_total_gross: "1500.00",
      rebooked: true,
    });
  });

  it("lets a null signed IO url become a value and then locks it", async () => {
    await db.exec(
      `update public.deal_price_records
          set signed_io_pdf_url = 'deals/x/signed-io.pdf'
        where deal_id = '${DEAL}'`
    );
    const filled = await db.query<{ signed_io_pdf_url: string }>(
      `select signed_io_pdf_url from public.deal_price_records where deal_id = '${DEAL}'`
    );
    expect(filled.rows[0]?.signed_io_pdf_url).toBe("deals/x/signed-io.pdf");
    await expect(
      db.exec(
        `update public.deal_price_records
            set signed_io_pdf_url = 'deals/x/other.pdf'
          where deal_id = '${DEAL}'`
      )
    ).rejects.toThrow(/deal_price_record_snapshot_locked|42501/i);
    await expect(
      db.exec(
        `update public.deal_price_records
            set signed_io_pdf_url = null
          where deal_id = '${DEAL}'`
      )
    ).rejects.toThrow(/deal_price_record_snapshot_locked|42501/i);
  });

  it("refuses to delete a deal that has a price record", async () => {
    await expect(db.exec(`delete from public.deals where id = '${DEAL}'`)).rejects.toThrow(
      /foreign key|restrict|23503/i
    );
  });
});
