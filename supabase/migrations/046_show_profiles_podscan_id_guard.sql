-- ============================================================
-- 046: show_profiles.podscan_id is a verified-claim column
--
-- The column is self-reported today. RLS lets the owner update the
-- row, and migration 020 grants authenticated insert/update, so a
-- direct Data API write can store another show's Podscan id.
-- Scoring and geography do not read it. This trigger is the write
-- guard: a new value is kept only when it equals shows.podscan_id on
-- a show this profile is already tied to, by either:
--   1. a deal whose show_profile_id is this profile, or
--   2. a show_owner row whose contact_email matches the profile
--      owner's login.
-- Anything else is dropped. INSERT stores null. UPDATE keeps the
-- previous value. Clearing the column (null or blank) is allowed.
-- Existing rows are left as stored. This file does not UPDATE them.
--
-- The function lives in schema private so it is not a Data API RPC.
-- It is SECURITY DEFINER so the claim check can see catalog shows
-- and deals the caller cannot read under RLS. search_path is pinned.
--
-- Grants: show_profiles stays grandfathered. The statements below
-- re-assert the 020 grants (service_role and authenticated DML, anon
-- SELECT only). RLS stays owner-scoped, recreated idempotently from
-- migration 009. The trigger is the column guard.
--
-- Idempotent. Safe to re-run. Do not apply from the app.
--
-- Introspection (run after applying):
--   select n.nspname, p.prosecdef
--     from pg_proc p
--     join pg_namespace n on n.oid = p.pronamespace
--    where p.proname = 'show_profiles_guard_podscan_id';
--   select tgname from pg_trigger
--    where tgname = 'show_profiles_guard_podscan_id'
--      and tgrelid = 'public.show_profiles'::regclass;
--   select grantee, privilege_type
--     from information_schema.role_table_grants
--    where table_schema = 'public' and table_name = 'show_profiles'
--    order by grantee, privilege_type;
--   select polname, polcmd from pg_policy
--    where polrelid = 'public.show_profiles'::regclass
--    order by polname;
--   Expected: one security-definer function in schema private, one
--   trigger on public.show_profiles, grants unchanged from 020, three
--   owner policies (select, insert, update).
-- ============================================================

create schema if not exists private;

revoke all on schema private from public;
grant usage on schema private to postgres, service_role, authenticated, anon;

create or replace function private.show_profiles_guard_podscan_id()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
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
    select btrim(email) into owner_email
    from public.profiles
    where id = new.user_id;

    if owner_email is not null and owner_email <> '' then
      select exists (
        select 1
        from public.shows s
        where s.podscan_id = next_id
          and s.data_sources @> array['show_owner']::text[]
          and s.contact_email is not null
          and lower(btrim(s.contact_email)) = lower(owner_email)
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

revoke all on function private.show_profiles_guard_podscan_id() from public;
grant execute on function private.show_profiles_guard_podscan_id() to postgres, service_role, authenticated, anon;

drop trigger if exists show_profiles_guard_podscan_id on public.show_profiles;
create trigger show_profiles_guard_podscan_id
  before insert or update of podscan_id on public.show_profiles
  for each row
  execute function private.show_profiles_guard_podscan_id();

comment on function private.show_profiles_guard_podscan_id() is
  'Keeps show_profiles.podscan_id only when it matches shows.podscan_id on a deal-linked show or a show_owner row with the profile owner email. Other writes are dropped. Trigger-only; not an RPC.';

comment on column public.show_profiles.podscan_id is
  'Self-reported Podscan id. Display only. A new value is stored only when it equals shows.podscan_id on a show tied by a deal or a show_owner contact email (migration 046). Scoring and geography do not join on it.';

-- Data API grants. Same as 020. Re-asserted so this file stands alone.
grant select, insert, update, delete on public.show_profiles to service_role;
grant select, insert, update, delete on public.show_profiles to authenticated;
grant select on public.show_profiles to anon;

alter table public.show_profiles enable row level security;

drop policy if exists "Users read own show profile" on public.show_profiles;
create policy "Users read own show profile"
  on public.show_profiles for select
  using (auth.uid() = user_id);

drop policy if exists "Users insert own show profile" on public.show_profiles;
create policy "Users insert own show profile"
  on public.show_profiles for insert
  with check (auth.uid() = user_id);

drop policy if exists "Users update own show profile" on public.show_profiles;
create policy "Users update own show profile"
  on public.show_profiles for update
  using (auth.uid() = user_id);
