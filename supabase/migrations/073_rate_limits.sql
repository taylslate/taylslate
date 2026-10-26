-- ============================================================
-- 073: shared rate limit events
--
-- S-E. One table and one function for login codes, outreach
-- sends, uploads, and the B1 roster import cap. The app calls
-- rate_limit_hit through the service role. A hit is recorded
-- only when the request is allowed. A denied request does not
-- insert, so the window can expire. Rows older than 2 days are
-- deleted on each call.
--
-- The count and the insert share one transaction and one
-- advisory lock on the bucket and key, so two overlapping
-- calls cannot both pass the same max.
--
-- SECURITY DEFINER so the insert runs as the function owner.
-- search_path is public. Execute and table DML are service_role
-- only. anon, authenticated, and public have nothing. RLS is
-- on and there is no policy.
--
-- Idempotent. Safe to re-run. No backfill.
-- NOT applied. Apply on ldtmhafewfifdizgfrnn only after merge
-- and Chris's OK. Do not run this from the app, a seed script,
-- or a deploy hook.
--
-- Introspection (run after applying):
--   select c.relrowsecurity
--     from pg_class c
--     join pg_namespace n on n.oid = c.relnamespace
--    where n.nspname = 'public' and c.relname = 'rate_limit_events';
--   Expected: true
--   select grantee, privilege_type
--     from information_schema.role_table_grants
--    where table_schema = 'public' and table_name = 'rate_limit_events'
--    order by grantee, privilege_type;
--   Expected grantee: service_role only
--   (select, insert, update, delete).
--   select grantee, privilege_type
--     from information_schema.routine_privileges
--    where routine_schema = 'public'
--      and routine_name = 'rate_limit_hit';
--   Expected execute: service_role. Not anon, not
--   authenticated, not public.
-- ============================================================

create table if not exists public.rate_limit_events (
  key text not null,
  bucket text not null,
  created_at timestamptz not null default now()
);

alter table public.rate_limit_events add column if not exists key text;
alter table public.rate_limit_events add column if not exists bucket text;
alter table public.rate_limit_events add column if not exists created_at timestamptz default now();

alter table public.rate_limit_events alter column key set not null;
alter table public.rate_limit_events alter column bucket set not null;
alter table public.rate_limit_events alter column created_at set not null;
alter table public.rate_limit_events alter column created_at set default now();

create index if not exists idx_rate_limit_events_bucket_key_created
  on public.rate_limit_events (bucket, key, created_at);

comment on table public.rate_limit_events is
  'Sliding-window hits for server rate limits. service_role only. Pruned after 2 days.';

-- Data API grants. service_role only. Revoke first so a re-run
-- drops anything a partial apply left behind.
revoke all on table public.rate_limit_events from public;
revoke all on table public.rate_limit_events from anon;
revoke all on table public.rate_limit_events from authenticated;
revoke all on table public.rate_limit_events from service_role;
grant select, insert, update, delete on public.rate_limit_events to service_role;
revoke truncate, references, trigger on table public.rate_limit_events from authenticated;
revoke truncate, references, trigger on table public.rate_limit_events from anon;
revoke truncate, references, trigger on table public.rate_limit_events from public;

alter table public.rate_limit_events enable row level security;

-- No policies. service_role bypasses RLS on Supabase. anon and
-- authenticated have no grant and no policy.

drop function if exists public.rate_limit_hit(text, text, integer, integer);

create function public.rate_limit_hit(
  p_bucket text,
  p_key text,
  p_max integer,
  p_window_seconds integer
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := now();
  v_count integer;
begin
  if p_bucket is null or btrim(p_bucket) = '' or p_key is null or btrim(p_key) = '' then
    raise exception 'rate_limit_hit: bucket and key are required';
  end if;
  if p_max is null or p_max < 1 or p_window_seconds is null or p_window_seconds < 1 then
    raise exception 'rate_limit_hit: max and window_seconds must be positive';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext(p_bucket),
    pg_catalog.hashtext(p_key)
  );

  delete from public.rate_limit_events
  where created_at < v_now - interval '2 days';

  select count(*)::integer into v_count
  from public.rate_limit_events
  where bucket = p_bucket
    and key = p_key
    and created_at > v_now - make_interval(secs => p_window_seconds);

  if v_count >= p_max then
    return false;
  end if;

  insert into public.rate_limit_events (key, bucket, created_at)
  values (p_key, p_bucket, v_now);

  return true;
end;
$$;

revoke all on function public.rate_limit_hit(text, text, integer, integer) from public;
revoke all on function public.rate_limit_hit(text, text, integer, integer) from anon;
revoke all on function public.rate_limit_hit(text, text, integer, integer) from authenticated;
grant execute on function public.rate_limit_hit(text, text, integer, integer) to service_role;

comment on function public.rate_limit_hit(text, text, integer, integer) is
  'Record one allowed hit. Return false when the bucket and key are already at max inside the window. service_role only.';
