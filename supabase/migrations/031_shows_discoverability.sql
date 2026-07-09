-- ============================================================
-- Migration 031: shows.is_discoverable — non-discoverable flag
-- ============================================================
-- WHY THIS EXISTS (accept-flow launch-blocker cluster, July 2026):
--   When a NON-CATALOG outreach is accepted, the accept path materializes a
--   `shows` row so the NOT NULL `deals.show_id` FK can be satisfied and the
--   deal can be created at accept time. That row is a transaction artifact —
--   it must NOT leak into shared, brand-facing discovery inventory. This flag
--   is the exclusion switch every discovery/catalog read filters on.
--
--   Promotion of such a show INTO discovery is a deliberate, post-launch
--   action (flip the flag) — this migration does not build promotion logic.
--
--   Seeded test shows (name prefix '[SEED] ') get the same flag, replacing the
--   name-prefix-only convention with a real read-time exclusion.
--
-- DEFAULT TRUE is intentional: every existing catalog row and every
-- Podscan/YouTube-discovered row (persisted via createShow during discovery)
-- stays discoverable. Only accept-materialized non-catalog shows and seeds
-- are written FALSE.
--
-- NOTE — deals.show_profile_id is NOT touched here. The resolved decision to
-- create a deal at accept time even before the show has onboarded (with
-- show_profile_id NULL, backfilled at onboarding completion) needs NO schema
-- change: show_profile_id has been nullable since migration 013 (only the RLS
-- predicate references NOT NULL, not the column). That behavior is a code-only
-- change.
--
-- Idempotent. Re-running is safe.
-- No Data API grant block: `shows` is a grandfathered table (001-019); new
-- columns inherit the table grants (see migration 020 / CLAUDE.md conventions).
-- No index: the common discovery read filters is_discoverable = TRUE (low
-- selectivity, most rows), so an index would not help; the rare FALSE rows are
-- never queried in bulk.
-- ============================================================

ALTER TABLE public.shows
  ADD COLUMN IF NOT EXISTS is_discoverable BOOLEAN NOT NULL DEFAULT TRUE;

COMMENT ON COLUMN public.shows.is_discoverable IS
  'Migration 031. FALSE excludes the show from ALL shared brand-facing discovery/catalog reads (getAllShows, getShowsFiltered, and defense-in-depth on the scoring cost reads). Written FALSE for accept-materialized non-catalog shows and for seeded ([SEED]) test shows. Default TRUE keeps every catalog + Podscan/YouTube-discovered show visible. Promotion into discovery is a deliberate post-launch flag flip.';

-- One-time data backfill: existing seeded shows become non-discoverable.
-- Idempotent — the is_discoverable = TRUE guard makes a re-run a no-op.
-- '[' and ']' are literal in SQL LIKE (only % and _ are wildcards).
UPDATE public.shows
  SET is_discoverable = FALSE
  WHERE name LIKE '[SEED] %'
    AND is_discoverable = TRUE;
