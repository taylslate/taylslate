-- ============================================================
-- 087: retire the stored outreach response token
--
-- NOT applied. Apply only after merge and Chris's OK.
-- Apply on ldtmhafewfifdizgfrnn only after merge and Chris's OK.
-- Paste into the Supabase SQL Editor. Do not run this from
-- the app, a seed script, or a deploy hook.
--
-- outreaches.token is a bearer credential. The public accept,
-- counter, and decline routes trust the HMAC signature and
-- never read this column. The raw value is needed once, in
-- memory, to build the email link. Storing it lets the sending
-- brand read it back through RLS and the API, then act as the
-- show.
--
-- Expand, then contract. This file overwrites every stored
-- value with a non-secret placeholder (retired:<id>) and drops
-- NOT NULL, so inserts keep working while older code still
-- writes the column. A later cleanup migration drops
-- outreaches.token after this file is live and those
-- placeholder writes are gone. That cleanup is its own PR.
--
-- No new table. No grant change. No policy change.
-- outreaches_token_key stays. The placeholders are unique.
-- Idempotent. Safe to re-run. The block runs only when the
-- column still exists.
--
-- Introspection (run after applying, read only):
--   select
--     (select count(*) from public.outreaches
--       where token not like 'retired:%') as tokens_not_retired,
--     (select is_nullable from information_schema.columns
--       where table_schema = 'public'
--         and table_name = 'outreaches'
--         and column_name = 'token') as token_nullable;
--   Expected: 0, YES.
-- ============================================================

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'outreaches'
      and column_name = 'token'
  ) then
    update public.outreaches
       set token = 'retired:' || id::text
     where token is distinct from 'retired:' || id::text;

    alter table public.outreaches
      alter column token drop not null;
  end if;
end $$;
