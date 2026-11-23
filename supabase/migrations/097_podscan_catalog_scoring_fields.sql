-- ============================================================
-- 097: Scoring fields on podscan_catalog
--
-- NOT applied. The CEO must name 097 before it is applied.
-- Apply on ldtmhafewfifdizgfrnn only after merge, and only when
-- the CEO names 097.
-- Paste into the Supabase SQL Editor. Do not run this from
-- the app, a seed script, or a deploy hook.
--
-- Adds podcast_reach_score, brand_safety, and sponsor_history
-- to the internal catalog. RLS stays as 093 left it. No new
-- policy. No grant to anon or authenticated. New columns
-- inherit the table's service_role grants.
--
-- Idempotent. Safe to re-run.
--
-- Introspection (run after applying, read only):
--   select column_name, data_type
--     from information_schema.columns
--    where table_schema = 'public'
--      and table_name = 'podscan_catalog'
--      and column_name in ('podcast_reach_score', 'brand_safety', 'sponsor_history')
--    order by column_name;
--   Expected: 3 rows.
-- ============================================================

alter table public.podscan_catalog
  add column if not exists podcast_reach_score double precision;

alter table public.podscan_catalog
  add column if not exists brand_safety jsonb;

alter table public.podscan_catalog
  add column if not exists sponsor_history jsonb;

comment on column public.podscan_catalog.podcast_reach_score is
  'Podscan reach score from the search hit or a later detail call. Internal only.';

comment on column public.podscan_catalog.brand_safety is
  'Podscan brand_safety object stored as returned. It does not exclude shows.';

comment on column public.podscan_catalog.sponsor_history is
  'Sponsor names and episode counts from podcast analysis. Null when Podscan has none.';
