-- ============================================================
-- Migration 024: Layer 4 Atomic Interpretation Persist (Wave 14 Phase 2A)
-- ============================================================
-- Backs the Layer 4 second-amendment lock-lifecycle redesign.
--
-- persist_interpretation() writes a whole brief interpretation —
--   campaign_patterns + every ring_hypotheses row + every analog_matches row
-- — inside ONE transaction (the implicit transaction of the RPC call). The
-- campaign_patterns row therefore only becomes visible once the entire
-- interpretation is committed, so:
--
--   * a concurrent lock-loser polling for the pattern row can never replay a
--     half-written interpretation (it sees the whole thing or nothing), and
--   * a crash mid-write leaves NO orphan pattern row (the transaction rolls
--     back), so the replay guard is never fed a partial row.
--
-- The campaign_patterns row's existence is the completion sentinel; the
-- interpret endpoint's interpretation_locks sentinel handles mutual exclusion
-- and crash-orphan expiry (TTL on created_at) in application code.
--
-- IMPORTANT: the endpoint calls this RPC only AFTER the LLM returns. The
-- transaction here opens and closes in milliseconds; the model call must
-- never sit inside it.
--
-- Per-analog inserts are wrapped in a sub-block that catches ONLY
-- foreign_key_violation (a racing/deleted analog pattern), so a stray analog
-- is skipped without rolling back the core pattern+rings — while any other
-- error still propagates and rolls the whole transaction back (no silent
-- swallowing of genuine bugs). Deliberately a narrow handler, not a catch-all.
--
-- Idempotent: CREATE OR REPLACE FUNCTION. Re-running this migration is safe.
-- No new table, so no Data API table-grant block — the function instead needs
-- an EXECUTE grant (service_role only; mirrors interpretation_locks).

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
      campaign_pattern_id, kind, label, reasoning, confidence, brand_decision
    ) VALUES (
      v_pattern_id,
      v_ring->>'kind',
      v_ring->>'label',
      v_ring->>'reasoning',
      v_ring->>'confidence',
      'pending'
    )
    RETURNING id INTO v_ring_id;
    v_ring_ids := v_ring_ids || jsonb_build_object(v_ring->>'label', v_ring_id::text);
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

-- Execute grant (REQUIRED for supabaseAdmin.rpc to resolve via the Data API).
-- service_role only — interpretation persistence runs through the admin
-- client; no authenticated or anon execute. Deliberate.
GRANT EXECUTE ON FUNCTION public.persist_interpretation(
  uuid, uuid, jsonb, text, text, jsonb, jsonb, jsonb
) TO service_role;

-- ====================
-- Done
-- ====================
