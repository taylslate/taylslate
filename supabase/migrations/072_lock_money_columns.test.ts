// Migration 072. Runs in PGlite. Never uses a hosted database.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const sql = readFileSync(join(__dirname, "072_lock_money_columns.sql"), "utf8");

const OWNER = "11111111-1111-4111-8111-111111111111";
const ENSURED = "22222222-2222-4222-8222-222222222222";
const AGENT_ROW = "33333333-3333-4333-8333-333333333333";
const PRO_ROW = "44444444-4444-4444-8444-444444444444";

const LOCKED: Array<[string, string]> = [
  ["platform_fee_percentage", "0"],
  ["plan", "'operator'"],
  ["subscription_status", "'active'"],
  ["stripe_customer_id", "'cus_x'"],
  ["stripe_subscription_id", "'sub_x'"],
  ["stripe_connect_account_id", "'acct_x'"],
  ["role", "'agent'"],
  ["tier", "'starter'"],
  ["seat_count", "9"],
  ["campaigns_this_month", "4"],
];

const fixture = `
create role authenticated nologin;
create role anon nologin;
create role service_role nologin bypassrls;

create schema if not exists auth;
create or replace function auth.role()
returns text
language sql
stable
as $$
  select case
    when nullif(current_setting('request.jwt.claims', true), '') is null then null
    else nullif(current_setting('request.jwt.claims', true), '')::json ->> 'role'
  end
$$;
grant usage on schema auth to authenticated, service_role;
grant execute on function auth.role() to authenticated, service_role;

create table public.profiles (
  id uuid primary key,
  email text not null,
  full_name text,
  role text not null,
  tier text not null default 'free',
  stripe_customer_id text,
  stripe_subscription_id text,
  stripe_connect_account_id text,
  campaigns_this_month integer not null default 0,
  plan text not null default 'pay_as_you_go',
  platform_fee_percentage numeric(5, 4) not null default 0.10,
  seat_count integer not null default 1,
  subscription_status text not null default 'none'
);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid,
  status text,
  stripe_payment_intent_id text
);

grant select, insert, update, delete on public.profiles to authenticated;
grant select, insert, update, delete, truncate, references, trigger on public.payments to authenticated;
grant select, insert, update, delete, truncate, references, trigger on public.payments to anon;
grant all on public.payments to public;
grant select, insert, update, delete on public.profiles to service_role;
grant select, insert, update, delete on public.payments to service_role;

alter table public.profiles enable row level security;
alter table public.payments enable row level security;

create policy "Users read own profile" on public.profiles
  for select to authenticated using (true);
create policy "Users insert own profile" on public.profiles
  for insert to authenticated with check (true);
create policy "Users update own profile" on public.profiles
  for update to authenticated using (true) with check (true);

create policy "Payments access via deal" on public.payments
  for select to authenticated using (true);
create policy "Payments insert via deal" on public.payments
  for insert to authenticated with check (true);
create policy "Payments update via deal" on public.payments
  for update to authenticated using (true) with check (true);
`;

describe("migration 072", () => {
  const db = new PGlite();

  beforeAll(async () => {
    await db.exec(fixture);
    await db.exec(sql);
    await db.exec(sql);
    await db.exec(`
      insert into public.profiles (id, email, full_name, role, tier)
      values ('${OWNER}', 'owner@example.com', 'Owner', 'brand', 'free');
      insert into public.payments (id, status, stripe_payment_intent_id)
      values ('${OWNER}', 'pending', 'pi_existing');
    `);
  });

  afterAll(async () => {
    await db.close();
  });

  async function asRole(role: string, statement: string) {
    await db.exec(`set role ${role}`);
    try {
      return await db.query(statement);
    } finally {
      await db.exec("reset role");
    }
  }

  it("leaves authenticated with select only on payments", async () => {
    const grants = await db.query<{ privilege_type: string }>(`
      select privilege_type
        from information_schema.role_table_grants
       where table_schema = 'public'
         and table_name = 'payments'
         and grantee = 'authenticated'
       order by privilege_type
    `);
    expect(grants.rows.map((row) => row.privilege_type)).toEqual(["SELECT"]);

    const anon = await db.query<{ grantee: string }>(`
      select grantee
        from information_schema.role_table_grants
       where table_schema = 'public'
         and table_name = 'payments'
         and grantee in ('anon', 'PUBLIC')
    `);
    expect(anon.rows).toEqual([]);

    const policies = await db.query<{ polname: string; polcmd: string }>(`
      select polname, polcmd
        from pg_policy
       where polrelid = 'public.payments'::regclass
       order by polname
    `);
    expect(policies.rows).toEqual([
      { polname: "Payments access via deal", polcmd: "r" },
    ]);

    const trigger = await db.query<{ tgname: string }>(`
      select tgname from pg_trigger
       where tgname = 'profiles_protect_money_columns'
         and not tgisinternal
    `);
    expect(trigger.rows).toHaveLength(1);
  });

  it("blocks an authenticated payments insert and update", async () => {
    await expect(
      asRole(
        "authenticated",
        `insert into public.payments (status, stripe_payment_intent_id)
         values ('pending', 'pi_fake')`,
      ),
    ).rejects.toThrow(/permission denied/i);

    await expect(
      asRole(
        "authenticated",
        `update public.payments set status = 'succeeded' where id = '${OWNER}'`,
      ),
    ).rejects.toThrow(/permission denied/i);

    const visible = await asRole(
      "authenticated",
      `select status from public.payments where id = '${OWNER}'`,
    );
    expect(visible.rows).toEqual([{ status: "pending" }]);
  });

  it("blocks each locked profiles column and still allows full_name", async () => {
    await asRole(
      "authenticated",
      `update public.profiles set full_name = 'Renamed' where id = '${OWNER}'`,
    );
    const renamed = await db.query<{ full_name: string }>(
      `select full_name from public.profiles where id = '${OWNER}'`,
    );
    expect(renamed.rows[0]?.full_name).toBe("Renamed");

    for (const [column, value] of LOCKED) {
      await expect(
        asRole(
          "authenticated",
          `update public.profiles set ${column} = ${value} where id = '${OWNER}'`,
        ),
      ).rejects.toThrow(/locked profile column rejected|permission denied/i);
    }

    const row = await db.query<{
      platform_fee_percentage: string;
      plan: string;
      role: string;
      tier: string;
    }>(`
      select platform_fee_percentage::text, plan, role, tier
        from public.profiles
       where id = '${OWNER}'
    `);
    expect(row.rows[0]).toMatchObject({
      plan: "pay_as_you_go",
      role: "brand",
      tier: "free",
    });
    expect(Number(row.rows[0]?.platform_fee_percentage)).toBeCloseTo(0.1);
  });

  it("lets service_role change the fee", async () => {
    await asRole(
      "service_role",
      `update public.profiles set platform_fee_percentage = 0.06 where id = '${OWNER}'`,
    );
    const row = await db.query<{ platform_fee_percentage: string }>(
      `select platform_fee_percentage::text from public.profiles where id = '${OWNER}'`,
    );
    expect(Number(row.rows[0]?.platform_fee_percentage)).toBeCloseTo(0.06);
  });

  it("accepts the ensureProfile insert and rejects tier pro or role agent", async () => {
    await asRole(
      "authenticated",
      `insert into public.profiles (id, email, full_name, role, tier)
       values ('${ENSURED}', 'ensured@example.com', '', 'brand', 'free')`,
    );
    const ensured = await db.query<{
      role: string;
      tier: string;
      plan: string;
      platform_fee_percentage: string;
      subscription_status: string;
      seat_count: number;
      campaigns_this_month: number;
      stripe_customer_id: string | null;
    }>(`
      select role, tier, plan, platform_fee_percentage::text,
             subscription_status, seat_count, campaigns_this_month,
             stripe_customer_id
        from public.profiles
       where id = '${ENSURED}'
    `);
    expect(ensured.rows[0]).toMatchObject({
      role: "brand",
      tier: "free",
      plan: "pay_as_you_go",
      subscription_status: "none",
      seat_count: 1,
      campaigns_this_month: 0,
      stripe_customer_id: null,
    });
    expect(Number(ensured.rows[0]?.platform_fee_percentage)).toBeCloseTo(0.1);

    await expect(
      asRole(
        "authenticated",
        `insert into public.profiles (id, email, full_name, role, tier)
         values ('${AGENT_ROW}', 'agent@example.com', '', 'agent', 'free')`,
      ),
    ).rejects.toThrow(/profile insert rejected/);

    await expect(
      asRole(
        "authenticated",
        `insert into public.profiles (id, email, full_name, role, tier)
         values ('${PRO_ROW}', 'pro@example.com', '', 'brand', 'pro')`,
      ),
    ).rejects.toThrow(/profile insert rejected/);
  });
});
