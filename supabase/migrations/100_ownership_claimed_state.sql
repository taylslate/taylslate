-- ============================================================
-- 100: claimed ownership state
--
-- NOT APPLIED LIVE, CHRIS MUST NAME IT.
-- Do not run this from the app, a seed script, or a deploy hook.
-- Paste it into the Supabase SQL Editor only after Chris names it.
--
-- shows.ownership_status was unclaimed or verified (migration 061).
-- Claimed is the third value. A show is claimed when a show account
-- controls the profile, rates, and replies, and the show is not
-- verified. That is the same control tie as public.user_owns_show
-- (migration 077), without the verified-proof branch:
--   1. a deals row has this show_id and a non-null show_profile_id, or
--   2. data_sources contains show_owner, contact_email is set, and
--      that email matches auth.users.email for a user who has a
--      show_profiles row.
-- A verified proof stays verified. This file never downgrades
-- verified. Pending stays a tag on show_ownership_proofs, not a
-- value of this column. shows.is_claimed is not read and is not
-- dropped. A podscan id is not a tie. An agent roster link is not
-- a claim.
--
-- No new table. No new function. No search_path change. No grant.
-- No RLS change. Authenticated keeps SELECT only on shows.
--
-- Idempotent. Safe to re-run. The backfill updates only rows that
-- are not already verified or claimed.
--
-- Introspection (run after applying, read only):
--   select pg_get_constraintdef(oid)
--     from pg_constraint
--    where conname = 'shows_ownership_status_check';
--   Expected: ownership_status in ('unclaimed', 'claimed', 'verified').
--   select ownership_status, count(*)
--     from public.shows
--    group by ownership_status
--    order by ownership_status;
-- ============================================================

alter table public.shows
  drop constraint if exists shows_ownership_status_check;

alter table public.shows
  add constraint shows_ownership_status_check
  check (ownership_status in ('unclaimed', 'claimed', 'verified'));

comment on column public.shows.ownership_status is
  'Unclaimed, claimed, or verified. Claimed means a show account controls the profile, rates, and replies, and ownership is not verified. Pending is still a tag, not a state. is_claimed is deprecated.';

comment on column public.shows.is_verified is
  'Deprecated. Ranking reads ownership_status. Do not branch on this flag.';

update public.shows as s
set ownership_status = 'claimed'
where s.ownership_status is distinct from 'verified'
  and s.ownership_status is distinct from 'claimed'
  and (
    exists (
      select 1
      from public.deals as d
      where d.show_id = s.id
        and d.show_profile_id is not null
    )
    or (
      'show_owner' = any (s.data_sources)
      and s.contact_email is not null
      and btrim(s.contact_email) <> ''
      and exists (
        select 1
        from auth.users as u
        join public.show_profiles as sp on sp.user_id = u.id
        where u.email is not null
          and lower(btrim(u.email)) = lower(btrim(s.contact_email))
      )
    )
  );
