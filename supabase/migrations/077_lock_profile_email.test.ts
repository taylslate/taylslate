// Migration 077. Runs in PGlite. Never uses a hosted database.
// A profiles.email copied from the victim does not grant the victim's show.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const sql = readFileSync(join(__dirname, "077_lock_profile_email.sql"), "utf8");

const ATTACKER = "11111111-1111-4111-8111-111111111111";
const VICTIM = "22222222-2222-4222-8222-222222222222";
const SHOW = "33333333-3333-4333-8333-333333333333";
const OUTREACH = "44444444-4444-4444-8444-444444444444";

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
  ('${ATTACKER}', 'attacker@example.test'),
  ('${VICTIM}', 'victim@show.test');

create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claims', true)::json ->> 'sub', '')::uuid
$$;
grant usage on schema auth to authenticated, service_role;
grant execute on function auth.uid() to authenticated, service_role;

create table public.profiles (
  id uuid primary key,
  email text not null,
  full_name text,
  role text not null,
  tier text not null default 'free'
);
create table public.shows (
  id uuid primary key,
  name text,
  platform text,
  is_discoverable boolean not null default false,
  agent_id uuid,
  contact_email text,
  data_sources text[] default '{}',
  podscan_id text
);
create table public.show_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,
  show_name text,
  podscan_id text
);
create table public.deals (
  id uuid primary key default gen_random_uuid(),
  show_id uuid,
  show_profile_id uuid,
  brand_id uuid,
  agency_id uuid,
  agent_id uuid
);
create table public.agent_show_relationships (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid,
  show_id uuid,
  status text
);
create table public.outreaches (
  id uuid primary key,
  sent_to_email text not null,
  brand_profile_id uuid
);

grant select, insert, update, delete on public.profiles to authenticated;
grant select on public.shows to authenticated;
grant select on public.show_profiles to authenticated;
grant select on public.deals to authenticated;
grant select on public.agent_show_relationships to authenticated;
grant select on public.outreaches to authenticated;
grant select, insert, update, delete on public.show_profiles to authenticated;
grant select, insert, update, delete on public.profiles to service_role;

alter table public.profiles enable row level security;
alter table public.shows enable row level security;
alter table public.outreaches enable row level security;
alter table public.show_profiles enable row level security;

create policy "Users update own profile" on public.profiles
  for all to authenticated using (true) with check (true);
create policy "Show profiles open" on public.show_profiles
  for all to authenticated using (true) with check (true);

insert into public.shows (id, name, platform, is_discoverable, contact_email, data_sources, podscan_id)
values (
  '${SHOW}', 'Owner Desk', 'podcast', false, 'victim@show.test', '{show_owner}', 'pd_owner'
);
insert into public.outreaches (id, sent_to_email)
values ('${OUTREACH}', 'victim@show.test');
`;

describe("migration 077", () => {
  const db = new PGlite();

  beforeAll(async () => {
    await db.exec(fixture);
    await db.exec(sql);
    await db.exec(sql);
  });

  afterAll(async () => {
    await db.close();
  });

  async function asRole(role: string, userId: string, statement: string) {
    await db.exec(`select set_config('request.jwt.claims', '{"sub":"${userId}","role":"${role}"}', false)`);
    await db.exec(`set role ${role}`);
    try {
      return await db.query(statement);
    } finally {
      await db.exec("reset role");
    }
  }

  it("stores the auth login and rejects a direct email change", async () => {
    await asRole(
      "authenticated",
      ATTACKER,
      `insert into public.profiles (id, email, full_name, role)
       values ('${ATTACKER}', 'victim@show.test', 'Attacker', 'show')`,
    );
    const inserted = await db.query<{ email: string }>(
      `select email from public.profiles where id = '${ATTACKER}'`,
    );
    expect(inserted.rows[0]?.email).toBe("attacker@example.test");

    await asRole(
      "authenticated",
      ATTACKER,
      `update public.profiles set email = 'victim@show.test' where id = '${ATTACKER}'`,
    );
    const locked = await db.query<{ email: string }>(
      `select email from public.profiles where id = '${ATTACKER}'`,
    );
    expect(locked.rows[0]?.email).toBe("attacker@example.test");

    await asRole(
      "authenticated",
      ATTACKER,
      `update public.profiles set full_name = 'Renamed' where id = '${ATTACKER}'`,
    );
    const renamed = await db.query<{ email: string; full_name: string }>(
      `select email, full_name from public.profiles where id = '${ATTACKER}'`,
    );
    expect(renamed.rows[0]).toEqual({
      email: "attacker@example.test",
      full_name: "Renamed",
    });
  });

  it("denies show ownership, outreach, and the hidden show when profiles.email is the victim", async () => {
    await db.exec(`
      alter table public.profiles disable trigger profiles_sync_email_from_auth;
      update public.profiles set email = 'victim@show.test' where id = '${ATTACKER}';
      insert into public.profiles (id, email, full_name, role)
      values ('${VICTIM}', 'other@show.test', 'Victim', 'show');
      insert into public.show_profiles (user_id, show_name)
      values ('${ATTACKER}', 'Spoof'), ('${VICTIM}', 'Owner');
      alter table public.profiles enable trigger profiles_sync_email_from_auth;
    `);

    const attackerOwns = await asRole(
      "authenticated",
      ATTACKER,
      `select public.user_owns_show('${SHOW}') as owns`,
    );
    expect(attackerOwns.rows[0]).toEqual({ owns: false });

    const victimOwns = await asRole(
      "authenticated",
      VICTIM,
      `select public.user_owns_show('${SHOW}') as owns`,
    );
    expect(victimOwns.rows[0]).toEqual({ owns: true });

    const attackerMail = await asRole(
      "authenticated",
      ATTACKER,
      `select id::text from public.outreaches where id = '${OUTREACH}'`,
    );
    expect(attackerMail.rows).toEqual([]);

    const victimMail = await asRole(
      "authenticated",
      VICTIM,
      `select id::text from public.outreaches where id = '${OUTREACH}'`,
    );
    expect(victimMail.rows).toEqual([{ id: OUTREACH }]);

    const attackerShow = await asRole(
      "authenticated",
      ATTACKER,
      `select id::text from public.shows where id = '${SHOW}'`,
    );
    expect(attackerShow.rows).toEqual([]);

    const victimShow = await asRole(
      "authenticated",
      VICTIM,
      `select id::text from public.shows where id = '${SHOW}'`,
    );
    expect(victimShow.rows).toEqual([{ id: SHOW }]);
  });

  it("drops a podscan id claimed through a copied profiles.email", async () => {
    const spoofed = await asRole(
      "authenticated",
      ATTACKER,
      `insert into public.show_profiles (user_id, show_name, podscan_id)
       values ('${ATTACKER}', 'Spoof pod', 'pd_owner')
       returning podscan_id`,
    );
    expect(spoofed.rows[0]).toEqual({ podscan_id: null });

    const owned = await asRole(
      "authenticated",
      VICTIM,
      `insert into public.show_profiles (user_id, show_name, podscan_id)
       values ('${VICTIM}', 'Real pod', 'pd_owner')
       returning podscan_id`,
    );
    expect(owned.rows[0]).toEqual({ podscan_id: "pd_owner" });
  });

  it("overwrites service_role, follows an auth email change, and rejects a profile with no login", async () => {
    const moved = "55555555-5555-4555-8555-555555555555";
    const blank = "66666666-6666-4666-8666-666666666666";
    const orphan = "77777777-7777-4777-8777-777777777777";
    await db.exec(`
      insert into auth.users (id, email) values
        ('${moved}', 'start@example.test'),
        ('${blank}', null);
    `);

    await asRole(
      "service_role",
      moved,
      `insert into public.profiles (id, email, full_name, role)
       values ('${moved}', 'victim@show.test', 'Moved', 'show')`,
    );
    const inserted = await db.query<{ email: string }>(
      `select email from public.profiles where id = '${moved}'`,
    );
    expect(inserted.rows[0]?.email).toBe("start@example.test");

    await asRole(
      "service_role",
      moved,
      `update public.profiles set email = 'victim@show.test' where id = '${moved}'`,
    );
    const rewritten = await db.query<{ email: string }>(
      `select email from public.profiles where id = '${moved}'`,
    );
    expect(rewritten.rows[0]?.email).toBe("start@example.test");

    await db.exec(`update auth.users set email = 'moved@example.test' where id = '${moved}'`);
    const synced = await db.query<{ email: string }>(
      `select email from public.profiles where id = '${moved}'`,
    );
    expect(synced.rows[0]?.email).toBe("moved@example.test");

    await expect(
      db.query(
        `insert into public.profiles (id, email, full_name, role)
         values ('${blank}', 'blank@example.test', 'Blank', 'show')`,
      ),
    ).rejects.toThrow(/42501|profile email must match the login email/i);

    await expect(
      db.query(
        `insert into public.profiles (id, email, full_name, role)
         values ('${orphan}', 'orphan@example.test', 'Orphan', 'show')`,
      ),
    ).rejects.toThrow(/42501|profile email must match the login email/i);

    const execute = await db.query<{ authenticated: boolean; service_role: boolean }>(`
      select
        has_function_privilege('authenticated', 'public.sync_profiles_email_from_auth()', 'execute') as authenticated,
        has_function_privilege('service_role', 'public.sync_profiles_email_from_auth()', 'execute') as service_role
    `);
    expect(execute.rows[0]).toEqual({ authenticated: false, service_role: false });

    const directory = await db.query<{ anon: boolean; authenticated: boolean }>(`
      select
        has_function_privilege('anon', 'public.auth_user_ids_for_email(text)', 'execute') as anon,
        has_function_privilege('authenticated', 'public.auth_user_ids_for_email(text)', 'execute') as authenticated
    `);
    expect(directory.rows[0]).toEqual({ anon: false, authenticated: false });
  });
});
