-- ============================================================
-- 071: shows SELECT is limited to signed-in participants
--
-- NOT applied. Apply on ldtmhafewfifdizgfrnn only after merge and Chris's OK.
-- Apply only after 066. Paste into the Supabase SQL Editor, then introspect.
-- Do not run this from the app, a seed script, or a deploy hook.
--
-- The S4 note called this file 070. 070 is taken by another job.
-- This is 071. 061 is reserved for O1. O1 has not merged, and
-- public.show_ownership_proofs does not exist. The verified-tie
-- branch is the two getVerifiedProfileTies mirrors only. A third
-- branch for verified show_ownership_proofs is a follow-up after O1.
--
-- 066 left "Shows are publicly readable" (USING true) in place and
-- left authenticated SELECT. Any signed-in user can read a hidden
-- show through PostgREST. This drops that policy and replaces it
-- with "Shows readable by signed-in participants" FOR SELECT TO
-- authenticated. A row is visible when any of these hold:
--   is_discoverable is true
--   shows.agent_id is the caller
--   an approved agent_show_relationships row for the caller
--   a deals row on this show whose brand_id, agency_id, or agent_id
--     is the caller
--   a verified tie: a deal whose show_profile_id is the caller's
--     show_profiles row, or a show_owner row whose contact_email
--     matches the caller's profiles.email and the caller has a
--     show_profiles row
-- show_profiles.podscan_id is not a tie. There is no admin branch.
-- The live profiles role check allows brand, agency, agent, and
-- show. It does not allow admin. The env allowlist is not readable
-- in SQL.
--
-- Policies on agent_show_relationships, deals, show_profiles, and
-- profiles do not read shows, so the branches stay inline. No
-- security definer function. Every auth.uid() call is wrapped in
-- (select auth.uid()).
--
-- Indexes added only when missing:
--   agent_show_relationships (show_id, agent_id) where status =
--     'approved'
--   show_profiles (user_id), the name from migration 009
-- idx_shows_agent, idx_deals_show, and idx_agent_shows_show already
-- exist. They are not recreated under a second name.
--
-- Grants are re-asserted, not widened. Anon and public have nothing
-- on shows. Authenticated keeps SELECT and loses insert, update,
-- delete, truncate, references, and trigger again. service_role is
-- not granted or revoked.
--
-- Idempotent. Safe to re-run. No backfill. No new table.
--
-- Introspection (run after applying):
--   select polname, polcmd, pg_get_expr(polqual, polrelid)
--     from pg_policy
--    where polrelid = 'public.shows'::regclass
--    order by polname;
--   Expected: "Shows readable by signed-in participants" only.
--   "Shows are publicly readable" is absent.
--   select grantee, privilege_type
--     from information_schema.role_table_grants
--    where table_schema = 'public'
--      and table_name = 'shows'
--      and grantee in ('anon', 'PUBLIC', 'authenticated', 'service_role')
--    order by grantee, privilege_type;
--   Expected: anon none, PUBLIC none, authenticated SELECT only.
--   service_role is unchanged from before this file.
-- ============================================================

drop policy if exists "Shows are publicly readable" on public.shows;
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
      and exists (
        select 1
        from public.profiles p
        where p.id = (select auth.uid())
          and p.email is not null
          and lower(contact_email) = lower(p.email)
          and exists (
            select 1
            from public.show_profiles owner_profile
            where owner_profile.user_id = p.id
          )
      )
    )
  );

create index if not exists idx_agent_shows_show_agent_approved
  on public.agent_show_relationships (show_id, agent_id)
  where status = 'approved';

create index if not exists idx_show_profiles_user
  on public.show_profiles (user_id);

revoke all on table public.shows from anon;
revoke all on table public.shows from public;
revoke insert, update, delete, truncate, references, trigger
  on table public.shows from authenticated;
