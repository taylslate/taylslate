-- ============================================================
-- 050: user_owns_show without a podscan id match
--
-- Migration 044 treated show_profiles.podscan_id = shows.podscan_id
-- as ownership of a catalog show. That column is self-reported.
-- Migration 046 is trigger-only: it stops a new value from being
-- stored unless the profile is already tied, and it does not rewrite
-- rows already stored. Those rows still satisfy the 044 check.
--
-- This recreates public.user_owns_show so a signed-in creator owns a
-- catalog show only when:
--   1. a deal ties their show profile to it, or
--   2. it is the private show_owner row whose contact_email matches
--      their login.
--
-- SECURITY INVOKER and search_path = public, matching 044. Execute
-- stays revoked from public and anon. Policies on show_surfaces
-- already call this function; they are not restated here. 046 is
-- not modified.
--
-- Idempotent. Safe to re-run. Do not apply from the app.
-- MIGRATION TO APPLY.
--
-- Introspection (run after applying):
--   select pg_get_functiondef('public.user_owns_show(uuid)'::regprocedure);
--   Expected: deal check and show_owner email check. No comparison
--   of show_profiles.podscan_id to shows.podscan_id.
--   select grantee, privilege_type
--     from information_schema.routine_privileges
--    where routine_schema = 'public'
--      and routine_name = 'user_owns_show';
--   Expected execute: authenticated, service_role. Not anon, not public.
-- ============================================================

create or replace function public.user_owns_show(target_show uuid)
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  select
    auth.uid() is not null
    and (
      exists (
        select 1
        from public.deals d
        join public.show_profiles sp on sp.id = d.show_profile_id
        where d.show_id = target_show
          and sp.user_id = auth.uid()
      )
      or exists (
        select 1
        from public.shows s
        join public.profiles p on p.id = auth.uid()
        where s.id = target_show
          and 'show_owner' = any (s.data_sources)
          and s.contact_email is not null
          and p.email is not null
          and lower(s.contact_email) = lower(p.email)
      )
    );
$$;

revoke all on function public.user_owns_show(uuid) from public;
revoke all on function public.user_owns_show(uuid) from anon;
grant execute on function public.user_owns_show(uuid) to authenticated;
grant execute on function public.user_owns_show(uuid) to service_role;
