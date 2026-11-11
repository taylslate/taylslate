-- ============================================================
-- 088: creator YouTube connection for caption airchecks
--
-- NOT applied. Apply only after merge and Chris's OK.
-- Apply on ldtmhafewfifdizgfrnn only after merge and Chris's OK.
-- Paste into the Supabase SQL Editor. Do not run this from
-- the app, a seed script, or a deploy hook.
--
-- A show user connects their own YouTube channel. Taylslate
-- reads that channel's caption tracks and YouTube Analytics
-- for videos on that user's deals. Tokens are ciphertext
-- (AES-256-GCM in the app, key YOUTUBE_TOKEN_ENC_KEY). This
-- file does not store plaintext tokens.
--
-- The code only reads. youtube.force-ssl is required because
-- captions.list and captions.download accept no narrower
-- scope. Nothing in this schema grants a brand access.
-- share_with_brand is stored and no policy exposes these
-- tables to anon or authenticated.
--
-- Retention (YouTube API Services policies III.D.3, III.E.4):
--   Caption text, segments, and the ad-read excerpt are
--   cleared 30 days after fetch. Match result, confidence,
--   ad timestamps, and reasons stay.
--   Analytics rows stay while the connection is active.
--   Authorization is re-checked at least every 30 days.
--   After 30 days in reauth_required, metrics and caption
--   text for that connection are deleted.
--   Disconnect revokes the token, nulls both token columns,
--   deletes metrics, and clears caption text. Remaining
--   revoked rows are deleted within 7 days.
--
-- Quota: one Google project, one ledger (youtube_quota_days).
-- aircheck_reserve is the units the caption feed keeps for
-- the next Pacific day. The library cap becomes
-- min(daily cap, 9800 - reserve). The caption job is
-- 'aircheck_captions'. If a later change replaces
-- youtube_quota_commit, the job list must keep that name.
--
-- Idempotent. Safe to re-run. Order-independent with 084,
-- 085, 086, and 087.
--
-- Introspection (run after applying, read only):
--   select
--     to_regclass('public.youtube_oauth_connections') as connections_table,
--     to_regclass('public.youtube_aircheck_metrics') as metrics_table,
--     (select relrowsecurity from pg_class
--       where oid = 'public.youtube_oauth_connections'::regclass) as connections_rls,
--     (select relrowsecurity from pg_class
--       where oid = 'public.youtube_aircheck_metrics'::regclass) as metrics_rls,
--     (select count(*) from pg_policies
--       where schemaname = 'public'
--         and tablename in ('youtube_oauth_connections', 'youtube_aircheck_metrics')) as policies,
--     (select pg_get_constraintdef(oid) from pg_constraint
--       where conname = 'youtube_quota_log_job_check') as job_check,
--     (select count(*) from information_schema.columns
--       where table_schema = 'public'
--         and table_name = 'youtube_quota_days'
--         and column_name = 'aircheck_reserve') as reserve_column;
--   Expected: both tables, RLS true, policies 0, job check
--   includes aircheck_captions, reserve_column 1.
-- ============================================================

create table if not exists public.youtube_oauth_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  show_profile_id uuid references public.show_profiles (id) on delete cascade,
  channel_id text not null,
  channel_title text,
  scopes text[] not null default '{}',
  -- Nullable so disconnect can null the ciphertext. Active rows
  -- must still carry a refresh token (check below).
  refresh_token_enc text,
  access_token_enc text,
  access_token_expires_at timestamptz,
  key_version smallint not null default 1,
  status text not null default 'active',
  share_with_brand boolean not null default false,
  connected_at timestamptz,
  last_refreshed_at timestamptz,
  last_verified_at timestamptz,
  revoked_at timestamptz,
  reauth_required_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.youtube_oauth_connections add column if not exists user_id uuid;
alter table public.youtube_oauth_connections add column if not exists show_profile_id uuid;
alter table public.youtube_oauth_connections add column if not exists channel_id text;
alter table public.youtube_oauth_connections add column if not exists channel_title text;
alter table public.youtube_oauth_connections add column if not exists scopes text[] default '{}';
alter table public.youtube_oauth_connections add column if not exists refresh_token_enc text;
alter table public.youtube_oauth_connections add column if not exists access_token_enc text;
alter table public.youtube_oauth_connections add column if not exists access_token_expires_at timestamptz;
alter table public.youtube_oauth_connections add column if not exists key_version smallint default 1;
alter table public.youtube_oauth_connections add column if not exists status text default 'active';
alter table public.youtube_oauth_connections add column if not exists share_with_brand boolean default false;
alter table public.youtube_oauth_connections add column if not exists connected_at timestamptz;
alter table public.youtube_oauth_connections add column if not exists last_refreshed_at timestamptz;
alter table public.youtube_oauth_connections add column if not exists last_verified_at timestamptz;
alter table public.youtube_oauth_connections add column if not exists revoked_at timestamptz;
alter table public.youtube_oauth_connections add column if not exists reauth_required_at timestamptz;
alter table public.youtube_oauth_connections add column if not exists created_at timestamptz default now();
alter table public.youtube_oauth_connections add column if not exists updated_at timestamptz default now();

alter table public.youtube_oauth_connections alter column scopes set default '{}';
alter table public.youtube_oauth_connections alter column scopes set not null;
alter table public.youtube_oauth_connections alter column key_version set default 1;
alter table public.youtube_oauth_connections alter column key_version set not null;
alter table public.youtube_oauth_connections alter column status set default 'active';
alter table public.youtube_oauth_connections alter column status set not null;
alter table public.youtube_oauth_connections alter column share_with_brand set default false;
alter table public.youtube_oauth_connections alter column share_with_brand set not null;
alter table public.youtube_oauth_connections alter column created_at set default now();
alter table public.youtube_oauth_connections alter column created_at set not null;
alter table public.youtube_oauth_connections alter column updated_at set default now();
alter table public.youtube_oauth_connections alter column updated_at set not null;

alter table public.youtube_oauth_connections drop constraint if exists youtube_oauth_connections_status_check;
alter table public.youtube_oauth_connections
  add constraint youtube_oauth_connections_status_check
  check (status in ('active', 'reauth_required', 'revoked'));

alter table public.youtube_oauth_connections drop constraint if exists youtube_oauth_connections_active_token_check;
alter table public.youtube_oauth_connections
  add constraint youtube_oauth_connections_active_token_check
  check (status <> 'active' or (refresh_token_enc is not null and length(refresh_token_enc) > 0));

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'youtube_oauth_connections_user_channel_key'
      and conrelid = 'public.youtube_oauth_connections'::regclass
  ) then
    alter table public.youtube_oauth_connections
      add constraint youtube_oauth_connections_user_channel_key unique (user_id, channel_id);
  end if;
end $$;

create unique index if not exists youtube_oauth_connections_one_active_channel
  on public.youtube_oauth_connections (channel_id)
  where status = 'active';

-- One live grant per user. A second channel must revoke the first.
create unique index if not exists youtube_oauth_connections_one_live_user
  on public.youtube_oauth_connections (user_id)
  where status in ('active', 'reauth_required');

drop trigger if exists update_youtube_oauth_connections_timestamp on public.youtube_oauth_connections;
create trigger update_youtube_oauth_connections_timestamp
  before update on public.youtube_oauth_connections
  for each row execute function public.update_updated_at();

comment on table public.youtube_oauth_connections is
  'Creator YouTube OAuth. Tokens are app-encrypted ciphertext. service_role only. A connected channel is not show-ownership verification.';
comment on column public.youtube_oauth_connections.refresh_token_enc is
  'AES-256-GCM ciphertext. Null after revoke. Never a plaintext Google token.';
comment on column public.youtube_oauth_connections.access_token_enc is
  'AES-256-GCM ciphertext for the short-lived access token. Null after revoke.';
comment on column public.youtube_oauth_connections.share_with_brand is
  'Stored only. This migration does not grant brands access to captions or analytics.';

create table if not exists public.youtube_aircheck_metrics (
  io_line_item_id uuid primary key references public.io_line_items (id) on delete cascade,
  connection_id uuid not null references public.youtube_oauth_connections (id) on delete cascade,
  video_id text not null,
  views bigint,
  estimated_minutes_watched bigint,
  average_view_duration_seconds integer,
  retention jsonb,
  video_duration_seconds integer,
  fetched_at timestamptz,
  attempts smallint not null default 0
);

alter table public.youtube_aircheck_metrics add column if not exists connection_id uuid;
alter table public.youtube_aircheck_metrics add column if not exists video_id text;
alter table public.youtube_aircheck_metrics add column if not exists views bigint;
alter table public.youtube_aircheck_metrics add column if not exists estimated_minutes_watched bigint;
alter table public.youtube_aircheck_metrics add column if not exists average_view_duration_seconds integer;
alter table public.youtube_aircheck_metrics add column if not exists retention jsonb;
alter table public.youtube_aircheck_metrics add column if not exists video_duration_seconds integer;
alter table public.youtube_aircheck_metrics add column if not exists fetched_at timestamptz;
alter table public.youtube_aircheck_metrics add column if not exists attempts smallint default 0;

alter table public.youtube_aircheck_metrics alter column attempts set default 0;
alter table public.youtube_aircheck_metrics alter column attempts set not null;

alter table public.youtube_aircheck_metrics drop constraint if exists youtube_aircheck_metrics_attempts_check;
alter table public.youtube_aircheck_metrics
  add constraint youtube_aircheck_metrics_attempts_check
  check (attempts >= 0);

alter table public.youtube_aircheck_metrics drop constraint if exists youtube_aircheck_metrics_retention_check;
alter table public.youtube_aircheck_metrics
  add constraint youtube_aircheck_metrics_retention_check
  check (retention is null or jsonb_typeof(retention) = 'array');

comment on table public.youtube_aircheck_metrics is
  'Raw YouTube Analytics values for one IO line. No derived score. service_role only.';
comment on column public.youtube_aircheck_metrics.retention is
  'Raw elapsedVideoTimeRatio points that overlap the ad read, plus one point either side. Not a computed score.';

-- Data API grants. service_role only. Revoke first so a re-run
-- drops anything a partial apply left behind. Grants come before RLS.
revoke all on table public.youtube_oauth_connections from public;
revoke all on table public.youtube_oauth_connections from anon;
revoke all on table public.youtube_oauth_connections from authenticated;
revoke all on table public.youtube_oauth_connections from service_role;
grant select, insert, update, delete on table public.youtube_oauth_connections to service_role;
revoke truncate, references, trigger on table public.youtube_oauth_connections from authenticated;
revoke truncate, references, trigger on table public.youtube_oauth_connections from anon;
revoke truncate, references, trigger on table public.youtube_oauth_connections from public;

revoke all on table public.youtube_aircheck_metrics from public;
revoke all on table public.youtube_aircheck_metrics from anon;
revoke all on table public.youtube_aircheck_metrics from authenticated;
revoke all on table public.youtube_aircheck_metrics from service_role;
grant select, insert, update, delete on table public.youtube_aircheck_metrics to service_role;
revoke truncate, references, trigger on table public.youtube_aircheck_metrics from authenticated;
revoke truncate, references, trigger on table public.youtube_aircheck_metrics from anon;
revoke truncate, references, trigger on table public.youtube_aircheck_metrics from public;

alter table public.youtube_oauth_connections enable row level security;
alter table public.youtube_aircheck_metrics enable row level security;

-- No policies. service_role bypasses RLS on Supabase. anon and
-- authenticated have no grant and no policy.

-- Quota reserve. The library reads this and lowers its cap so
-- caption checks keep at least this many units.
alter table public.youtube_quota_days add column if not exists aircheck_reserve integer not null default 0;
alter table public.youtube_quota_days alter column aircheck_reserve set default 0;
update public.youtube_quota_days set aircheck_reserve = 0 where aircheck_reserve is null;
alter table public.youtube_quota_days alter column aircheck_reserve set not null;

alter table public.youtube_quota_days drop constraint if exists youtube_quota_days_aircheck_reserve_check;
alter table public.youtube_quota_days
  add constraint youtube_quota_days_aircheck_reserve_check
  check (aircheck_reserve between 0 and 4000);

comment on column public.youtube_quota_days.aircheck_reserve is
  'Units held for the caption feed on this Pacific day. 0 to 4000. The library cap is min(daily cap, 9800 - this).';

alter table public.youtube_quota_log drop constraint if exists youtube_quota_log_job_check;
alter table public.youtube_quota_log
  add constraint youtube_quota_log_job_check
  check (job in ('pull', 'refresh', 'email_backfill', 'aircheck_captions'));

-- Body matches 076 except the job list includes aircheck_captions.
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
  if p_job is null or p_job not in ('pull', 'refresh', 'email_backfill', 'aircheck_captions') then
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
  'Add YouTube units for a Pacific day, stopping at the cap. Jobs: pull, refresh, email_backfill, aircheck_captions. service_role only.';

create or replace function public.youtube_quota_set_reserve(
  p_day date,
  p_units integer
) returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  if p_day is null then
    raise exception 'youtube_quota_set_reserve: day is required' using errcode = '22023';
  end if;
  if p_units is null or p_units < 0 or p_units > 4000 then
    raise exception 'youtube_quota_set_reserve: units must be from 0 to 4000' using errcode = '22023';
  end if;

  insert into public.youtube_quota_days (pacific_day, units, aircheck_reserve)
  values (p_day, 0, p_units)
  on conflict (pacific_day) do update
    set aircheck_reserve = excluded.aircheck_reserve,
        updated_at = now();
end;
$$;

revoke all on function public.youtube_quota_set_reserve(date, integer) from public;
revoke all on function public.youtube_quota_set_reserve(date, integer) from anon;
revoke all on function public.youtube_quota_set_reserve(date, integer) from authenticated;
grant execute on function public.youtube_quota_set_reserve(date, integer) to service_role;

comment on function public.youtube_quota_set_reserve(date, integer) is
  'Set tomorrow''s caption reserve. Upserts the day with units 0 when the row is new and does not change units on conflict. service_role only.';

-- Clears caption text and the excerpt. Leaves match_result,
-- confidence, ad timestamps, and match_reasons alone.
create or replace function public.youtube_oauth_clear_captions(p_line_ids uuid[])
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  if p_line_ids is null or cardinality(p_line_ids) = 0 then
    return;
  end if;
  update public.airchecks
     set transcript_text = null,
         transcript_segments = null,
         match_evidence = case
           when jsonb_typeof(match_evidence) = 'object'
           then jsonb_set(match_evidence, '{excerpt}', 'null'::jsonb, true)
           else match_evidence
         end
   where provider = 'youtube-captions'
     and io_line_item_id = any(p_line_ids);
end;
$$;

revoke all on function public.youtube_oauth_clear_captions(uuid[]) from public;
revoke all on function public.youtube_oauth_clear_captions(uuid[]) from anon;
revoke all on function public.youtube_oauth_clear_captions(uuid[]) from authenticated;
grant execute on function public.youtube_oauth_clear_captions(uuid[]) to service_role;

create or replace function public.youtube_oauth_disconnect(p_user_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_profile uuid;
begin
  if p_user_id is null then
    raise exception 'youtube_oauth_disconnect: user is required' using errcode = '22023';
  end if;

  select id into v_profile
    from public.show_profiles
   where user_id = p_user_id;

  delete from public.youtube_aircheck_metrics
   where connection_id in (
     select id from public.youtube_oauth_connections where user_id = p_user_id
   );

  if v_profile is not null then
    perform public.youtube_oauth_clear_captions(array(
      select li.id
        from public.io_line_items li
        join public.insertion_orders io on io.id = li.io_id
        join public.deals d on d.id = io.deal_id
       where d.show_profile_id = v_profile
    ));
  end if;

  update public.youtube_oauth_connections
     set status = 'revoked',
         refresh_token_enc = null,
         access_token_enc = null,
         access_token_expires_at = null,
         revoked_at = now()
   where user_id = p_user_id
     and status <> 'revoked';
end;
$$;

revoke all on function public.youtube_oauth_disconnect(uuid) from public;
revoke all on function public.youtube_oauth_disconnect(uuid) from anon;
revoke all on function public.youtube_oauth_disconnect(uuid) from authenticated;
grant execute on function public.youtube_oauth_disconnect(uuid) to service_role;

comment on function public.youtube_oauth_disconnect(uuid) is
  'Revoke a creator connection locally: null tokens, delete metrics, clear caption text on that user''s deals. service_role only.';

create or replace function public.youtube_oauth_housekeeping(p_now timestamptz)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_caption_before timestamptz;
  v_reauth_before timestamptz;
  v_revoked_before timestamptz;
begin
  if p_now is null then
    raise exception 'youtube_oauth_housekeeping: now is required' using errcode = '22023';
  end if;

  v_caption_before := p_now - interval '30 days';
  v_reauth_before := p_now - interval '30 days';
  v_revoked_before := p_now - interval '7 days';

  -- created_at, not updated_at. The airchecks trigger rewrites
  -- updated_at on every update, which would keep captions forever.
  perform public.youtube_oauth_clear_captions(array(
    select io_line_item_id
      from public.airchecks
     where provider = 'youtube-captions'
       and transcript_text is not null
       and created_at < v_caption_before
  ));

  delete from public.youtube_aircheck_metrics m
   using public.youtube_oauth_connections c
   where m.connection_id = c.id
     and c.status = 'reauth_required'
     and c.reauth_required_at is not null
     and c.reauth_required_at < v_reauth_before;

  perform public.youtube_oauth_clear_captions(array(
    select li.id
      from public.io_line_items li
      join public.insertion_orders io on io.id = li.io_id
      join public.deals d on d.id = io.deal_id
      join public.youtube_oauth_connections c on c.show_profile_id = d.show_profile_id
     where c.status = 'reauth_required'
       and c.reauth_required_at is not null
       and c.reauth_required_at < v_reauth_before
       and not exists (
         select 1
           from public.youtube_oauth_connections l
          where l.show_profile_id = c.show_profile_id
            and l.status = 'active'
       )
  ));

  delete from public.youtube_oauth_connections
   where status = 'reauth_required'
     and reauth_required_at is not null
     and reauth_required_at < v_reauth_before;

  delete from public.youtube_aircheck_metrics m
   using public.youtube_oauth_connections c
   where m.connection_id = c.id
     and c.status = 'revoked'
     and c.revoked_at is not null
     and c.revoked_at < v_revoked_before;

  perform public.youtube_oauth_clear_captions(array(
    select li.id
      from public.io_line_items li
      join public.insertion_orders io on io.id = li.io_id
      join public.deals d on d.id = io.deal_id
      join public.youtube_oauth_connections c on c.show_profile_id = d.show_profile_id
     where c.status = 'revoked'
       and c.revoked_at is not null
       and c.revoked_at < v_revoked_before
       and not exists (
         select 1
           from public.youtube_oauth_connections l
          where l.show_profile_id = c.show_profile_id
            and l.status = 'active'
       )
  ));

  delete from public.youtube_oauth_connections
   where status = 'revoked'
     and revoked_at is not null
     and revoked_at < v_revoked_before;
end;
$$;

revoke all on function public.youtube_oauth_housekeeping(timestamptz) from public;
revoke all on function public.youtube_oauth_housekeeping(timestamptz) from anon;
revoke all on function public.youtube_oauth_housekeeping(timestamptz) from authenticated;
grant execute on function public.youtube_oauth_housekeeping(timestamptz) to service_role;

comment on function public.youtube_oauth_housekeeping(timestamptz) is
  '30-day caption purge, 30-day reauth data delete, 7-day revoked data delete. Does not change match judgments. service_role only.';
