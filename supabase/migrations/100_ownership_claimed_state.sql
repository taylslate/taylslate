-- ============================================================
-- 100: claimed ownership state
--
-- NOT APPLIED LIVE, CHRIS MUST NAME IT.
-- Do not run this from the app, a seed script, or a deploy hook.
-- Paste it into the Supabase SQL Editor only after Chris names it.
--
-- shows.ownership_status was unclaimed or verified (migration 061).
-- Claimed is the third value. A show is claimed only when one of
-- these holds, and the show is not verified:
--   1. Deal. The show accepted or signed, the deal is not declined
--      or cancelled, show_profiles.user_id is the actor_id recorded
--      on that deal.created, io.show_signed, or io.counter_accepted
--      event, outreaches.sent_to_email matches show_contacts.email
--      with source podscan or apple_rss for this show, and that
--      auth user has email_confirmed_at. A brand-typed address does
--      not count. A profile id alone does not count.
--   2. Owner row. data_sources contains show_owner, slug is
--      owner- plus that show_profiles.user_id (the slug
--      resolveOwnerShowId writes), contact_email is that user's
--      confirmed auth email.
-- A verified proof stays verified. This file never downgrades
-- verified. Pending stays a tag. shows.is_claimed is not read.
-- An agent roster link is not a claim. user_owns_show is not this
-- rule. It still treats a looser link as edit rights. That is a
-- separate security item.
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
  'Unclaimed, claimed, or verified. Claimed requires a sourced show accept or signature with that show user as the recorded actor, or a server owner slug. A deal profile alone is not claimed. Pending is still a tag. is_claimed and is_verified are deprecated.';

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
      join public.show_profiles as sp on sp.id = d.show_profile_id
      join public.outreaches as o on o.id = d.outreach_id
      join auth.users as u on u.id = sp.user_id
      join public.domain_events as ev
        on ev.actor_id = sp.user_id
       and ev.event_type in ('deal.created', 'io.show_signed', 'io.counter_accepted')
       and (
         (ev.entity_type = 'deal' and ev.entity_id = d.id)
         or (ev.entity_type = 'outreach' and ev.entity_id = o.id)
       )
      where d.show_id = s.id
        and d.status is distinct from 'cancelled'
        and o.response_status is distinct from 'declined'
        and (o.response_status = 'accepted' or d.show_signed_at is not null)
        and u.email_confirmed_at is not null
        and exists (
          select 1
          from public.show_contacts as sc
          where sc.source in ('podscan', 'apple_rss')
            and lower(btrim(sc.email)) = lower(btrim(o.sent_to_email))
            and sc.show_id = s.id
        )
    )
    or (
      'show_owner' = any (s.data_sources)
      and s.slug like 'owner-%'
      and exists (
        select 1
        from public.show_profiles as sp
        join auth.users as u on u.id = sp.user_id
        where s.slug = 'owner-' || sp.user_id::text
          and u.email_confirmed_at is not null
          and u.email is not null
          and s.contact_email is not null
          and lower(btrim(s.contact_email)) = lower(btrim(u.email))
      )
    )
  );
