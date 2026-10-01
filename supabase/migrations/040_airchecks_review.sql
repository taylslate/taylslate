-- ============================================================
-- 040: airchecks — human review before a charge
--
-- Step 3 of delivery verification. An admin reads the match evidence
-- for one IO line and either confirms or rejects it.
--
-- review_decision:
--   confirmed — the person confirmed and the existing charge path
--               succeeded. Never set when the charge failed.
--   rejected  — the person rejected the line. The charge path is not
--               called.
--   null      — no completed decision. A failed confirm leaves this
--               null and writes charge_error.
--
-- A match (match_result) is still data. Nothing in this migration
-- marks a line delivered or creates a payment. No backfill.
--
-- Idempotent. Safe to re-run. New columns on a grandfathered table
-- inherit airchecks grants (service_role only). No new grant block.
--
-- Introspection check (run after applying):
--   select column_name, data_type, is_nullable
--     from information_schema.columns
--    where table_schema = 'public' and table_name = 'airchecks'
--      and column_name in (
--        'review_decision', 'review_reason', 'decided_by',
--        'decided_at', 'charge_error'
--      )
--    order by column_name;
--   select conname, pg_get_constraintdef(oid)
--     from pg_constraint
--    where conrelid = 'public.airchecks'::regclass
--      and conname = 'airchecks_review_decision_check';
-- ============================================================

alter table public.airchecks
  add column if not exists review_decision text,
  add column if not exists review_reason text,
  add column if not exists decided_by text,
  add column if not exists decided_at timestamptz,
  add column if not exists charge_error text;

alter table public.airchecks drop constraint if exists airchecks_review_decision_check;
alter table public.airchecks
  add constraint airchecks_review_decision_check
  check (
    review_decision is null
    or review_decision in ('confirmed', 'rejected')
  );

comment on column public.airchecks.review_decision is
  'Aircheck step 3. confirmed only after the charge succeeds. rejected stores a human rejection and does not charge. Null until a decision completes.';
comment on column public.airchecks.review_reason is
  'Optional note typed with a rejection. Null on confirm.';
comment on column public.airchecks.decided_by is
  'Email of the internal admin who confirmed or rejected the line.';
comment on column public.airchecks.decided_at is
  'When the completed confirm or reject was stored.';
comment on column public.airchecks.charge_error is
  'Last confirm whose charge failed. Cleared when a later confirm succeeds. The line is not review_decision confirmed while this stands alone.';
