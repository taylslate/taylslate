-- ============================================================
-- Migration 021: ring_hypotheses.brand_decision (Wave 14 Phase 2A)
-- ============================================================
-- Phase 1 shipped ring_hypotheses with a BOOLEAN brand_confirmed column.
-- Phase 2A needs five-state brand decision tracking:
--
--   pending        — AI proposed, brand hasn't responded
--   confirmed      — brand accepted this ring
--   rejected       — brand skipped this ring
--   refined        — brand refined this ring (a new row replaces this one)
--   added_by_brand — brand added a ring the AI missed
--
-- Additive only. brand_confirmed is preserved and stays readable, but
-- new code writes brand_decision. The boolean is marked DEPRECATED in
-- both the column comment and the TypeScript type.
--
-- Idempotent. Re-running this migration is safe.
-- ============================================================


-- Add the new column with default 'pending'. NOT NULL is safe because of
-- the default, even for any pre-existing rows.
ALTER TABLE ring_hypotheses
  ADD COLUMN IF NOT EXISTS brand_decision TEXT NOT NULL DEFAULT 'pending';

-- Check constraint. Drop-then-add for idempotency.
ALTER TABLE ring_hypotheses
  DROP CONSTRAINT IF EXISTS ring_hypotheses_brand_decision_check;
ALTER TABLE ring_hypotheses
  ADD CONSTRAINT ring_hypotheses_brand_decision_check
  CHECK (brand_decision IN ('pending', 'confirmed', 'rejected', 'refined', 'added_by_brand'));


-- Backfill from brand_confirmed for any pre-existing rows. Per spec:
--   true  -> 'confirmed'
--   false -> 'pending'   (no historical 'rejected' inference)
--   null  -> 'pending'   (already the default; no-op)
--
-- Filtering on `brand_decision = 'pending'` makes the backfill idempotent —
-- re-running the migration won't overwrite a row that has since moved off
-- 'pending'.
UPDATE ring_hypotheses
  SET brand_decision = 'confirmed'
  WHERE brand_confirmed IS TRUE
    AND brand_decision = 'pending';


-- Composite index for the common query pattern: "what did the brand
-- decide for this campaign?"
CREATE INDEX IF NOT EXISTS idx_ring_hypotheses_brand_decision
  ON ring_hypotheses(campaign_pattern_id, brand_decision);


COMMENT ON COLUMN ring_hypotheses.brand_decision IS
  'Brand response to this hypothesis. Five states: pending | confirmed | rejected | refined | added_by_brand. Wave 14 Phase 2A.';

COMMENT ON COLUMN ring_hypotheses.brand_confirmed IS
  'DEPRECATED (Wave 14 Phase 2A): use brand_decision instead. Preserved for backwards compatibility; not written by new code.';
