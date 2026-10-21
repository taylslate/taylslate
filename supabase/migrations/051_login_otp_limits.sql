-- ============================================================
-- 051: shared limiter for login email codes
--
-- POST /api/auth/login/otp and /api/auth/login/otp/verify call
-- public.login_otp_consume. The rules match
-- lib/auth/login-otp-limit.ts (keep the two in sync):
--   send: 1 per 60 seconds and 5 per hour per email
--   send and verify: 20 per hour per IP
--   verify: under the email row lock, refuse when wrong_codes >= 5,
--           otherwise increment wrong_codes before the caller asks
--           Supabase. clear resets the counter. An accepted send does too.
--
-- A show-setup code (no profile yet, outreach contact matches)
-- stores only a hash on the email bucket. The account is created
-- when that code is verified. This does not change GoTrue otp_exp.
--
-- service_role only. RLS is on and there is no policy for anon or
-- authenticated, so the Data API cannot read the buckets or the
-- pending hashes. The function is SECURITY INVOKER with
-- search_path = public.
--
-- Idempotent. Safe to re-run. Do not apply from the app.
-- MIGRATION TO APPLY.
--
-- Introspection (run after applying):
--   select c.relrowsecurity
--     from pg_class c
--     join pg_namespace n on n.oid = c.relnamespace
--    where n.nspname = 'public' and c.relname = 'login_otp_limits';
--   Expected: true
--   select grantee, privilege_type
--     from information_schema.role_table_grants
--    where table_schema = 'public' and table_name = 'login_otp_limits'
--    order by grantee, privilege_type;
--   Expected grantee: service_role only.
--   select grantee, privilege_type
--     from information_schema.routine_privileges
--    where routine_schema = 'public'
--      and routine_name = 'login_otp_consume';
--   Expected execute: service_role. Not anon, not authenticated, not public.
-- ============================================================

create table if not exists public.login_otp_limits (
  bucket text primary key,
  hour_started_at timestamptz not null default now(),
  hour_hits integer not null default 0,
  minute_started_at timestamptz,
  wrong_codes integer not null default 0,
  locked boolean not null default false,
  pending_code_hash text,
  pending_outreach_id text,
  pending_expires_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.login_otp_limits
  add column if not exists hour_started_at timestamptz not null default now();
alter table public.login_otp_limits
  add column if not exists hour_hits integer not null default 0;
alter table public.login_otp_limits
  add column if not exists minute_started_at timestamptz;
alter table public.login_otp_limits
  add column if not exists wrong_codes integer not null default 0;
alter table public.login_otp_limits
  add column if not exists locked boolean not null default false;
alter table public.login_otp_limits
  add column if not exists pending_code_hash text;
alter table public.login_otp_limits
  add column if not exists pending_outreach_id text;
alter table public.login_otp_limits
  add column if not exists pending_expires_at timestamptz;
alter table public.login_otp_limits
  add column if not exists updated_at timestamptz not null default now();

alter table public.login_otp_limits
  drop constraint if exists login_otp_limits_hour_hits_nonneg;
alter table public.login_otp_limits
  add constraint login_otp_limits_hour_hits_nonneg check (hour_hits >= 0);

alter table public.login_otp_limits
  drop constraint if exists login_otp_limits_wrong_codes_nonneg;
alter table public.login_otp_limits
  add constraint login_otp_limits_wrong_codes_nonneg check (wrong_codes >= 0);

comment on table public.login_otp_limits is
  'Per-email and per-IP buckets for login code sends and verifies. Pending show-setup codes are stored as a hash. service_role only.';

-- Data API grants. service_role only. Revoke first so a re-run drops
-- any grant a partial apply left on public, anon, or authenticated.
revoke all on table public.login_otp_limits from public;
revoke all on table public.login_otp_limits from anon;
revoke all on table public.login_otp_limits from authenticated;
grant select, insert, update, delete on public.login_otp_limits to service_role;

alter table public.login_otp_limits enable row level security;

-- No policies. service_role bypasses RLS. anon and authenticated have
-- no grant and no policy, so they cannot read buckets or code hashes.

drop function if exists public.login_otp_consume(text, text, text, text, text, timestamptz, boolean);

create or replace function public.login_otp_consume(
  p_action text,
  p_email text,
  p_ip text,
  p_pending_hash text default null,
  p_pending_outreach text default null,
  p_pending_expires timestamptz default null,
  p_clear_pending boolean default false
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_email_bucket text := 'email:' || p_email;
  v_ip_bucket text := 'ip:' || p_ip;
  v_now timestamptz := now();
  v_email public.login_otp_limits%rowtype;
  v_ip public.login_otp_limits%rowtype;
  v_ok boolean := true;
  v_error text := null;
  v_retry integer := 0;
begin
  if p_action not in ('send', 'verify', 'clear') then
    raise exception 'login_otp_consume: unknown action';
  end if;
  if p_email is null or length(p_email) = 0 or p_ip is null or length(p_ip) = 0 then
    raise exception 'login_otp_consume: email and ip required';
  end if;

  -- Abandoned unlocked buckets only. A lock stays until a send clears it.
  delete from public.login_otp_limits
  where locked = false
    and updated_at < v_now - interval '2 days';

  insert into public.login_otp_limits (bucket, hour_started_at)
  values (v_email_bucket, v_now)
  on conflict (bucket) do nothing;

  insert into public.login_otp_limits (bucket, hour_started_at)
  values (v_ip_bucket, v_now)
  on conflict (bucket) do nothing;

  -- Email first, then IP, so two sessions cannot deadlock.
  select * into v_email
  from public.login_otp_limits
  where bucket = v_email_bucket
  for update;

  select * into v_ip
  from public.login_otp_limits
  where bucket = v_ip_bucket
  for update;

  if v_email.hour_started_at <= v_now - interval '1 hour' then
    v_email.hour_started_at := v_now;
    v_email.hour_hits := 0;
  end if;
  if v_ip.hour_started_at <= v_now - interval '1 hour' then
    v_ip.hour_started_at := v_now;
    v_ip.hour_hits := 0;
  end if;

  if p_action in ('send', 'verify') and v_ip.hour_hits >= 20 then
    v_ok := false;
    v_error := 'ip_limit';
    v_retry := ceil(extract(epoch from (v_ip.hour_started_at + interval '1 hour' - v_now)))::integer;
  elsif p_action = 'send'
    and v_email.minute_started_at is not null
    and v_email.minute_started_at > v_now - interval '60 seconds' then
    v_ok := false;
    v_error := 'resend_wait';
    v_retry := ceil(extract(epoch from (v_email.minute_started_at + interval '60 seconds' - v_now)))::integer;
    v_ip.hour_hits := v_ip.hour_hits + 1;
  elsif p_action = 'send' and v_email.hour_hits >= 5 then
    v_ok := false;
    v_error := 'hour_limit';
    v_retry := ceil(extract(epoch from (v_email.hour_started_at + interval '1 hour' - v_now)))::integer;
    v_ip.hour_hits := v_ip.hour_hits + 1;
  elsif p_action = 'send' then
    v_email.hour_hits := v_email.hour_hits + 1;
    v_email.minute_started_at := v_now;
    v_email.wrong_codes := 0;
    v_email.locked := false;
    if p_pending_hash is not null then
      v_email.pending_code_hash := p_pending_hash;
      v_email.pending_outreach_id := p_pending_outreach;
      v_email.pending_expires_at := p_pending_expires;
    elsif coalesce(p_clear_pending, false) then
      v_email.pending_code_hash := null;
      v_email.pending_outreach_id := null;
      v_email.pending_expires_at := null;
    end if;
    v_ip.hour_hits := v_ip.hour_hits + 1;
  elsif p_action = 'verify' then
    v_ip.hour_hits := v_ip.hour_hits + 1;
    -- Same row lock as the read. Parallel guesses cannot all pass a
    -- check that a later request increments.
    if v_email.wrong_codes >= 5 then
      v_ok := false;
      v_error := 'locked';
      v_retry := 0;
      v_email.locked := true;
    else
      v_email.wrong_codes := v_email.wrong_codes + 1;
      if v_email.wrong_codes >= 5 then
        v_email.locked := true;
      end if;
    end if;
  elsif p_action = 'clear' then
    v_email.wrong_codes := 0;
    v_email.locked := false;
    v_email.pending_code_hash := null;
    v_email.pending_outreach_id := null;
    v_email.pending_expires_at := null;
  end if;

  if v_retry < 0 then
    v_retry := 0;
  end if;

  update public.login_otp_limits
  set hour_started_at = v_email.hour_started_at,
      hour_hits = v_email.hour_hits,
      minute_started_at = v_email.minute_started_at,
      wrong_codes = v_email.wrong_codes,
      locked = v_email.locked,
      pending_code_hash = v_email.pending_code_hash,
      pending_outreach_id = v_email.pending_outreach_id,
      pending_expires_at = v_email.pending_expires_at,
      updated_at = v_now
  where bucket = v_email_bucket;

  update public.login_otp_limits
  set hour_started_at = v_ip.hour_started_at,
      hour_hits = v_ip.hour_hits,
      updated_at = v_now
  where bucket = v_ip_bucket;

  return jsonb_build_object(
    'ok', v_ok,
    'error', v_error,
    'retry_after_sec', case when v_ok then 0 else v_retry end,
    'pending_hash', case when v_ok and p_action = 'verify' then v_email.pending_code_hash else null end,
    'pending_outreach_id', case when v_ok and p_action = 'verify' then v_email.pending_outreach_id else null end,
    'pending_expires_at', case when v_ok and p_action = 'verify' then v_email.pending_expires_at else null end
  );
end;
$$;

revoke all on function public.login_otp_consume(text, text, text, text, text, timestamptz, boolean) from public;
revoke all on function public.login_otp_consume(text, text, text, text, text, timestamptz, boolean) from anon;
revoke all on function public.login_otp_consume(text, text, text, text, text, timestamptz, boolean) from authenticated;
grant execute on function public.login_otp_consume(text, text, text, text, text, timestamptz, boolean) to service_role;
