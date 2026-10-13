-- ============================================================
-- 041: profiles.is_managed
--
-- Concierge ("managed") brand accounts. Chris creates and runs the
-- first brand accounts himself. The platform must not email that
-- brand or send a DocuSign envelope on its behalf.
--
-- profiles is a pre-020 table. No new table, so no Data API grant
-- block. The column inherits the table's existing grants.
--
-- The "users update own profile" policy would otherwise let a brand
-- flip this flag, and the insert policy would let a new row claim it.
-- The trigger rejects either unless the session role is service_role
-- (the admin API) or a migration role. Omitting the column on insert
-- keeps the default.
--
-- Idempotent. Safe to re-run. No backfill: existing rows stay false
-- via the column default.
--
-- Introspection check (run after applying):
--   select column_name, data_type, is_nullable, column_default
--     from information_schema.columns
--    where table_schema = 'public'
--      and table_name = 'profiles'
--      and column_name = 'is_managed';
--   select tgname from pg_trigger
--    where tgname = 'profiles_protect_is_managed';
-- ============================================================

alter table public.profiles
  add column if not exists is_managed boolean not null default false;

comment on column public.profiles.is_managed is
  'Concierge brand. Chris runs the account. Platform email to this profile is rerouted, and DocuSign send is blocked.';

create or replace function public.protect_profiles_is_managed()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  -- Inserts omit the column and keep the default. A signed-in user must
  -- not be able to create or flip a concierge account.
  if tg_op = 'INSERT' then
    if new.is_managed is true
       and current_user not in ('service_role', 'postgres', 'supabase_admin') then
      raise exception 'is_managed can only be changed by an internal admin'
        using errcode = '42501';
    end if;
    return new;
  end if;

  if new.is_managed is distinct from old.is_managed
     and current_user not in ('service_role', 'postgres', 'supabase_admin') then
    raise exception 'is_managed can only be changed by an internal admin'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

comment on function public.protect_profiles_is_managed() is
  'Rejects profiles.is_managed changes from any role other than service_role or a migration role.';

revoke all on function public.protect_profiles_is_managed() from public;
grant execute on function public.protect_profiles_is_managed() to authenticated;
grant execute on function public.protect_profiles_is_managed() to service_role;

drop trigger if exists profiles_protect_is_managed on public.profiles;
create trigger profiles_protect_is_managed
  before insert or update of is_managed on public.profiles
  for each row
  execute function public.protect_profiles_is_managed();
