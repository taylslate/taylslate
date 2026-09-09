-- ============================================================
-- 035: shows.podscan_id
--
-- Key for Podscan podcast-level endpoints — GET /podcasts/{id}/demographics
-- (audience-fit demographics, Premium+) and any future per-podcast call.
-- Set at discovery ingest (podscanPodcastToShow → createShow) and by the
-- demographics backfill script. Null for YouTube-only and unmatched shows.
--
-- Deliberately NOT unique: accept-materialized non-catalog rows (the otr-
-- slug namespace, migration 031) can legitimately duplicate a catalog
-- show's podcast. Partial index for lookups only.
--
-- shows is a pre-020 table — Data API grants are grandfathered; the new
-- column inherits them (no grant block needed).
--
-- Idempotent: safe to re-run.
-- ============================================================

ALTER TABLE public.shows
  ADD COLUMN IF NOT EXISTS podscan_id TEXT;

COMMENT ON COLUMN public.shows.podscan_id IS
  'Podscan podcast id (pd_...). Key for /podcasts/{id}/* endpoints (demographics). Set at discovery ingest / backfill; NULL for YouTube-only and unmatched shows. Not unique: otr- materialized rows may duplicate a catalog podcast.';

CREATE INDEX IF NOT EXISTS idx_shows_podscan_id
  ON public.shows (podscan_id)
  WHERE podscan_id IS NOT NULL;

-- Introspection check (run after applying):
--   SELECT column_name FROM information_schema.columns
--    WHERE table_schema = 'public' AND table_name = 'shows' AND column_name = 'podscan_id';
--   SELECT indexname FROM pg_indexes
--    WHERE schemaname = 'public' AND tablename = 'shows' AND indexname = 'idx_shows_podscan_id';
