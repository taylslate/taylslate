-- ============================================================
-- 039: airchecks — match judgment for one stored transcript
--
-- Step 2 of delivery verification. The admin aircheck route transcribes
-- when the row is not already transcribed, then writes whether that
-- transcript contains the read the IO describes.
--
-- A match is data only. It does not set io_line_items.verified and does
-- not create a payment.
--
-- match_result:
--   matched      — brand and (promo code or brand URL) are in the transcript
--   not_matched  — the transcript was judged and that pair was not found
--   skipped      — no transcript, or status is not transcribed; the reason
--                  is in match_evidence
--   null         — step 2 has not run for this row
--
-- Read length and talking points are not columns on io_line_items,
-- insertion_orders, or deals. match_evidence.length stays missing.
-- Position uses io_line_items.placement. No backfill.
--
-- Idempotent. Safe to re-run.
--
-- Introspection check (run after applying):
--   select column_name, data_type, is_nullable
--     from information_schema.columns
--    where table_schema = 'public' and table_name = 'airchecks'
--      and column_name in ('match_result', 'match_evidence', 'matched_at')
--    order by column_name;
--   select conname from pg_constraint
--    where conrelid = 'public.airchecks'::regclass
--      and conname = 'airchecks_match_result_check';
-- ============================================================

alter table public.airchecks
  add column if not exists match_result text,
  add column if not exists match_evidence jsonb,
  add column if not exists matched_at timestamptz;

alter table public.airchecks drop constraint if exists airchecks_match_result_check;
alter table public.airchecks
  add constraint airchecks_match_result_check
  check (
    match_result is null
    or match_result in ('matched', 'not_matched', 'skipped')
  );

comment on column public.airchecks.match_result is
  'Aircheck step 2. matched, not_matched, or skipped. Null until a match run. Does not mark the line delivered.';
comment on column public.airchecks.match_evidence is
  'Excerpt plus found/missing for brand, code or URL, position, and length. reason is set when match_result is skipped.';
comment on column public.airchecks.matched_at is
  'When a transcribed row was judged. Null when the run was skipped.';
