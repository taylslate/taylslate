-- Migration 027 — Wave 14 Phase 2B Layer 5 follow-up: discovery lock.
--
-- Closes the cross-tab race on the discover POST. Two browser tabs (or a
-- reload mid-run) can each auto-fire POST /api/campaigns/[id]/discover during
-- the ~30-60s window, double-spending the 3-6 concurrent LLM reasoning calls
-- (Layer 4). The view's in-memory in-flight latch only guards a single mount;
-- this table is the server-side mutex, keyed on campaign_id.
--
-- Unlike interpretation_locks (a permanent completion marker the replay guard
-- short-circuits on), a discovery lock is RELEASED after every run — discovery
-- is intentionally re-runnable ("Re-run discovery" + idempotent re-POST that
-- clears and rewrites scores). The row exists only for the duration of an
-- in-flight run; a crash-orphan is stolen by the TTL in
-- lib/data/discovery-lock.ts (DISCOVERY_LOCK_TTL_MS), set well above the
-- worst-case run so a slow-but-live run is never stolen and a late release can
-- never clobber a successor's lock.
--
-- Fail-open by design: the lock helpers degrade to the pre-lock behavior on any
-- infra error, so a missing/unreachable table never blocks discovery. Safe to
-- ship before this migration runs; apply it to actually close the race.
--
-- Idempotent; safe to re-run. Verify by introspection after applying
-- (CLAUDE.md: "applied" means confirmed present in the live schema).

CREATE TABLE IF NOT EXISTS discovery_locks (
  campaign_id UUID PRIMARY KEY REFERENCES campaigns(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- Data API grants (REQUIRED — see Supabase Data API breaking change).
-- service_role only: locks are claimed/released exclusively through the admin
-- client. No authenticated or anon access — deliberate (server-only mutex).
grant select, insert, update, delete on public.discovery_locks to service_role;

ALTER TABLE discovery_locks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role can manage all discovery_locks"
  ON discovery_locks;
CREATE POLICY "Service role can manage all discovery_locks"
  ON discovery_locks FOR ALL TO service_role USING (true) WITH CHECK (true);
