// Sentinel-row lock for the discovery endpoint (Wave 14 Phase 2B Layer 5).
//
// The discover POST runs 3-6 concurrent LLM reasoning calls and takes ~30-60s.
// The view auto-fires it on first landing, and its in-memory in-flight latch
// stops a SINGLE mount from double-firing (auto-fire + manual + StrictMode +
// double-click). It cannot stop two independent page loads — a second tab, or a
// reload mid-run — from each firing during that window and double-spending the
// LLM calls. The discovery_locks table (migration 027) closes that race: its
// primary key on campaign_id means exactly one concurrent claim insert
// succeeds; the loser sees a unique violation and the route returns 409 without
// running discovery.
//
// Lock lifecycle (claimed -> released | stolen):
//   claimed  — a row exists; a writer is running discovery for this campaign.
//   released — the run finished (success OR failure) and the route deleted the
//              row in a finally. Discovery is intentionally re-runnable, so the
//              lock is NOT a permanent marker (contrast interpretation_locks).
//   stolen   — a claimed row older than DISCOVERY_LOCK_TTL_MS is a crash-orphan
//              (the writer died without releasing); the next claim deletes and
//              re-inserts it. The TTL is set above the worst-case run so a slow
//              live writer is never stolen.
//
// Fail-open on infrastructure errors: an unreachable/missing lock table
// degrades to the pre-lock behavior (possible duplicate run), never a blocked
// discovery. Matches the fail-soft spirit of reasoning-log.ts and mirrors
// interpretation-lock.ts exactly.

import { supabaseAdmin } from "@/lib/supabase/admin";

const UNIQUE_VIOLATION = "23505";

// A claimed lock older than this with no active run is a crash-orphan, stolen
// by the next claim. Must exceed the worst-case discovery duration: per-ring
// reasoning runs concurrently at up to ~120s (a primary call plus a refusal
// fallback, 60s each), on top of Podscan discovery and the persistence of every
// kept show. 300s leaves comfortable headroom so a live-but-slow run is never
// stolen — which also guarantees a late release can't delete a successor's lock
// (the predecessor is long gone before 300s elapse).
export const DISCOVERY_LOCK_TTL_MS = 300_000;

export type ClaimResult = "acquired" | "exists";

/**
 * Try to claim the discovery slot for a campaign. "exists" means another
 * request (a concurrent tab / reload mid-run) already owns it; the route turns
 * that into a 409 and runs nothing. A claimed lock older than the TTL is a
 * crash-orphan and is stolen.
 */
export async function claimDiscovery(campaignId: string): Promise<ClaimResult> {
  try {
    const { error } = await supabaseAdmin
      .from("discovery_locks")
      .insert({ campaign_id: campaignId });
    if (!error) return "acquired";
    if (error.code !== UNIQUE_VIOLATION) {
      console.warn(
        "[discovery-lock.claimDiscovery] insert failed, failing open:",
        error.message
      );
      return "acquired";
    }

    // A lock already exists. Steal it only if it is an expired crash-orphan:
    // conditionally delete rows older than the TTL, then retry the insert once.
    // A live writer's lock is newer than the cutoff, so the delete removes
    // nothing and we stay a loser.
    const cutoffIso = new Date(Date.now() - DISCOVERY_LOCK_TTL_MS).toISOString();
    const { error: deleteError, count } = await supabaseAdmin
      .from("discovery_locks")
      .delete({ count: "exact" })
      .eq("campaign_id", campaignId)
      .lt("created_at", cutoffIso);
    if (deleteError) {
      console.warn(
        "[discovery-lock.claimDiscovery] stale-lock delete failed:",
        deleteError.message
      );
      return "exists";
    }
    if (!count) {
      // Nothing stale to steal — a live writer still owns the lock.
      return "exists";
    }

    // We removed an expired lock; re-claim. Another racer may have re-inserted
    // first, in which case we cleanly fall back to loser.
    const { error: reclaimError } = await supabaseAdmin
      .from("discovery_locks")
      .insert({ campaign_id: campaignId });
    if (!reclaimError) return "acquired";
    if (reclaimError.code === UNIQUE_VIOLATION) return "exists";
    console.warn(
      "[discovery-lock.claimDiscovery] reclaim insert failed, failing open:",
      reclaimError.message
    );
    return "acquired";
  } catch (err) {
    console.warn(
      "[discovery-lock.claimDiscovery] threw, failing open:",
      err instanceof Error ? err.message : err
    );
    return "acquired";
  }
}

/**
 * Release the discovery slot. Called in a finally on every run path (success or
 * failure) so the next "Re-run discovery" can re-claim. Fail-soft — a leaked
 * lock from a crashed process is reclaimed by the TTL steal in claimDiscovery.
 */
export async function releaseDiscovery(campaignId: string): Promise<void> {
  try {
    const { error } = await supabaseAdmin
      .from("discovery_locks")
      .delete()
      .eq("campaign_id", campaignId);
    if (error) {
      console.warn(
        "[discovery-lock.releaseDiscovery] delete failed:",
        error.message
      );
    }
  } catch (err) {
    console.warn(
      "[discovery-lock.releaseDiscovery] threw:",
      err instanceof Error ? err.message : err
    );
  }
}
