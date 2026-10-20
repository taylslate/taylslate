-- ============================================================
-- 046: guard show_profiles.podscan_id
--
-- A new value is kept only when it equals shows.podscan_id on a show
-- this profile is already tied to:
--   1. a deal whose show_profile_id is this profile, or
--   2. a show_owner row whose contact_email matches the profile
--      owner's login.
-- Anything else is dropped. INSERT stores null. UPDATE keeps the
-- previous value. Clearing the column (null or blank) is allowed.
-- Existing rows are left as stored. This file does not UPDATE them.
--
-- The function lives in schema private so it is not a Data API RPC.
-- SECURITY DEFINER so the claim check can see catalog shows and deals
-- the caller cannot read under RLS. search_path is pinned.
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
--   Expected: one security-definer function in schema private, one
--   trigger on public.show_profiles.
-- ============================================================

create schema if not exists private;

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

drop trigger if exists show_profiles_guard_podscan_id on public.show_profiles;
create trigger show_profiles_guard_podscan_id
  before insert or update of podscan_id on public.show_profiles
  for each row
  execute function private.show_profiles_guard_podscan_id();
