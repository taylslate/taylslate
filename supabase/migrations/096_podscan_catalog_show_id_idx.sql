-- ============================================================
-- 096: Partial index on podscan_catalog.show_id
--
-- NOT applied. Apply only after merge and Chris's OK.
-- Apply on ldtmhafewfifdizgfrnn only after merge and Chris's OK.
-- Paste into the Supabase SQL Editor. Do not run this from
-- the app, a seed script, or a deploy hook.
--
-- show_id is null on most rows. The index covers only the
-- rows that link to public.shows. It does not change grants,
-- policies, or the table.
--
-- Idempotent. Safe to re-run.
--
-- Introspection (run after applying, read only):
--   select indexname, indexdef
--     from pg_indexes
--    where schemaname = 'public'
--      and tablename = 'podscan_catalog'
--      and indexname = 'podscan_catalog_show_id_idx';
--   Expected: 1 row, and indexdef contains "WHERE (show_id IS NOT NULL)".
-- ============================================================

create index if not exists podscan_catalog_show_id_idx
  on public.podscan_catalog (show_id)
  where show_id is not null;
