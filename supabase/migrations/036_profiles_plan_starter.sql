-- ============================================================
-- 036: widen profiles.plan to include 'starter'
--
-- Locked 2026-09-28 pricing adds Starter between pay_as_you_go
-- (customer-facing label Free) and operator. This only widens the
-- CHECK. It does not backfill rows and does not change
-- platform_fee_percentage or its 0.10 default.
--
-- profiles is a pre-020 table. No new table, so no Data API grant
-- block. The new value inherits the column's existing grants.
--
-- Idempotent: drop-then-add the CHECK. Safe to re-run.
-- ============================================================

alter table public.profiles drop constraint if exists profiles_plan_check;

alter table public.profiles
  add constraint profiles_plan_check
  check (plan in ('pay_as_you_go', 'starter', 'operator', 'agency'));

-- Introspection check (run after applying):
--   select pg_get_constraintdef(oid)
--     from pg_constraint
--    where conname = 'profiles_plan_check';
--   Expected: CHECK ((plan = ANY (ARRAY['pay_as_you_go'::text, 'starter'::text, 'operator'::text, 'agency'::text])))
