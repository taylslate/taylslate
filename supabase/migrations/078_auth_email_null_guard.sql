-- ============================================================
-- 078: a null auth email does not fail the auth update
--
-- NOT applied. Apply on ldtmhafewfifdizgfrnn only after merge and
-- Chris's OK. Do not run this from the app, a seed script, or a
-- deploy hook.
--
-- 077's auth.users trigger copies the new login onto profiles.
-- The profiles trigger then raises 42501 when that login is null,
-- which rolls back the auth update. Clearing or blanking
-- auth.users.email must not do that. This leaves profiles.email
-- as it was and returns.
--
-- Idempotent. Safe to re-run. No backfill. No grant change.
-- The trigger from 077 stays in place and calls this function.
--
-- Introspection (run after applying, read only):
--   select pg_get_functiondef('private.sync_profile_email_from_auth_user()'::regprocedure);
--   Expected: a null or blank new.email returns new before the
--   profiles update.
-- ============================================================

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

  if new.email is null or btrim(new.email) = '' then
    return new;
  end if;

  update public.profiles
     set email = lower(btrim(new.email))
   where id = new.id;

  return new;
end;
$$;

comment on function private.sync_profile_email_from_auth_user() is
  'After auth.users.email changes to a real address, write that login onto profiles.email. A null or blank login leaves the profile email alone.';

revoke all on function private.sync_profile_email_from_auth_user() from public;
revoke all on function private.sync_profile_email_from_auth_user() from anon;
revoke all on function private.sync_profile_email_from_auth_user() from authenticated;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then
    grant execute on function private.sync_profile_email_from_auth_user() to supabase_auth_admin;
  end if;
end $$;
