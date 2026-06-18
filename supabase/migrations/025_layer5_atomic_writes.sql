-- ============================================================
-- Migration 025: Layer 5 Atomic Writes (Wave 14 Phase 2A amendment)
-- ============================================================
-- Closes the two Layer 5 atomicity holes Codex flagged. Both refine and
-- confirm were multi-row writes done as a SEQUENCE of separate Supabase
-- calls: a mid-sequence failure left the DB half-written yet the endpoint
-- still returned 200. This is the same class of bug Layer 4 fixed with
-- persist_interpretation (migration 024); the fix is the same pattern — move
-- each multi-row write into ONE Postgres transaction behind an RPC.
--
--   persist_refinement()   — insert the replacement ring AND mark the old
--                            ring 'refined' in one transaction. Either both
--                            commit or neither does.
--   persist_confirmation() — validate every {id, decision} and write all
--                            brand decisions in one transaction. A bad entry
--                            (unknown ring, refined ring, invalid decision)
--                            raises and rolls the whole confirm back.
--
-- Also adds ring_hypotheses.slot_position so the interpretation page renders
-- rings in a STABLE order across reloads: a refined ring's replacement
-- inherits its predecessor's slot, brand-added rings take the next slot, so
-- reconstruction sorts by slot_position instead of created_at (a refinement
-- has a later created_at but must stay in the same visual slot).
--
-- Security model mirrors migration 024 exactly: invoker rights (the call
-- path is the service_role admin client; EXECUTE is granted to service_role
-- only, so invoker and definer rights are equivalent here and invoker is the
-- defensive default), search_path pinned, and no blunt catch-all exception
-- handler that would swallow genuine bugs.
--
-- Idempotent: ADD COLUMN/CREATE INDEX IF NOT EXISTS, backfill guarded on
-- IS NULL, CREATE OR REPLACE FUNCTION. Re-running this migration is safe.

-- ====================
-- ring_hypotheses.slot_position
-- ====================

ALTER TABLE ring_hypotheses
  ADD COLUMN IF NOT EXISTS slot_position INT;

COMMENT ON COLUMN ring_hypotheses.slot_position IS
  'Stable display slot within a pattern. primary=0, laterals 1..n in proposal order; a refinement inherits its predecessor''s slot, a brand-added ring takes the next slot. Reconstruction sorts by this, not created_at. Wave 14 Phase 2A Layer 5.';

-- Backfill pre-existing rows: position by created_at within each pattern.
-- Guarded on slot_position IS NULL so re-running is a no-op.
WITH ordered AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY campaign_pattern_id ORDER BY created_at
    ) - 1 AS pos
  FROM ring_hypotheses
  WHERE slot_position IS NULL
)
UPDATE ring_hypotheses r
  SET slot_position = ordered.pos
  FROM ordered
  WHERE r.id = ordered.id
    AND r.slot_position IS NULL;

CREATE INDEX IF NOT EXISTS idx_ring_hypotheses_slot
  ON ring_hypotheses(campaign_pattern_id, slot_position);

-- ====================
-- persist_interpretation (re-defined: now assigns slot_position)
-- ====================
-- Unchanged from migration 024 except each ring is written with a
-- slot_position from a 0-based loop counter. Rings arrive primary-first
-- (see interpret/route.ts), so primary=0 and laterals=1..n in order. The
-- per-analog handler stays scoped to foreign_key_violation only.

CREATE OR REPLACE FUNCTION public.persist_interpretation(
  p_campaign_id uuid,
  p_customer_id uuid,
  p_product_attributes jsonb,
  p_customer_description text,
  p_aov_bucket text,
  p_scoring_weights jsonb,
  p_rings jsonb,
  p_analogs jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_pattern_id uuid;
  v_ring jsonb;
  v_ring_id uuid;
  v_analog jsonb;
  v_ring_ids jsonb := '{}'::jsonb;
  v_slot int := 0;
BEGIN
  INSERT INTO campaign_patterns (
    campaign_id, customer_id, product_attributes,
    customer_description, aov_bucket, scoring_weights
  ) VALUES (
    p_campaign_id,
    p_customer_id,
    COALESCE(p_product_attributes, '{}'::jsonb),
    p_customer_description,
    p_aov_bucket,
    p_scoring_weights
  )
  RETURNING id INTO v_pattern_id;

  FOR v_ring IN
    SELECT * FROM jsonb_array_elements(COALESCE(p_rings, '[]'::jsonb))
  LOOP
    INSERT INTO ring_hypotheses (
      campaign_pattern_id, kind, label, reasoning, confidence, brand_decision,
      slot_position
    ) VALUES (
      v_pattern_id,
      v_ring->>'kind',
      v_ring->>'label',
      v_ring->>'reasoning',
      v_ring->>'confidence',
      'pending',
      v_slot
    )
    RETURNING id INTO v_ring_id;
    v_ring_ids := v_ring_ids || jsonb_build_object(v_ring->>'label', v_ring_id::text);
    v_slot := v_slot + 1;
  END LOOP;

  FOR v_analog IN
    SELECT * FROM jsonb_array_elements(COALESCE(p_analogs, '[]'::jsonb))
  LOOP
    BEGIN
      INSERT INTO analog_matches (
        campaign_pattern_id, analog_name, reasoning, analog_pattern_id
      ) VALUES (
        v_pattern_id,
        v_analog->>'analog_name',
        v_analog->>'reasoning',
        NULLIF(v_analog->>'analog_pattern_id', '')::uuid
      );
    EXCEPTION WHEN foreign_key_violation THEN
      -- A racing/deleted analog pattern. Skip this citation; keep the core
      -- pattern+rings. Any other error is NOT caught here and rolls back.
      RAISE WARNING 'persist_interpretation: skipped analog % (fk violation)',
        v_analog->>'analog_name';
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'pattern_id', v_pattern_id::text,
    'ring_ids', v_ring_ids
  );
END;
$$;

-- ====================
-- persist_refinement
-- ====================
-- One transaction: insert the replacement ring (inheriting the old ring's
-- slot_position) AND mark the old ring 'refined'. The old ring must still
-- exist, belong to the pattern, and not already be refined — IF NOT FOUND
-- raises (rolls back; the app already guards this before calling, so a raise
-- here means a rare concurrent change → the route surfaces a 500). No
-- EXCEPTION block: any failure of either statement propagates and rolls the
-- whole thing back. Deliberately no blunt catch-all handler.

CREATE OR REPLACE FUNCTION public.persist_refinement(
  p_old_ring_id uuid,
  p_campaign_pattern_id uuid,
  p_kind text,
  p_label text,
  p_reasoning text,
  p_confidence text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_slot int;
  v_new_id uuid;
BEGIN
  SELECT slot_position INTO v_slot
  FROM ring_hypotheses
  WHERE id = p_old_ring_id
    AND campaign_pattern_id = p_campaign_pattern_id
    AND brand_decision <> 'refined'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'persist_refinement: old ring % not refinable for pattern %',
      p_old_ring_id, p_campaign_pattern_id
      USING ERRCODE = 'no_data_found';
  END IF;

  INSERT INTO ring_hypotheses (
    campaign_pattern_id, kind, label, reasoning, confidence, brand_decision,
    slot_position
  ) VALUES (
    p_campaign_pattern_id,
    p_kind,
    p_label,
    p_reasoning,
    p_confidence,
    'pending',
    v_slot
  )
  RETURNING id INTO v_new_id;

  UPDATE ring_hypotheses
    SET brand_decision = 'refined'
    WHERE id = p_old_ring_id;

  RETURN jsonb_build_object(
    'new_ring_id', v_new_id::text,
    'slot_position', v_slot
  );
END;
$$;

-- ====================
-- persist_confirmation
-- ====================
-- One transaction: validate AND write every brand decision. For each entry:
--   * decision must be one the brand can set (confirmed/rejected/added_by_brand)
--   * the ring must belong to the pattern AND not be 'refined'
-- Any validation failure raises with SQLSTATE 'PT400' — the route maps that
-- to a 400 (a malformed/stale request). Refined rings are excluded by the
-- membership check, so a refined ring in the body is rejected, not silently
-- skipped. Any other failure propagates with its own SQLSTATE → the route
-- returns 500. Deliberately no blunt catch-all handler. Returns the counts.

CREATE OR REPLACE FUNCTION public.persist_confirmation(
  p_campaign_pattern_id uuid,
  p_decisions jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_entry jsonb;
  v_ring_id uuid;
  v_decision text;
  v_confirmed int := 0;
  v_rejected int := 0;
  v_exists boolean;
BEGIN
  FOR v_entry IN
    SELECT * FROM jsonb_array_elements(COALESCE(p_decisions, '[]'::jsonb))
  LOOP
    v_ring_id := NULLIF(v_entry->>'id', '')::uuid;
    v_decision := v_entry->>'decision';

    IF v_decision NOT IN ('confirmed', 'rejected', 'added_by_brand') THEN
      RAISE EXCEPTION 'persist_confirmation: invalid decision %', v_decision
        USING ERRCODE = 'PT400';
    END IF;

    SELECT true INTO v_exists
    FROM ring_hypotheses
    WHERE id = v_ring_id
      AND campaign_pattern_id = p_campaign_pattern_id
      AND brand_decision <> 'refined';

    IF NOT FOUND THEN
      RAISE EXCEPTION 'persist_confirmation: ring % not valid for pattern %',
        v_ring_id, p_campaign_pattern_id
        USING ERRCODE = 'PT400';
    END IF;

    UPDATE ring_hypotheses
      SET brand_decision = v_decision
      WHERE id = v_ring_id;

    IF v_decision = 'rejected' THEN
      v_rejected := v_rejected + 1;
    ELSE
      v_confirmed := v_confirmed + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'confirmed', v_confirmed,
    'rejected', v_rejected
  );
END;
$$;

-- ====================
-- Execute grants (REQUIRED for supabaseAdmin.rpc to resolve via the Data API).
-- service_role only — Layer 5 writes run through the admin client; no
-- authenticated or anon execute. Deliberate. Idempotent (GRANT re-runs safely).
-- ====================

GRANT EXECUTE ON FUNCTION public.persist_interpretation(
  uuid, uuid, jsonb, text, text, jsonb, jsonb, jsonb
) TO service_role;

GRANT EXECUTE ON FUNCTION public.persist_refinement(
  uuid, uuid, text, text, text, text
) TO service_role;

GRANT EXECUTE ON FUNCTION public.persist_confirmation(
  uuid, jsonb
) TO service_role;

-- ====================
-- Done
-- ====================
