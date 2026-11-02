-- ============================================================
-- 077: profiles.email follows auth.users, and access checks do too
--
-- NOT applied. Apply on ldtmhafewfifdizgfrnn only after merge and
-- Chris's OK. Do not run this from the app, a seed script, or a
-- deploy hook.
--
-- profiles.email is writable by the signed-in user. isShowsAdmin,
-- show ownership, outreach read, and the podscan id guard were
-- matching that column. A user could store someone else's address
-- and pass those checks.
--
-- auth_login_email() returns the session login from auth.users.
-- It takes no argument, so a caller cannot read another user's
-- address. Policy checks call it as (select public.auth_login_email()).
-- auth_user_ids_for_email(lookup) is the email directory for server
-- code. Execute is service_role only.
--
-- profiles_sync_email_from_auth copies auth.users.email onto
-- profiles.email on insert and update, including service_role.
-- That overwrite is the protection. A column-level revoke of
-- UPDATE (email) does nothing while authenticated still has
-- table UPDATE, so this file does not revoke the column.
-- There is no EXECUTE grant on the trigger function. It returns
-- trigger, so it is not a Data API call.
--
-- An update of auth.users.email rewrites profiles.email for that
-- id. A profile insert with no auth login raises 42501.
--
-- user_owns_show (050) and "Show reads outreach to their email"
-- (011) compare the login, not profiles.email. The shows SELECT
-- policy from 071 is recreated with the same login comparison.
-- 071 is already applied on ldtmhafewfifdizgfrnn. Editing that
-- file only changes a fresh database. This file is what the
-- live policies need, and it must ship with the deploy. Until
-- it is applied, those live checks still read profiles.email.
-- This file does not drop "Shows are publicly readable".
-- private.show_profiles_guard_podscan_id reads auth.users.
--
-- Idempotent. Safe to re-run. No backfill.
--
-- Introspection (run after applying, read only):
--   select tgname from pg_trigger
--    where tgname = 'profiles_sync_email_from_auth'
--      and tgrelid = 'public.profiles'::regclass;
--   Expected: one row.
--   select pg_get_functiondef('public.user_owns_show(uuid)'::regprocedure);
--   Expected: auth_login_email(). No profiles.email comparison.
-- ============================================================

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

comment on function public.auth_login_email() is
  'Login email from auth.users for auth.uid(). No argument, so it cannot read another user.';

revoke all on function public.auth_login_email() from public;
revoke all on function public.auth_login_email() from anon;
grant execute on function public.auth_login_email() to authenticated;
grant execute on function public.auth_login_email() to service_role;

create or replace function public.sync_profiles_email_from_auth()
returns trigger
language plpgsql
security definer
set search_path = auth, public, pg_temp
as $$
declare
  login_email text;
begin
  select nullif(lower(btrim(email)), '') into login_email
  from auth.users
  where id = new.id;

  if login_email is null then
    raise exception 'profile email must match the login email'
      using errcode = '42501';
  end if;

  new.email := login_email;
  return new;
end;
$$;

comment on function public.sync_profiles_email_from_auth() is
  'Forces profiles.email to the auth.users email for that id.';

revoke all on function public.sync_profiles_email_from_auth() from public;
revoke all on function public.sync_profiles_email_from_auth() from anon;
revoke all on function public.sync_profiles_email_from_auth() from authenticated;
revoke all on function public.sync_profiles_email_from_auth() from service_role;

drop trigger if exists profiles_sync_email_from_auth on public.profiles;
create trigger profiles_sync_email_from_auth
  before insert or update on public.profiles
  for each row
  execute function public.sync_profiles_email_from_auth();

create schema if not exists private;

create or replace function private.sync_profile_email_from_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'UPDATE' and new.email is not distinct from old.email then
    return new;
  end if;

  update public.profiles
     set email = nullif(lower(btrim(new.email)), '')
   where id = new.id;

  return new;
end;
$$;

comment on function private.sync_profile_email_from_auth_user() is
  'After auth.users.email changes, write that login onto profiles.email. The profiles trigger then confirms it.';

revoke all on function private.sync_profile_email_from_auth_user() from public;
revoke all on function private.sync_profile_email_from_auth_user() from anon;
revoke all on function private.sync_profile_email_from_auth_user() from authenticated;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then
    grant execute on function private.sync_profile_email_from_auth_user() to supabase_auth_admin;
  end if;
end $$;

drop trigger if exists auth_users_sync_profile_email on auth.users;
create trigger auth_users_sync_profile_email
  after update of email on auth.users
  for each row
  execute function private.sync_profile_email_from_auth_user();

create or replace function public.auth_user_ids_for_email(lookup text)
returns setof uuid
language sql
stable
security definer
set search_path = auth, public, pg_temp
as $$
  select id
  from auth.users
  where lookup is not null
    and btrim(lookup) <> ''
    and email is not null
    and lower(btrim(email)) = lower(btrim(lookup));
$$;

comment on function public.auth_user_ids_for_email(text) is
  'Auth user ids for one login email. service_role only.';

revoke all on function public.auth_user_ids_for_email(text) from public;
revoke all on function public.auth_user_ids_for_email(text) from anon;
revoke all on function public.auth_user_ids_for_email(text) from authenticated;
grant execute on function public.auth_user_ids_for_email(text) to service_role;

create or replace function public.user_owns_show(target_show uuid)
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  select
    (select auth.uid()) is not null
    and (
      exists (
        select 1
        from public.deals d
        join public.show_profiles sp on sp.id = d.show_profile_id
        where d.show_id = target_show
          and sp.user_id = (select auth.uid())
      )
      or exists (
        select 1
        from public.shows s
        where s.id = target_show
          and 'show_owner' = any (s.data_sources)
          and s.contact_email is not null
          and (select public.auth_login_email()) is not null
          and lower(btrim(s.contact_email)) = (select public.auth_login_email())
      )
    );
$$;

revoke all on function public.user_owns_show(uuid) from public;
revoke all on function public.user_owns_show(uuid) from anon;
grant execute on function public.user_owns_show(uuid) to authenticated;
grant execute on function public.user_owns_show(uuid) to service_role;

drop policy if exists "Show reads outreach to their email" on public.outreaches;
create policy "Show reads outreach to their email"
  on public.outreaches
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.profiles p
      where p.id = (select auth.uid())
        and p.role = 'show'
        and (select public.auth_login_email()) is not null
        and lower(btrim(outreaches.sent_to_email)) = (select public.auth_login_email())
    )
  );

drop policy if exists "Shows readable by signed-in participants" on public.shows;
create policy "Shows readable by signed-in participants"
  on public.shows
  for select
  to authenticated
  using (
    is_discoverable = true
    or agent_id = (select auth.uid())
    or exists (
      select 1
      from public.agent_show_relationships a
      where a.show_id = shows.id
        and a.agent_id = (select auth.uid())
        and a.status = 'approved'
    )
    or exists (
      select 1
      from public.deals d
      where d.show_id = shows.id
        and (select auth.uid()) in (d.brand_id, d.agency_id, d.agent_id)
    )
    or exists (
      select 1
      from public.show_profiles sp
      join public.deals d on d.show_profile_id = sp.id
      where d.show_id = shows.id
        and sp.user_id = (select auth.uid())
    )
    or (
      'show_owner' = any (data_sources)
      and contact_email is not null
      and (select public.auth_login_email()) is not null
      and lower(btrim(contact_email)) = (select public.auth_login_email())
      and exists (
        select 1
        from public.show_profiles owner_profile
        where owner_profile.user_id = (select auth.uid())
      )
    )
  );

create or replace function private.show_profiles_guard_podscan_id()
returns trigger
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  next_id text;
  owner_email text;
  claimed boolean := false;
begin
  if tg_op = 'UPDATE' and new.podscan_id is not distinct from old.podscan_id then
    return new;
  end if;

  if new.podscan_id is null or btrim(new.podscan_id) = '' then
    new.podscan_id := null;
    return new;
  end if;

  next_id := btrim(new.podscan_id);

  select exists (
    select 1
    from public.deals d
    join public.shows s on s.id = d.show_id
    where d.show_profile_id = new.id
      and s.podscan_id = next_id
  ) into claimed;

  if not claimed then
    select nullif(lower(btrim(email)), '') into owner_email
    from auth.users
    where id = new.user_id;

    if owner_email is not null then
      select exists (
        select 1
        from public.shows s
        where s.podscan_id = next_id
          and s.data_sources @> array['show_owner']::text[]
          and s.contact_email is not null
          and lower(btrim(s.contact_email)) = owner_email
      ) into claimed;
    end if;
  end if;

  if claimed then
    new.podscan_id := next_id;
  elsif tg_op = 'INSERT' then
    new.podscan_id := null;
  else
    new.podscan_id := old.podscan_id;
  end if;

  return new;
end;
$$;

drop trigger if exists show_profiles_guard_podscan_id on public.show_profiles;
create trigger show_profiles_guard_podscan_id
  before insert or update of podscan_id on public.show_profiles
  for each row
  execute function private.show_profiles_guard_podscan_id();
