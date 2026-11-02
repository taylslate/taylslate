// Migration 079. Runs in PGlite. Never uses a hosted database.
// A profiles.email copy does not grant another account's aircheck.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const sql = readFileSync(join(__dirname, "079_airchecks_automated.sql"), "utf8");

const BRAND = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const SHOW_USER = "33333333-3333-4333-8333-333333333333";
const ATTACKER = "44444444-4444-4444-8444-444444444444";
const OWNER = "55555555-5555-4555-8555-555555555555";
const AGENCY = "66666666-6666-4666-8666-666666666666";
const SHOW = "77777777-7777-4777-8777-777777777777";
const OWNER_SHOW = "88888888-8888-4888-8888-888888888888";
const DEAL = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const OWNER_DEAL = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";
const IO = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1";
const OWNER_IO = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2";
const LINE = "cccccccc-cccc-4ccc-8ccc-ccccccccccc1";
const OWNER_LINE = "cccccccc-cccc-4ccc-8ccc-ccccccccccc2";
const SHOW_PROFILE = "dddddddd-dddd-4ddd-8ddd-ddddddddddd1";
const OWNER_PROFILE = "dddddddd-dddd-4ddd-8ddd-ddddddddddd2";
const BRAND_PROFILE = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1";

const fixture = `
create role authenticated nologin;
create role anon nologin;
create role service_role nologin bypassrls;

create schema if not exists auth;
create table auth.users (
  id uuid primary key,
  email text
);
insert into auth.users (id, email) values
  ('${BRAND}', 'brand@example.test'),
  ('${OTHER}', 'other@example.test'),
  ('${SHOW_USER}', 'show@example.test'),
  ('${ATTACKER}', 'attacker@example.test'),
  ('${OWNER}', 'owner@show.test'),
  ('${AGENCY}', 'agency@example.test');

create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claims', true)::json ->> 'sub', '')::uuid
$$;
grant usage on schema auth to authenticated, service_role, anon;
grant execute on function auth.uid() to authenticated, service_role;

create or replace function public.auth_login_email()
returns text
language sql
stable
security definer
set search_path = auth, public, pg_temp
as $$
  select nullif(lower(btrim(email)), '')
  from auth.users
  where id = (select auth.uid());
$$;
grant execute on function public.auth_login_email() to authenticated, service_role;

create table public.profiles (
  id uuid primary key,
  email text not null
);
insert into public.profiles (id, email) values
  ('${ATTACKER}', 'owner@show.test'),
  ('${OWNER}', 'someone-else@example.test');

create table public.shows (
  id uuid primary key,
  contact_email text,
  data_sources text[] default '{}'
);
insert into public.shows (id, contact_email, data_sources) values
  ('${SHOW}', 'show@example.test', '{}'),
  ('${OWNER_SHOW}', 'owner@show.test', '{show_owner}');

create table public.show_profiles (
  id uuid primary key,
  user_id uuid
);
insert into public.show_profiles (id, user_id) values
  ('${SHOW_PROFILE}', '${SHOW_USER}'),
  ('${OWNER_PROFILE}', '${OWNER}');

create table public.brand_profiles (
  id uuid primary key,
  user_id uuid
);
insert into public.brand_profiles (id, user_id) values ('${BRAND_PROFILE}', '${BRAND}');

create table public.deals (
  id uuid primary key,
  show_id uuid,
  brand_id uuid,
  agency_id uuid,
  brand_profile_id uuid,
  show_profile_id uuid
);
insert into public.deals (id, show_id, brand_id, agency_id, brand_profile_id, show_profile_id) values
  ('${DEAL}', '${SHOW}', '${BRAND}', '${AGENCY}', '${BRAND_PROFILE}', '${SHOW_PROFILE}'),
  ('${OWNER_DEAL}', '${OWNER_SHOW}', null, null, null, null);

create table public.insertion_orders (
  id uuid primary key,
  deal_id uuid
);
insert into public.insertion_orders (id, deal_id) values
  ('${IO}', '${DEAL}'),
  ('${OWNER_IO}', '${OWNER_DEAL}');

create table public.io_line_items (
  id uuid primary key,
  io_id uuid
);
insert into public.io_line_items (id, io_id) values
  ('${LINE}', '${IO}'),
  ('${OWNER_LINE}', '${OWNER_IO}');

create table public.airchecks (
  id uuid primary key default gen_random_uuid(),
  io_line_item_id uuid not null unique,
  status text not null default 'pending',
  transcript_text text
);
alter table public.airchecks
  add constraint airchecks_status_check
  check (status in ('pending', 'transcribed', 'failed'));

grant select on public.io_line_items to authenticated, service_role;
grant select on public.insertion_orders to authenticated, service_role;
grant select on public.deals to authenticated, service_role;
grant select on public.shows to authenticated, service_role;
grant select on public.show_profiles to authenticated, service_role;
grant select on public.brand_profiles to authenticated, service_role;
`;

describe("migration 079", () => {
  const db = new PGlite();

  beforeAll(async () => {
    await db.exec(fixture);
    await db.exec(sql);
    await db.exec(sql);
    await db.exec(`
      insert into public.airchecks (io_line_item_id, status, transcript_text, ready_for_review, confidence)
      values
        ('${LINE}', 'transcribed', 'brand read', true, 0.8),
        ('${OWNER_LINE}', 'transcribed', 'owner read', true, 0.5);
    `);
  });

  afterAll(async () => {
    await db.close();
  });

  async function asRole(role: string, userId: string): Promise<{ id: string }[]> {
    await db.exec(
      `select set_config('request.jwt.claims', '{"sub":"${userId}","role":"${role}"}', false)`
    );
    await db.exec(`set role ${role}`);
    try {
      const result = await db.query<{ id: string }>(
        "select io_line_item_id::text as id from public.airchecks order by io_line_item_id"
      );
      return result.rows;
    } finally {
      await db.exec("reset role");
    }
  }

  it("is written and not applied, and does not read profiles.email", () => {
    expect(sql).toMatch(/NOT applied/);
    expect(sql).toMatch(/after merge and Chris's OK/);
    expect(sql).not.toMatch(/profiles\.email/);
    expect(sql).toMatch(/auth\.uid\(\)/);
    expect(sql).toMatch(/auth_login_email\(\)/);
    expect(sql).not.toContain("\u2014");
  });

  it("lets the brand, the agency, and the show read their deal and hides the other brand", async () => {
    const brand = await asRole("authenticated", BRAND);
    expect(brand.map((row) => row.id)).toEqual([LINE]);

    const agency = await asRole("authenticated", AGENCY);
    expect(agency.map((row) => row.id)).toEqual([LINE]);

    const show = await asRole("authenticated", SHOW_USER);
    expect(show.map((row) => row.id)).toEqual([LINE]);

    const other = await asRole("authenticated", OTHER);
    expect(other).toEqual([]);
  });

  it("lets the show owner in through the auth login and ignores profiles.email", async () => {
    const owner = await asRole("authenticated", OWNER);
    expect(owner.map((row) => row.id)).toEqual([OWNER_LINE]);

    const attacker = await asRole("authenticated", ATTACKER);
    expect(attacker).toEqual([]);
  });

  it("blocks anon reads and authenticated writes, and lets service_role read", async () => {
    await expect(db.exec("set role anon; select 1 from public.airchecks")).rejects.toThrow();
    await db.exec("reset role");

    await db.exec(
      `select set_config('request.jwt.claims', '{"sub":"${BRAND}","role":"authenticated"}', false)`
    );
    await expect(
      db.exec(
        `set role authenticated; insert into public.airchecks (io_line_item_id, status) values ('${LINE}', 'pending')`
      )
    ).rejects.toThrow();
    await db.exec("reset role");

    const all = await asRole("service_role", BRAND);
    expect(all).toHaveLength(2);
  });

  it("rejects a review flag on a row that is not transcribed", async () => {
    await expect(
      db.exec(`
        insert into public.airchecks (io_line_item_id, status, ready_for_review)
        values ('99999999-9999-4999-8999-999999999999', 'failed', true)
      `)
    ).rejects.toThrow(/airchecks_ready_for_review_check/);
  });
});
