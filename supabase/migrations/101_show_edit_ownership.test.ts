// Migration 101. Runs in PGlite. Never uses a hosted database.
// A brand-typed deal profile does not make user_owns_show true.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const sql = readFileSync(join(__dirname, "101_show_edit_ownership.sql"), "utf8");
const statements = sql
  .split("\n")
  .filter((line) => !line.trim().startsWith("--"))
  .join("\n");

const OWNER = "11111111-1111-4111-8111-111111111111";
const ATTACKER = "22222222-2222-4222-8222-222222222222";
const SHOW = "33333333-3333-4333-8333-333333333333";
const SPOOF = "44444444-4444-4444-8444-444444444444";
const CATALOG = "55555555-5555-4555-8555-555555555555";
const PROOF_SHOW = "66666666-6666-4666-8666-666666666666";
const PROFILE_OWNER = "77777777-7777-4777-8777-777777777777";
const PROFILE_ATTACKER = "88888888-8888-4888-8888-888888888888";
const DEAL = "99999999-9999-4999-8999-999999999999";
const OUTREACH = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const fixture = `
create role authenticated nologin;
create role anon nologin;
create role service_role nologin bypassrls;

create schema if not exists auth;
create table auth.users (
  id uuid primary key,
  email text,
  email_confirmed_at timestamptz
);

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
  email text,
  role text
);
create table public.shows (
  id uuid primary key,
  contact_email text,
  data_sources text[] default '{}',
  slug text,
  is_discoverable boolean not null default false
);
create table public.show_profiles (
  id uuid primary key,
  user_id uuid
);
create table public.deals (
  id uuid primary key,
  show_id uuid,
  show_profile_id uuid,
  outreach_id uuid,
  status text,
  show_signed_at timestamptz
);
create table public.outreaches (
  id uuid primary key,
  sent_to_email text,
  response_status text
);
create table public.show_contacts (
  show_id uuid,
  email text,
  source text
);
create table public.domain_events (
  id uuid primary key default gen_random_uuid(),
  event_type text,
  entity_type text,
  entity_id uuid,
  actor_id uuid
);
create table public.show_ownership_proofs (
  id uuid primary key default gen_random_uuid(),
  show_id uuid,
  user_id uuid,
  status text
);
create table public.show_surfaces (
  id uuid primary key default gen_random_uuid(),
  show_id uuid not null,
  owner_user_id uuid not null,
  type text not null,
  posting_owner text not null default 'creator'
);

grant select, insert, update, delete on public.show_surfaces to authenticated;
alter table public.show_surfaces enable row level security;
`;

describe("migration 101 show edit ownership", () => {
  it("is named for Chris and is not applied from the app", () => {
    expect(sql).toContain("NOT APPLIED LIVE, CHRIS MUST NAME IT");
    expect(sql).toContain("Do not run this from the app");
  });

  it("keeps user_owns_show invoker and locks search_path", () => {
    expect(statements).toMatch(
      /create or replace function public\.user_owns_show\(target_show uuid\)[\s\S]*security invoker[\s\S]*set search_path = ''/i
    );
    expect(statements).toMatch(
      /create or replace function private\.show_edit_grant\(target_show uuid\)[\s\S]*security definer[\s\S]*set search_path = ''/i
    );
    expect(statements).not.toMatch(/profiles\.email/i);
    expect(statements).not.toMatch(/grant execute on function public\.user_owns_show\(uuid\) to anon/i);
    expect(statements).not.toMatch(/grant execute on function private\.show_edit_grant\(uuid\) to anon/i);
    expect(statements).toMatch(/grant execute on function public\.user_owns_show\(uuid\) to authenticated/i);
    expect(statements).toMatch(/grant execute on function public\.user_owns_show\(uuid\) to service_role/i);
    expect(statements).toMatch(/revoke all on function public\.user_owns_show\(uuid\) from public/i);
    expect(statements).toMatch(/revoke all on function public\.user_owns_show\(uuid\) from anon/i);
  });

  it("does not treat a deal profile id or a podscan id as ownership", () => {
    expect(statements).toMatch(/show_contacts/i);
    expect(statements).toMatch(/source in \('podscan', 'apple_rss'\)/i);
    expect(statements).toMatch(/email_confirmed_at is not null/i);
    expect(statements).toMatch(/lower\('owner-' \|\| sp\.user_id::text\)/i);
    expect(statements).toMatch(/p\.status = 'verified'/i);
    expect(statements).toMatch(/p\.user_id = \(select auth\.uid\(\)\)/i);
    expect(statements).not.toMatch(/podscan_id/i);
    expect(statements).not.toMatch(/\bcreate table\b/i);
  });
});

describe("migration 101 on PGlite", () => {
  const db = new PGlite();

  beforeAll(async () => {
    await db.exec(fixture);
    await db.exec(sql);
    await db.exec(sql);
    await db.exec(`
      drop policy if exists "Show owner manages own surfaces" on public.show_surfaces;
      create policy "Show owner manages own surfaces"
        on public.show_surfaces
        for all
        to authenticated
        using (owner_user_id = auth.uid())
        with check (
          owner_user_id = auth.uid()
          and public.user_owns_show(show_id)
        );

      insert into auth.users (id, email, email_confirmed_at) values
        ('${OWNER}', 'host@show.test', '2026-01-01'),
        ('${ATTACKER}', 'second@brand.test', null);
      insert into public.profiles (id, email, role) values
        ('${OWNER}', 'someone-else@example.test', 'show'),
        ('${ATTACKER}', 'host@show.test', 'show');
      insert into public.show_profiles (id, user_id) values
        ('${PROFILE_OWNER}', '${OWNER}'),
        ('${PROFILE_ATTACKER}', '${ATTACKER}');
      insert into public.shows (id, contact_email, data_sources, slug) values
        ('${SHOW}', 'Host@Show.test', '{show_owner}', 'owner-${OWNER}'),
        ('${SPOOF}', 'Host@Show.test', '{show_owner}', 'odd-lots'),
        ('${CATALOG}', 'real-host@show.test', '{podscan}', 'real-show'),
        ('${PROOF_SHOW}', 'real-host@show.test', '{podscan}', 'proved-show');
      insert into public.deals (id, show_id, show_profile_id, outreach_id, status, show_signed_at)
      values (
        '${DEAL}', '${CATALOG}', '${PROFILE_ATTACKER}', '${OUTREACH}', 'show_signed', '2026-04-01'
      );
      insert into public.outreaches (id, sent_to_email, response_status)
      values ('${OUTREACH}', 'second@brand.test', 'accepted');
      insert into public.domain_events (event_type, entity_type, entity_id, actor_id)
      values ('deal.created', 'deal', '${DEAL}', null);
    `);
  });

  afterAll(async () => {
    await db.close();
  });

  async function asRole(role: string, userId: string, statement: string) {
    await db.exec(
      `select set_config('request.jwt.claims', '{"sub":"${userId}","role":"${role}"}', false)`
    );
    await db.exec(`set role ${role}`);
    try {
      return await db.query<{ owns?: boolean; id?: string }>(statement);
    } finally {
      await db.exec("reset role");
    }
  }

  it("pins search_path and keeps the invoker flag on user_owns_show", async () => {
    const rows = await db.query<{ proname: string; prosecdef: boolean; proconfig: string[] | null }>(`
      select p.proname, p.prosecdef, p.proconfig
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
       where (n.nspname = 'public' and p.proname = 'user_owns_show')
          or (n.nspname = 'private' and p.proname = 'show_edit_grant')
       order by p.proname
    `);
    const byName = new Map(rows.rows.map((row) => [row.proname, row]));
    expect(byName.get("show_edit_grant")?.prosecdef).toBe(true);
    expect(byName.get("user_owns_show")?.prosecdef).toBe(false);
    expect(byName.get("show_edit_grant")?.proconfig?.join(" ")).toContain('search_path=""');
    expect(byName.get("user_owns_show")?.proconfig?.join(" ")).toContain('search_path=""');
  });

  it("lets the confirmed owner edit and rejects the slug spoof and the unconfirmed login", async () => {
    const owner = await asRole("authenticated", OWNER, `select public.user_owns_show('${SHOW}') as owns`);
    expect(owner.rows[0]).toEqual({ owns: true });

    const spoof = await asRole("authenticated", OWNER, `select public.user_owns_show('${SPOOF}') as owns`);
    expect(spoof.rows[0]).toEqual({ owns: false });

    const attackerSlug = await asRole(
      "authenticated",
      ATTACKER,
      `select public.user_owns_show('${SHOW}') as owns`
    );
    expect(attackerSlug.rows[0]).toEqual({ owns: false });

    await db.exec(`update auth.users set email_confirmed_at = null where id = '${OWNER}'`);
    const unconfirmed = await asRole(
      "authenticated",
      OWNER,
      `select public.user_owns_show('${SHOW}') as owns`
    );
    expect(unconfirmed.rows[0]).toEqual({ owns: false });
    await db.exec(`update auth.users set email_confirmed_at = '2026-01-01' where id = '${OWNER}'`);
  });

  it("does not grant the brand's second account after it accepts", async () => {
    const forged = await asRole(
      "authenticated",
      ATTACKER,
      `select public.user_owns_show('${CATALOG}') as owns`
    );
    expect(forged.rows[0]).toEqual({ owns: false });

    await db.exec(`
      update auth.users
         set email_confirmed_at = '2026-01-01'
       where id = '${ATTACKER}';
      insert into public.show_contacts (show_id, email, source)
      values ('${CATALOG}', 'second@brand.test', 'podscan');
    `);
    const sourcedWithoutActor = await asRole(
      "authenticated",
      ATTACKER,
      `select public.user_owns_show('${CATALOG}') as owns`
    );
    expect(sourcedWithoutActor.rows[0]).toEqual({ owns: false });
  });

  it("grants a verified proof only to the user id stored on it", async () => {
    await db.exec(`
      insert into public.show_ownership_proofs (show_id, user_id, status)
      values ('${PROOF_SHOW}', '${OWNER}', 'verified');
    `);
    const owner = await asRole(
      "authenticated",
      OWNER,
      `select public.user_owns_show('${PROOF_SHOW}') as owns`
    );
    expect(owner.rows[0]).toEqual({ owns: true });

    const attacker = await asRole(
      "authenticated",
      ATTACKER,
      `select public.user_owns_show('${PROOF_SHOW}') as owns`
    );
    expect(attacker.rows[0]).toEqual({ owns: false });

    await db.exec(`
      update public.show_ownership_proofs
         set status = 'pending'
       where show_id = '${PROOF_SHOW}' and user_id = '${OWNER}';
    `);
    const pending = await asRole(
      "authenticated",
      OWNER,
      `select public.user_owns_show('${PROOF_SHOW}') as owns`
    );
    expect(pending.rows[0]).toEqual({ owns: false });
    await db.exec(`
      update public.show_ownership_proofs
         set status = 'verified'
       where show_id = '${PROOF_SHOW}' and user_id = '${OWNER}';
    `);
  });

  it("blocks a forged surface insert and allows the owner row", async () => {
    await expect(
      asRole(
        "authenticated",
        ATTACKER,
        `insert into public.show_surfaces (show_id, owner_user_id, type)
         values ('${CATALOG}', '${ATTACKER}', 'newsletter')`
      )
    ).rejects.toThrow(/row-level security|permission denied|new row violates/i);

    const inserted = await asRole(
      "authenticated",
      OWNER,
      `insert into public.show_surfaces (show_id, owner_user_id, type)
       values ('${SHOW}', '${OWNER}', 'newsletter')
       returning id::text`
    );
    expect(inserted.rows).toHaveLength(1);
  });

  it("denies anon execute", async () => {
    await expect(
      asRole("anon", ATTACKER, `select public.user_owns_show('${SHOW}') as owns`)
    ).rejects.toThrow(/permission denied/i);
  });
});
