-- ============================================================
-- Migration 026: Medium-awareness schema fold-in (Wave 14 Phase 2B)
-- ============================================================
-- Reserves two JSONB columns on `shows` so the discovery layer is not
-- re-migrated when full medium-aware scoring lands later. 2B populates
-- these LIGHT (simulcast identity + minimal medium priors); the structure
-- is forward-compatible with medium-differentiated scoring math (deferred).
--
--   shows.surfaces       JSONB, nullable, default null.
--                        Simulcast: the same show on podcast + long-form
--                        YouTube, merged into one record carrying both
--                        surfaces. Single-surface shows leave it null.
--                        Light 2B shape: { podcast?: {...}, youtube?: {...} }
--   shows.medium_priors  JSONB, nullable, default null.
--                        Medium-specific priors (CPM range, engagement
--                        weight, frequency norms). Populated light for
--                        launch; structure reserved so full medium-aware
--                        scoring lands with no re-migration.
--
-- Idempotent. Re-running is safe.
-- No Data API grant block: `shows` is an existing (grandfathered) table;
-- column access inherits the table grants. Adding columns needs no GRANTs.

ALTER TABLE shows
  ADD COLUMN IF NOT EXISTS surfaces JSONB DEFAULT NULL;

ALTER TABLE shows
  ADD COLUMN IF NOT EXISTS medium_priors JSONB DEFAULT NULL;

COMMENT ON COLUMN shows.surfaces IS
  'Wave 14 Phase 2B. Simulcast surfaces for one show present on both podcast + long-form YouTube, merged into a single record. Light shape: {podcast?: {...}, youtube?: {...}}. Null for single-surface shows.';

COMMENT ON COLUMN shows.medium_priors IS
  'Wave 14 Phase 2B. Medium-specific scoring priors (CPM range, engagement weight, frequency norms). Populated light for launch; structure reserved for full medium-aware scoring math (deferred). Null when unset.';
