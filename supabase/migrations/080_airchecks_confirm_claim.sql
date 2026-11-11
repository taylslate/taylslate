-- ============================================================
-- 080: aircheck confirm claim.
--
-- NOT applied. Apply on ldtmhafewfifdizgfrnn only after merge,
-- only when Chris names 080, in the same release as the deploy,
-- and only after 079 (and 040) are live.
-- Do not run this from the app, a seed script, or a deploy hook.
--
-- A confirm or reject takes one claim on the airchecks row before
-- it charges or stores a decision. confirm_claimed_at is that claim.
-- A claim older than 5 minutes can be taken again. The success write
-- clears it. This file does not mark a line delivered and does not
-- create a payment. No backfill.
--
-- Reads and writes stay on service_role. authenticated and anon have
-- no grant. Live already has the policy "Service role can manage all
-- airchecks" (service_role ALL). This file does not drop that policy.
-- The app reads airchecks through the service role after its own
-- session check.
--
-- Idempotent. Safe to re-run.
--
-- Introspection (run after applying, read only):
--   select column_name from information_schema.columns
--    where table_schema = 'public' and table_name = 'airchecks'
--      and column_name in ('confirm_claimed_at', 'confirm_claimed_by')
--    order by column_name;
--   select privilege_type, grantee from information_schema.role_table_grants
--    where table_schema = 'public' and table_name = 'airchecks'
--    order by grantee, privilege_type;
--   Expected: service_role has select, insert, update, delete, and
--   also references, trigger, and truncate, which live already has.
--   This file does not revoke those. authenticated and anon have none.
-- ============================================================

alter table public.airchecks
  add column if not exists confirm_claimed_at timestamptz,
  add column if not exists confirm_claimed_by text;

comment on column public.airchecks.confirm_claimed_at is
  'Set while a confirm or reject is in progress. A claim older than 5 minutes can be taken again. Cleared when the decision is stored.';

comment on column public.airchecks.confirm_claimed_by is
  'Internal admin email that holds confirm_claimed_at. Cleared with the claim.';

-- Data API grants. service_role only. Same end state as 079.
revoke all on table public.airchecks from public;
revoke all on table public.airchecks from anon;
revoke all on table public.airchecks from authenticated;
grant select, insert, update, delete on table public.airchecks to service_role;

alter table public.airchecks enable row level security;
