-- ============================================================
-- Migration 030: Per-deal promo code (Wave 14 Phase 2D — Layer A)
-- ============================================================
-- Captures the promotional code a show reads on air for a given deal
-- (e.g. "get 20% off, code HUBERMAN"). By podcasting convention the code
-- matches the show name ~99% of the time, so the UI prefills a show-name
-- slug at IO time; the brand may edit or clear it. Optional per deal.
--
--   deals.promo_code  TEXT, nullable, default null.
--                     Null until the brand explicitly saves a code — an
--                     untouched deal never carries a phantom code, so the
--                     column is a clean conversion-attribution signal.
--
-- Idempotent. Re-running is safe.
-- No Data API grant block: `deals` is an existing (grandfathered) table,
-- created in 001_initial_schema.sql — pre-020, so it is covered by the
-- table-level grants in migration 020. Columns added later inherit those
-- grants; adding a column needs no GRANTs.

ALTER TABLE public.deals
  ADD COLUMN IF NOT EXISTS promo_code TEXT;

COMMENT ON COLUMN public.deals.promo_code IS
  'Wave 14 Phase 2D. Per-deal promo code read on air for conversion attribution. Uppercase alphanumeric slug, defaulted from the show name at IO time, brand-editable and optional. Null until the brand explicitly saves one.';
