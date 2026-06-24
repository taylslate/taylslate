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
//              row in a finally, FENCED by the claim's created_at so it can only
//              delete its own row. Discovery is intentionally re-runnable, so the
//              lock is NOT a permanent marker (contrast interpretation_locks).
//   stolen   — a claimed row older than DISCOVERY_LOCK_TTL_MS is a crash-orphan
//              (the writer died without releasing); the next claim deletes and
//              re-inserts it. The created_at fence means that even if a slow run
//              is wrongly stolen (a run CAN exceed the TTL — see the token doc on
//              ClaimResult), the stolen writer's late release won't delete the
//              successor's newer-created_at row.
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

export type ClaimResult =
  | {
      status: "acquired";
      /**
       * The claimed row's created_at — a fencing token. releaseDiscovery deletes
       * ONLY this exact row, so a slow predecessor whose lock was TTL-stolen
       * cannot delete the SUCCESSOR's live lock (the successor's row carries a
       * newer created_at). This matters because a run is not reliably shorter
       * than the TTL: the Podscan client honors an uncapped Retry-After sleep
       * (lib/enrichment/podscan.ts), so a rate-limited run can exceed 300s, get
       * stolen, then finish and release. Null only on the fail-open path, where
       * there is no row to fence and release falls back to a best-effort
       * delete-by-campaign_id (the pre-fence behavior — acceptable degradation).
       */
      token: string | null;
    }
  | { status: "exists" };

/** Insert a lock row and read back its created_at (the fence token). Returns
 *  the token on success, or the error so the caller can branch on a unique
 *  violation vs. an infra failure. */
async function insertLock(
  campaignId: string
): Promise<{
  token: string | null;
  error: { code?: string; message?: string } | null;
}> {
  const { data, error } = await supabaseAdmin
    .from("discovery_locks")
    .insert({ campaign_id: campaignId })
    .select("created_at")
    .single();
  return {
    token: (data?.created_at as string | undefined) ?? null,
    error: error ?? null,
  };
}

/**
 * Try to claim the discovery slot for a campaign. `{status:"exists"}` means
 * another request (a concurrent tab / reload mid-run) already owns it; the route
 * turns that into a 409 and runs nothing. `{status:"acquired", token}` carries
 * the fence token for release. A claimed lock older than the TTL is a
 * crash-orphan and is stolen.
 */
export async function claimDiscovery(campaignId: string): Promise<ClaimResult> {
  try {
    const first = await insertLock(campaignId);
    if (!first.error) return { status: "acquired", token: first.token };
    if (first.error.code !== UNIQUE_VIOLATION) {
      console.warn(
        "[discovery-lock.claimDiscovery] insert failed, failing open:",
        first.error.message
      );
      return { status: "acquired", token: null };
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
      return { status: "exists" };
    }
    if (!count) {
      // Nothing stale to steal — a live writer still owns the lock.
      return { status: "exists" };
    }

    // We removed an expired lock; re-claim. Another racer may have re-inserted
    // first, in which case we cleanly fall back to loser.
    const second = await insertLock(campaignId);
    if (!second.error) return { status: "acquired", token: second.token };
    if (second.error.code === UNIQUE_VIOLATION) return { status: "exists" };
    console.warn(
      "[discovery-lock.claimDiscovery] reclaim insert failed, failing open:",
      second.error.message
    );
    return { status: "acquired", token: null };
  } catch (err) {
    console.warn(
      "[discovery-lock.claimDiscovery] threw, failing open:",
      err instanceof Error ? err.message : err
    );
    return { status: "acquired", token: null };
  }
}

/**
 * Release the discovery slot. Called in a finally on every run path (success or
 * failure) so the next "Re-run discovery" can re-claim. Pass the token from
 * claimDiscovery: the delete is fenced to that exact row so a late release after
 * a TTL steal can never clobber the successor's live lock. A null token (the
 * fail-open path) falls back to a best-effort delete-by-campaign_id. Fail-soft —
 * a leaked lock is reclaimed by the TTL steal in claimDiscovery regardless.
 */
export async function releaseDiscovery(
  campaignId: string,
  token: string | null
): Promise<void> {
  try {
    let query = supabaseAdmin
      .from("discovery_locks")
      .delete()
      .eq("campaign_id", campaignId);
    // Fence by created_at when we have it — delete only the row we claimed.
    if (token) query = query.eq("created_at", token);
    const { error } = await query;
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
