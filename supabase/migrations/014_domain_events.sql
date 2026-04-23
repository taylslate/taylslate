-- Wave 12: domain_events — append-only audit log of every state transition
-- on the platform. Future webhooks and the MCP server will subscribe to this
-- table; agents will replay it for context. Fat payloads (full entity
-- snapshots) so historical replays don't need joins to long-mutated tables.
--
-- Idempotent: safe to re-run.

CREATE TABLE IF NOT EXISTS public.domain_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type      TEXT NOT NULL,
  entity_type     TEXT NOT NULL,
  entity_id       UUID NOT NULL,
  actor_id        UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  payload         JSONB NOT NULL,
  schema_version  TEXT NOT NULL DEFAULT 'v1',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_domain_events_entity
  ON public.domain_events(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_domain_events_type_created
  ON public.domain_events(event_type, created_at);

ALTER TABLE public.domain_events ENABLE ROW LEVEL SECURITY;

-- No user reads, no user writes. Service role bypasses RLS by default; this
-- explicit deny-by-omission is intentional. Wave 13+ will introduce signed
-- subscription endpoints; until then events are server-internal.

DROP POLICY IF EXISTS "No user access to domain_events" ON public.domain_events;
-- (Intentionally omitted: no permissive policy = no access for anon/auth users.)
