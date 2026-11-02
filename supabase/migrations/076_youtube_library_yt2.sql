-- ============================================================
-- 076: YouTube library contact emails, daily quota, queue pages
--
-- Depends on 074 (youtube_channels, youtube_pull_queue).
--
-- youtube_channel_emails stores one row per channel, address, and
-- source. found_at is when this row was first stored. Sources:
--   channel_description  plain text on the channel
--   about_link           mailto: or an email inside an About URL
--   video_description    a recent upload's description
-- Addresses are lowercase. A repeat find keeps the original found_at.
--
-- emails_checked_at is set after the stored description is scanned.
-- That scan does not call YouTube. video_emails_checked_at is set
-- after recent upload descriptions are read (2 units per channel).
-- video_emails_attempts counts failed video reads. At 3 the channel
-- is marked checked so one dead channel cannot block the rest.
--
-- youtube_quota_days is units committed for one Pacific calendar day
-- (America/Los_Angeles, the YouTube Data API reset). youtube_quota_log
-- is one row per accepted commit. youtube_quota_commit adds units
-- only up to the cap and returns {accepted, total}.
--
-- youtube_pull_queue.page_token distinguishes the first search ("")
-- from a later page ("page:...") or an order variant ("order:date",
-- "order:viewCount"). The unique key is (kind, value, page_token).
-- next_page_token is the follow-up token saved when a search finishes.
--
-- RLS is on. There is no policy. service_role has select, insert,
-- update, delete on the new tables, and execute on the function.
-- anon, authenticated, and public have nothing.
--
-- Idempotent. Safe to re-run. No backfill of email rows. The email
-- cron scans existing channels after this file is applied.
-- NOT applied. Apply on ldtmhafewfifdizgfrnn only after merge
-- and Chris's own-words OK. Do not run this from the app, a
-- seed script, or a deploy hook. Until then the pull and refresh
-- crons keep the pre-076 budget and do not write these tables.
--
-- Introspection (run after applying):
--   select c.relrowsecurity
--     from pg_class c
--     join pg_namespace n on n.oid = c.relnamespace
--    where n.nspname = 'public'
--      and c.relname in (
--        'youtube_channel_emails',
--        'youtube_quota_days',
--        'youtube_quota_log'
--      );
--   Expected: true, true, true
--   select grantee, privilege_type
--     from information_schema.role_table_grants
--    where table_schema = 'public'
--      and table_name in (
--        'youtube_channel_emails',
--        'youtube_quota_days',
--        'youtube_quota_log'
--      )
--    order by table_name, grantee, privilege_type;
--   Expected grantee: service_role only
--   (select, insert, update, delete) on each table.
--   select public.youtube_quota_commit('2026-11-02', 1, 'pull', 8000);
--   Expected: {"accepted": 1, "total": 1} on a fresh day, then
--   delete from youtube_quota_days and youtube_quota_log where
--   pacific_day = '2026-11-02' if that row was only a probe.
-- ============================================================

alter table public.youtube_channels add column if not exists emails_checked_at timestamptz;
alter table public.youtube_channels add column if not exists video_emails_checked_at timestamptz;
alter table public.youtube_channels add column if not exists video_emails_attempts integer default 0;

update public.youtube_channels
   set video_emails_attempts = 0
 where video_emails_attempts is null;

alter table public.youtube_channels alter column video_emails_attempts set default 0;
alter table public.youtube_channels alter column video_emails_attempts set not null;

alter table public.youtube_channels drop constraint if exists youtube_channels_video_emails_attempts_check;
alter table public.youtube_channels
  add constraint youtube_channels_video_emails_attempts_check
  check (video_emails_attempts >= 0);

comment on column public.youtube_channels.emails_checked_at is
  'When the stored channel description was scanned for contact emails. Null means not scanned. No YouTube API call.';

comment on column public.youtube_channels.video_emails_checked_at is
  'When recent upload descriptions were scanned for contact emails. Null means not scanned.';

create index if not exists idx_youtube_channels_emails_unchecked
  on public.youtube_channels (channel_id)
  where emails_checked_at is null;

create index if not exists idx_youtube_channels_video_emails_unchecked
  on public.youtube_channels (channel_id)
  where video_emails_checked_at is null;

alter table public.youtube_pull_queue add column if not exists page_token text;
alter table public.youtube_pull_queue add column if not exists next_page_token text;

update public.youtube_pull_queue set page_token = '' where page_token is null;

alter table public.youtube_pull_queue alter column page_token set default '';
alter table public.youtube_pull_queue alter column page_token set not null;

alter table public.youtube_pull_queue drop constraint if exists youtube_pull_queue_page_token_len_check;
alter table public.youtube_pull_queue
  add constraint youtube_pull_queue_page_token_len_check
  check (char_length(page_token) <= 2000);

alter table public.youtube_pull_queue drop constraint if exists youtube_pull_queue_next_page_token_len_check;
alter table public.youtube_pull_queue
  add constraint youtube_pull_queue_next_page_token_len_check
  check (next_page_token is null or char_length(next_page_token) <= 2000);

drop index if exists public.youtube_pull_queue_kind_value_uidx;

create unique index if not exists youtube_pull_queue_kind_value_page_uidx
  on public.youtube_pull_queue (kind, value, page_token);

comment on column public.youtube_pull_queue.page_token is
  'Empty on the first relevance search. order:date and order:viewCount are order variants. page: prefixes a YouTube page token.';

comment on column public.youtube_pull_queue.next_page_token is
  'Follow-up page token saved when this search finishes. Null when the search has no next page.';

create table if not exists public.youtube_channel_emails (
  id uuid primary key default gen_random_uuid(),
  channel_id text not null,
  email text not null,
  source text not null,
  found_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

alter table public.youtube_channel_emails add column if not exists channel_id text;
alter table public.youtube_channel_emails add column if not exists email text;
alter table public.youtube_channel_emails add column if not exists source text;
alter table public.youtube_channel_emails add column if not exists found_at timestamptz default now();
alter table public.youtube_channel_emails add column if not exists created_at timestamptz default now();

alter table public.youtube_channel_emails alter column channel_id set not null;
alter table public.youtube_channel_emails alter column email set not null;
alter table public.youtube_channel_emails alter column source set not null;
alter table public.youtube_channel_emails alter column found_at set default now();
alter table public.youtube_channel_emails alter column found_at set not null;
alter table public.youtube_channel_emails alter column created_at set default now();
alter table public.youtube_channel_emails alter column created_at set not null;

alter table public.youtube_channel_emails drop constraint if exists youtube_channel_emails_source_check;
alter table public.youtube_channel_emails
  add constraint youtube_channel_emails_source_check
  check (source in ('channel_description', 'about_link', 'video_description'));

alter table public.youtube_channel_emails drop constraint if exists youtube_channel_emails_email_check;
alter table public.youtube_channel_emails
  add constraint youtube_channel_emails_email_check
  check (
    char_length(email) between 6 and 320
    and email = lower(email)
    and position('@' in email) > 1
  );

alter table public.youtube_channel_emails
  drop constraint if exists youtube_channel_emails_channel_email_source_key;
alter table public.youtube_channel_emails
  add constraint youtube_channel_emails_channel_email_source_key
  unique (channel_id, email, source);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'youtube_channel_emails_channel_id_fkey'
      and conrelid = 'public.youtube_channel_emails'::regclass
  ) then
    alter table public.youtube_channel_emails
      add constraint youtube_channel_emails_channel_id_fkey
      foreign key (channel_id) references public.youtube_channels(channel_id) on delete cascade;
  end if;
end $$;

create index if not exists idx_youtube_channel_emails_channel_id
  on public.youtube_channel_emails (channel_id);

comment on table public.youtube_channel_emails is
  'Contact emails found on a YouTube channel. Unique per channel, address, and source. service_role only.';

create table if not exists public.youtube_quota_days (
  pacific_day date primary key,
  units integer not null default 0,
  updated_at timestamptz not null default now()
);

alter table public.youtube_quota_days add column if not exists units integer default 0;
alter table public.youtube_quota_days add column if not exists updated_at timestamptz default now();

update public.youtube_quota_days set units = 0 where units is null;
update public.youtube_quota_days set updated_at = now() where updated_at is null;

alter table public.youtube_quota_days alter column units set default 0;
alter table public.youtube_quota_days alter column units set not null;
alter table public.youtube_quota_days alter column updated_at set default now();
alter table public.youtube_quota_days alter column updated_at set not null;

alter table public.youtube_quota_days drop constraint if exists youtube_quota_days_units_check;
alter table public.youtube_quota_days
  add constraint youtube_quota_days_units_check
  check (units >= 0);

comment on table public.youtube_quota_days is
  'YouTube Data API units committed for one Pacific day. service_role only.';

create table if not exists public.youtube_quota_log (
  id uuid primary key default gen_random_uuid(),
  pacific_day date not null,
  units integer not null,
  job text not null,
  created_at timestamptz not null default now()
);

alter table public.youtube_quota_log add column if not exists pacific_day date;
alter table public.youtube_quota_log add column if not exists units integer;
alter table public.youtube_quota_log add column if not exists job text;
alter table public.youtube_quota_log add column if not exists created_at timestamptz default now();

alter table public.youtube_quota_log alter column pacific_day set not null;
alter table public.youtube_quota_log alter column units set not null;
alter table public.youtube_quota_log alter column job set not null;
alter table public.youtube_quota_log alter column created_at set default now();
alter table public.youtube_quota_log alter column created_at set not null;

alter table public.youtube_quota_log drop constraint if exists youtube_quota_log_units_check;
alter table public.youtube_quota_log
  add constraint youtube_quota_log_units_check
  check (units > 0 and units <= 10000);

alter table public.youtube_quota_log drop constraint if exists youtube_quota_log_job_check;
alter table public.youtube_quota_log
  add constraint youtube_quota_log_job_check
  check (job in ('pull', 'refresh', 'email_backfill'));

create index if not exists idx_youtube_quota_log_pacific_day
  on public.youtube_quota_log (pacific_day, created_at);

comment on table public.youtube_quota_log is
  'One row per accepted YouTube quota commit. service_role only.';

create or replace function public.youtube_quota_commit(
  p_day date,
  p_units integer,
  p_job text,
  p_cap integer
) returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_current integer;
  v_accepted integer;
begin
  if p_day is null then
    raise exception 'youtube_quota_commit: day is required' using errcode = '22023';
  end if;
  if p_units is null or p_units <= 0 or p_units > 10000 then
    raise exception 'youtube_quota_commit: units must be from 1 to 10000' using errcode = '22023';
  end if;
  if p_cap is null or p_cap < 0 then
    raise exception 'youtube_quota_commit: cap must be zero or positive' using errcode = '22023';
  end if;
  if p_job is null or p_job not in ('pull', 'refresh', 'email_backfill') then
    raise exception 'youtube_quota_commit: unknown job' using errcode = '22023';
  end if;

  insert into public.youtube_quota_days (pacific_day, units)
  values (p_day, 0)
  on conflict (pacific_day) do nothing;

  select units into v_current
    from public.youtube_quota_days
   where pacific_day = p_day
   for update;

  if v_current is null then
    raise exception 'youtube_quota_commit: day row missing' using errcode = 'P0002';
  end if;

  v_accepted := least(p_units, greatest(p_cap - v_current, 0));
  if v_accepted <= 0 then
    return jsonb_build_object('accepted', 0, 'total', v_current);
  end if;

  update public.youtube_quota_days
     set units = units + v_accepted,
         updated_at = now()
   where pacific_day = p_day;

  insert into public.youtube_quota_log (pacific_day, units, job)
  values (p_day, v_accepted, p_job);

  return jsonb_build_object('accepted', v_accepted, 'total', v_current + v_accepted);
end;
$$;

revoke all on function public.youtube_quota_commit(date, integer, text, integer) from public;
revoke all on function public.youtube_quota_commit(date, integer, text, integer) from anon;
revoke all on function public.youtube_quota_commit(date, integer, text, integer) from authenticated;
grant execute on function public.youtube_quota_commit(date, integer, text, integer) to service_role;

comment on function public.youtube_quota_commit(date, integer, text, integer) is
  'Add YouTube units for a Pacific day, stopping at the cap. Returns accepted and total. service_role only.';

-- Data API grants. service_role only. Revoke first so a re-run
-- drops anything a partial apply left behind.
revoke all on table public.youtube_channel_emails from public;
revoke all on table public.youtube_channel_emails from anon;
revoke all on table public.youtube_channel_emails from authenticated;
revoke all on table public.youtube_channel_emails from service_role;
grant select, insert, update, delete on public.youtube_channel_emails to service_role;
revoke truncate, references, trigger on table public.youtube_channel_emails from authenticated;
revoke truncate, references, trigger on table public.youtube_channel_emails from anon;
revoke truncate, references, trigger on table public.youtube_channel_emails from public;

revoke all on table public.youtube_quota_days from public;
revoke all on table public.youtube_quota_days from anon;
revoke all on table public.youtube_quota_days from authenticated;
revoke all on table public.youtube_quota_days from service_role;
grant select, insert, update, delete on public.youtube_quota_days to service_role;
revoke truncate, references, trigger on table public.youtube_quota_days from authenticated;
revoke truncate, references, trigger on table public.youtube_quota_days from anon;
revoke truncate, references, trigger on table public.youtube_quota_days from public;

revoke all on table public.youtube_quota_log from public;
revoke all on table public.youtube_quota_log from anon;
revoke all on table public.youtube_quota_log from authenticated;
revoke all on table public.youtube_quota_log from service_role;
grant select, insert, update, delete on public.youtube_quota_log to service_role;
revoke truncate, references, trigger on table public.youtube_quota_log from authenticated;
revoke truncate, references, trigger on table public.youtube_quota_log from anon;
revoke truncate, references, trigger on table public.youtube_quota_log from public;

alter table public.youtube_channel_emails enable row level security;
alter table public.youtube_quota_days enable row level security;
alter table public.youtube_quota_log enable row level security;

-- No policies. service_role bypasses RLS on Supabase. anon and
-- authenticated have no grant and no policy.
