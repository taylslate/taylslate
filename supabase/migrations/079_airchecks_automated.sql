-- ============================================================
-- 079: automated airchecks. Transcript segments, cost, and match.
--
-- NOT applied. Apply on ldtmhafewfifdizgfrnn only after merge and Chris's OK.
-- Do not run this from the app, a seed script, or a deploy hook.
--
-- Parts 1 and 2 of automated airchecks. One row per IO line still.
-- The cron stores the transcript text, timestamped segments, the
-- minutes, and the estimated Whisper cost. It then stores a match
-- judgment with a confidence score, the ad-read timestamps, and
-- the reasons, and sets ready_for_review. A person still confirms
-- on the existing review screen before any charge. This file does
-- not mark a line delivered and does not create a payment.
--
-- Brands and shows can read airchecks for their own deals.
-- The policy compares auth.uid() and auth_login_email() from migration
-- 077. Writes stay on service_role.
-- 077 is already applied. This file does not recreate that function.
--
-- Idempotent. Safe to re-run. No backfill.
--
-- Introspection (run after applying, read only):
--   select column_name from information_schema.columns
--    where table_schema = 'public' and table_name = 'airchecks'
--      and column_name in (
--        'transcript_segments', 'audio_minutes', 'estimated_cost_usd',
--        'ready_for_review', 'confidence', 'ad_start_seconds',
--        'ad_end_seconds', 'match_reasons'
--      )
--    order by column_name;
--   select polname from pg_policy
--    where polrelid = 'public.airchecks'::regclass
--    order by polname;
--   Expected policy: Brand or show reads own deal airchecks.
--   select privilege_type, grantee from information_schema.role_table_grants
--    where table_schema = 'public' and table_name = 'airchecks'
--    order by grantee, privilege_type;
--   Expected: authenticated has select. service_role has select,
--   insert, update, delete. anon has none.
-- ============================================================

alter table public.airchecks
  add column if not exists transcript_segments jsonb,
  add column if not exists duration_seconds numeric,
  add column if not exists audio_minutes numeric,
  add column if not exists estimated_cost_usd numeric,
  add column if not exists window_start date,
  add column if not exists window_end date,
  add column if not exists ready_for_review boolean not null default false,
  add column if not exists confidence numeric,
  add column if not exists ad_start_seconds numeric,
  add column if not exists ad_end_seconds numeric,
  add column if not exists match_reasons jsonb;

alter table public.airchecks drop constraint if exists airchecks_confidence_check;
alter table public.airchecks
  add constraint airchecks_confidence_check
  check (confidence is null or (confidence >= 0 and confidence <= 1));

alter table public.airchecks drop constraint if exists airchecks_ready_for_review_check;
alter table public.airchecks
  add constraint airchecks_ready_for_review_check
  check (ready_for_review = false or status = 'transcribed');

alter table public.airchecks drop constraint if exists airchecks_estimated_cost_check;
alter table public.airchecks
  add constraint airchecks_estimated_cost_check
  check (estimated_cost_usd is null or estimated_cost_usd >= 0);

alter table public.airchecks drop constraint if exists airchecks_audio_minutes_check;
alter table public.airchecks
  add constraint airchecks_audio_minutes_check
  check (audio_minutes is null or audio_minutes >= 0);

alter table public.airchecks drop constraint if exists airchecks_segments_array_check;
alter table public.airchecks
  add constraint airchecks_segments_array_check
  check (
    transcript_segments is null
    or jsonb_typeof(transcript_segments) = 'array'
  );

alter table public.airchecks drop constraint if exists airchecks_match_reasons_array_check;
alter table public.airchecks
  add constraint airchecks_match_reasons_array_check
  check (
    match_reasons is null
    or jsonb_typeof(match_reasons) = 'array'
  );

alter table public.airchecks drop constraint if exists airchecks_ad_span_check;
alter table public.airchecks
  add constraint airchecks_ad_span_check
  check (
    (ad_start_seconds is null or ad_start_seconds >= 0)
    and (ad_end_seconds is null or ad_end_seconds >= 0)
    and (
      ad_start_seconds is null
      or ad_end_seconds is null
      or ad_end_seconds >= ad_start_seconds
    )
  );

create index if not exists idx_airchecks_ready_for_review
  on public.airchecks (ready_for_review)
  where ready_for_review;

comment on column public.airchecks.transcript_segments is
  'Timestamped transcript pieces: start_seconds, end_seconds, text. The audio file is not stored.';
comment on column public.airchecks.audio_minutes is
  'Episode length in minutes used for the Whisper cost estimate.';
comment on column public.airchecks.estimated_cost_usd is
  'Estimated OpenAI Whisper cost for this episode. whisper-1 at $0.006 per minute.';
comment on column public.airchecks.window_start is
  'First day of the spot air window. The IO line post_date.';
comment on column public.airchecks.window_end is
  'Last day of the spot air window, post_date plus 6 days.';
comment on column public.airchecks.ready_for_review is
  'True after a match judgment is stored. Does not mark the line delivered and does not charge.';
comment on column public.airchecks.confidence is
  'Match confidence from 0 to 1. A person still confirms before a charge.';
comment on column public.airchecks.ad_start_seconds is
  'Start of the located ad read in the episode, in seconds.';
comment on column public.airchecks.ad_end_seconds is
  'End of the located ad read in the episode, in seconds.';
comment on column public.airchecks.match_reasons is
  'JSON array of sentences explaining the match judgment.';

-- Data API grants. authenticated may read. Writes stay on service_role.
revoke all on table public.airchecks from public;
revoke all on table public.airchecks from anon;
revoke all on table public.airchecks from authenticated;
grant select, insert, update, delete on table public.airchecks to service_role;
grant select on table public.airchecks to authenticated;
revoke insert, update, delete, truncate, references, trigger
  on table public.airchecks from authenticated;

alter table public.airchecks enable row level security;

drop policy if exists "Brand or show reads own deal airchecks" on public.airchecks;
create policy "Brand or show reads own deal airchecks"
  on public.airchecks
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.io_line_items li
      join public.insertion_orders io on io.id = li.io_id
      join public.deals d on d.id = io.deal_id
      where li.id = airchecks.io_line_item_id
        and (
          d.brand_id = (select auth.uid())
          or d.agency_id = (select auth.uid())
          or exists (
            select 1
            from public.brand_profiles bp
            where bp.id = d.brand_profile_id
              and bp.user_id = (select auth.uid())
          )
          or exists (
            select 1
            from public.show_profiles sp
            where sp.id = d.show_profile_id
              and sp.user_id = (select auth.uid())
          )
          or (
            exists (
              select 1
              from public.shows s
              where s.id = d.show_id
                and 'show_owner' = any (s.data_sources)
                and s.contact_email is not null
                and (select public.auth_login_email()) is not null
                and lower(btrim(s.contact_email)) = (select public.auth_login_email())
            )
            and exists (
              select 1
              from public.show_profiles owner_profile
              where owner_profile.user_id = (select auth.uid())
            )
          )
        )
    )
  );
