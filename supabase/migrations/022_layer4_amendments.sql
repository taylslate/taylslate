-- ============================================================
-- Migration 022: Layer 4 Amendments (Wave 14 Phase 2A)
-- ============================================================
-- Two changes backing the Layer 4 interpretation hardening pass:
--
--   analog_matches.analog_pattern_id — FK to the campaign_patterns row the
--     cited analog came from. Until now analogs were recorded by brand name
--     only; the FK lets future retrieval walk from a citation back to the
--     full prior campaign record.
--
--   interpretation_locks — sentinel rows that make the interpret endpoint's
--     idempotency guard atomic. One row per (campaign, brief version);
--     concurrent POSTs race on the primary key and exactly one wins.
--     brief_submitted_at is TEXT on purpose: it is an opaque brief-version
--     key, so a malformed timestamp can never break the claim insert.
--
-- All idempotent. Re-running this migration is safe.

-- ====================
-- analog_matches.analog_pattern_id
-- ====================

ALTER TABLE analog_matches
  ADD COLUMN IF NOT EXISTS analog_pattern_id UUID
  REFERENCES campaign_patterns(id) ON DELETE SET NULL;

COMMENT ON COLUMN analog_matches.analog_pattern_id IS
  'The campaign_patterns row the cited analog was retrieved from. NULL on rows written before migration 022 or when the analog had no library row.';

CREATE INDEX IF NOT EXISTS idx_analog_matches_analog_pattern
  ON analog_matches(analog_pattern_id);

-- ====================
-- interpretation_locks
-- ====================

CREATE TABLE IF NOT EXISTS interpretation_locks (
  campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  -- Opaque brief-version key: the brief's submitted_at string verbatim.
  brief_submitted_at TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  PRIMARY KEY (campaign_id, brief_submitted_at)
);

-- Data API grants (REQUIRED — see Supabase Data API breaking change).
-- service_role only: locks are claimed/released exclusively through the
-- admin client. No authenticated or anon access — deliberate.
grant select, insert, update, delete on public.interpretation_locks to service_role;

ALTER TABLE interpretation_locks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role can manage all interpretation_locks"
  ON interpretation_locks;
CREATE POLICY "Service role can manage all interpretation_locks"
  ON interpretation_locks FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ====================
-- Done
-- ====================
