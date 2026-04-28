-- Wave 13: event_log — fine-grained metering / analytics record of every
-- billable or interesting product operation per customer (campaign generated,
-- discovery run, IO generated, outreach sent, future API calls, etc.).
--
-- This table is intentionally separate from `domain_events` (the audit log).
-- domain_events captures state transitions of business entities (deals,
-- envelopes, outreach) with fat payloads for replay; event_log captures the
-- thin "this customer used this product feature at this time" signal that
-- powers metering, GMV-based conversion alerts, and (eventually) per-call API
-- billing. They have different retention, access, and shape requirements;
-- merging them now would force compromises on both sides.
--
-- Idempotent: safe to re-run.

CREATE TABLE IF NOT EXISTS public.event_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id     UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  timestamp       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  operation_type  TEXT NOT NULL,
  metadata        JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.event_log IS
  'Per-customer metering/analytics events (Wave 13). Separate from domain_events (which is the entity-state audit log). Service-role write only; powers GMV-based conversion alerts and future API metering.';

CREATE INDEX IF NOT EXISTS idx_event_log_customer_timestamp
  ON public.event_log(customer_id, timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_event_log_operation_timestamp
  ON public.event_log(operation_type, timestamp DESC);

ALTER TABLE public.event_log ENABLE ROW LEVEL SECURITY;

-- No permissive policies. Service role bypasses RLS by default; this
-- intentional deny-by-omission means anon/authenticated users cannot
-- read or write event_log directly. When we expose customer-facing
-- metering UI in a future wave, we'll add a scoped SELECT policy then.

DROP POLICY IF EXISTS "No user access to event_log" ON public.event_log;
-- (Intentionally omitted: no permissive policy = no access for anon/auth users.)
