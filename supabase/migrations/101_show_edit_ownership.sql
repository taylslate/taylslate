-- ============================================================
-- 101: show edit ownership
--
-- NOT APPLIED LIVE, CHRIS MUST NAME IT.
-- Do not run this from the app, a seed script, or a deploy hook.
-- Paste it into the Supabase SQL Editor only after Chris names it.
--
-- public.user_owns_show(uuid) is the show_surfaces write check.
-- It was security invoker. It stays security invoker, with
-- search_path = ''. The body calls private.show_edit_grant(uuid).
-- That helper is security definer, also with search_path = '',
-- because the deal rule reads show_contacts, domain_events, and
-- auth.users. Authenticated has no select on those tables. The
-- helper returns a boolean for auth.uid() only. It does not
-- return an email or a row.
--
-- True when one of these holds for auth.uid():
--   1. Owner row. data_sources contains show_owner, slug is
--      owner- plus that user id, a show_profiles row exists for
--      that user, contact_email equals auth.users.email, and
--      email_confirmed_at is not null.
--   2. Verified proof. show_ownership_proofs.status is verified
--      and user_id is auth.uid(). The verify flow stores that
--      user id on the proof. shows.ownership_status = verified
--      with no proof for this user does not count.
--   3. Deal. The same rule as migration 100. The show accepted
--      or signed, the deal is not declined or cancelled, this
--      user is actor_id on deal.created, io.show_signed, or
--      io.counter_accepted for that deal or outreach, the
--      outreach email matches show_contacts for this show with
--      source podscan or apple_rss, and email_confirmed_at is
--      not null.
-- A deals.show_profile_id by itself does not count. A
-- brand-typed email does not count. profiles.email is not read.
-- There is no admin branch. The admin allowlist is an env var.
-- App writes use service_role after isShowsAdmin.
--
-- No new table. user_owns_show keeps execute for authenticated
-- and service_role. anon and public stay revoked.
-- private.show_edit_grant execute is granted to authenticated
-- and service_role and revoked from anon and public. Usage on
-- schema private is granted to those two roles so the invoker
-- function can call the helper.
--
-- Idempotent. Safe to re-run. The app does not call either
-- function. App edits use the service role after canEditShow, so
-- those routes do not break before this file is applied.
-- Apply 101 in the same step as the merge. Until it is applied,
-- a direct PostgREST write to show_surfaces still uses the
-- previous body, and that path is exploitable.
--
-- Introspection (run after applying, read only):
--   select n.nspname, p.proname, p.prosecdef, p.proconfig
--     from pg_proc p
--     join pg_namespace n on n.oid = p.pronamespace
--    where (n.nspname = 'public' and p.proname = 'user_owns_show')
--       or (n.nspname = 'private' and p.proname = 'show_edit_grant')
--    order by 1, 2;
--   Expected: user_owns_show prosecdef false and search_path "".
--   show_edit_grant prosecdef true and search_path "".
--   select routine_schema, routine_name, grantee
--     from information_schema.routine_privileges
--    where routine_name in ('user_owns_show', 'show_edit_grant')
--      and privilege_type = 'EXECUTE'
--    order by 1, 2, 3;
--   Expected execute: authenticated and service_role.
--   Not anon. Not PUBLIC.
-- ============================================================

create schema if not exists private;

create or replace function private.show_edit_grant(target_show uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    (select auth.uid()) is not null
    and (
      exists (
        select 1
        from public.shows as s
        join public.show_profiles as sp
          on sp.user_id = (select auth.uid())
        join auth.users as u
          on u.id = sp.user_id
        where s.id = target_show
          and 'show_owner' = any (s.data_sources)
          and s.slug is not null
          and lower(btrim(s.slug)) = lower('owner-' || sp.user_id::text)
          and u.email_confirmed_at is not null
          and u.email is not null
          and s.contact_email is not null
          and lower(btrim(s.contact_email)) = lower(btrim(u.email))
      )
      or exists (
        select 1
        from public.show_ownership_proofs as p
        where p.show_id = target_show
          and p.user_id = (select auth.uid())
          and p.status = 'verified'
      )
      or exists (
        select 1
        from public.deals as d
        join public.show_profiles as sp
          on sp.id = d.show_profile_id
         and sp.user_id = (select auth.uid())
        join public.outreaches as o
          on o.id = d.outreach_id
        join auth.users as u
          on u.id = sp.user_id
        join public.domain_events as ev
          on ev.actor_id = sp.user_id
         and ev.event_type in ('deal.created', 'io.show_signed', 'io.counter_accepted')
         and (
           (ev.entity_type = 'deal' and ev.entity_id = d.id)
           or (ev.entity_type = 'outreach' and ev.entity_id = o.id)
         )
        where d.show_id = target_show
          and d.status is distinct from 'cancelled'
          and o.response_status is distinct from 'declined'
          and (o.response_status = 'accepted' or d.show_signed_at is not null)
          and u.email_confirmed_at is not null
          and exists (
            select 1
            from public.show_contacts as sc
            where sc.source in ('podscan', 'apple_rss')
              and lower(btrim(sc.email)) = lower(btrim(o.sent_to_email))
              and sc.show_id = d.show_id
          )
      )
    );
$$;

comment on function private.show_edit_grant(uuid) is
  'True when auth.uid() may edit this show. Boolean only. No email is returned.';

revoke all on function private.show_edit_grant(uuid) from public;
revoke all on function private.show_edit_grant(uuid) from anon;
revoke all on function private.show_edit_grant(uuid) from authenticated;
grant execute on function private.show_edit_grant(uuid) to authenticated;
grant execute on function private.show_edit_grant(uuid) to service_role;

grant usage on schema private to authenticated;
grant usage on schema private to service_role;

create or replace function public.user_owns_show(target_show uuid)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select
    (select auth.uid()) is not null
    and private.show_edit_grant(target_show);
$$;

comment on function public.user_owns_show(uuid) is
  'Show-surfaces write check. Invoker. Delegates to private.show_edit_grant. A deal profile id is not enough.';

revoke all on function public.user_owns_show(uuid) from public;
revoke all on function public.user_owns_show(uuid) from anon;
grant execute on function public.user_owns_show(uuid) to authenticated;
grant execute on function public.user_owns_show(uuid) to service_role;
