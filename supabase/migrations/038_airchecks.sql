-- ============================================================
-- 038: airchecks — stored episode transcript for one IO line
--
-- Step 1 of delivery verification. One row per io_line_items row.
-- Pulls nothing by itself: the admin route writes the row after it
-- resolves the line's existing episode_url (or the show RSS item for
-- that line) and stores whatever transcript it got.
--
-- Does not mark the line delivered, and does not create a payment.
-- No backfill.
--
-- Status:
--   pending     — a run started and has not finished
--   transcribed — transcript_text is the episode transcript
--   failed      — error explains why; the row stays for a retry
--
-- provider records who produced the transcript ('podscan', or the
-- AIRCHECK_TRANSCRIPTION_PROVIDER value when that fallback ran).
--
-- Idempotent. Safe to re-run. Applied on the live project 2026-09-29.
--
-- Introspection check (run after applying):
--   select column_name from information_schema.columns
--    where table_schema = 'public' and table_name = 'airchecks'
--    order by ordinal_position;
--   select conname from pg_constraint
--    where conrelid = 'public.airchecks'::regclass
--    order by conname;
--   Expected columns include io_line_item_id, episode_identifier,
--   audio_url, transcript_text, provider, status, error,
--   created_at, updated_at.
--   Expected constraints: airchecks_pkey, airchecks_status_check,
--   airchecks_io_line_item_id_key, airchecks_io_line_item_id_fkey.
-- ============================================================

create table if not exists public.airchecks (
  id                  uuid primary key default gen_random_uuid(),
  io_line_item_id     uuid not null references public.io_line_items(id) on delete cascade,
  -- The episode the IO line already names: episode_url, or the RSS
  -- guid/link when the line has no URL and the feed item matched post_date.
  episode_identifier  text,
  audio_url           text,
  transcript_text     text,
  -- 'podscan' or the configured fallback provider. Null until a
  -- transcript source was actually attempted.
  provider            text,
  status              text not null default 'pending',
  error               text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

alter table public.airchecks drop constraint if exists airchecks_status_check;
alter table public.airchecks
  add constraint airchecks_status_check
  check (status in ('pending', 'transcribed', 'failed'));

-- Unique constraint (not only an index) so PostgREST upsert can
-- ON CONFLICT (io_line_item_id). Also indexes the foreign key.
alter table public.airchecks drop constraint if exists airchecks_io_line_item_id_key;
alter table public.airchecks
  add constraint airchecks_io_line_item_id_key unique (io_line_item_id);

-- Transcripts are admin-server writes through the service role.
-- No anon or authenticated grant: a logged-in brand must not read a
-- full episode transcript through the Data API. Revoke first in case
-- default privileges granted those roles when the table was created.
revoke all on public.airchecks from anon;
revoke all on public.airchecks from authenticated;
grant select, insert, update, delete on public.airchecks to service_role;

alter table public.airchecks enable row level security;

drop policy if exists "Service role can manage all airchecks" on public.airchecks;
create policy "Service role can manage all airchecks"
  on public.airchecks for all to service_role
  using (true) with check (true);

drop trigger if exists update_airchecks_timestamp on public.airchecks;
create trigger update_airchecks_timestamp
  before update on public.airchecks
  for each row execute function update_updated_at();

comment on table public.airchecks is
  'Aircheck step 1. One transcript per IO line. Does not verify delivery or charge.';
comment on column public.airchecks.episode_identifier is
  'Episode the IO line already identifies: io_line_items.episode_url, or the RSS guid/link when the line has no URL.';
comment on column public.airchecks.provider is
  'Who produced transcript_text: podscan, or AIRCHECK_TRANSCRIPTION_PROVIDER. Null when no source was attempted.';
