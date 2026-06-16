// Sentinel-row lock for the brief interpretation endpoint (Layer 4).
//
// The interpret endpoint's read-then-act idempotency guard is non-atomic on
// its own: two concurrent POSTs (double-fired page effect) can both pass the
// replay check and double-run the LLM. The interpretation_locks table
// (migration 022) closes the race — its primary key on
// (campaign_id, brief_submitted_at) means exactly one concurrent claim
// insert succeeds; the loser sees a unique violation and replays the
// winner's stored result instead.
//
// Lock lifecycle (claimed -> completed | expired):
//   claimed   — a row exists, no completed pattern row yet. A writer is
//               running the LLM + the atomic persist.
//   completed — the writer persisted atomically (migration 024); the
//               campaign_patterns row is the replay source. The lock row is
//               retained as a marker (the replay guard short-circuits future
//               POSTs before they reach claim()).
//   expired   — a claimed row older than LOCK_TTL_MS with no pattern row: a
//               crash-orphan. The next claim() steals it. Because claim() is
//               only reached when no pattern row exists, a steal can never
//               clobber a completed interpretation.
//   released  — a failure path deleted the row; the next request re-claims.
//
// Fail-open on infrastructure errors: an unreachable lock table degrades to
// the pre-lock behavior (possible duplicate run), never a blocked
// interpretation. Matches the fail-soft spirit of reasoning-log.ts.

import { supabaseAdmin } from "@/lib/supabase/admin";

const UNIQUE_VIOLATION = "23505";

// A claimed lock older than this with no completed pattern row is a
// crash-orphan and is stolen by the next claim. Must exceed the worst-case
// interpret duration: two sequential bounded LLM calls (primary + refusal
// fallback) at 60s each = 120s worst case (see the interpret route's
// LLM_TIMEOUT_MS), leaving 60s of headroom. A live-but-slow writer's lock is
// always newer than the cutoff and survives.
export const LOCK_TTL_MS = 180_000;

export type ClaimResult = "acquired" | "exists";

/**
 * Try to claim the interpretation slot for this brief version. "exists"
 * means another request (concurrent or earlier) already owns it. A claimed
 * lock older than LOCK_TTL_MS is treated as a crash-orphan and stolen.
 */
export async function claimInterpretation(
  campaignId: string,
  briefSubmittedAt: string
): Promise<ClaimResult> {
  try {
    const { error } = await supabaseAdmin.from("interpretation_locks").insert({
      campaign_id: campaignId,
      brief_submitted_at: briefSubmittedAt,
    });
    if (!error) return "acquired";
    if (error.code !== UNIQUE_VIOLATION) {
      console.warn(
        "[interpretation-lock.claimInterpretation] insert failed, failing open:",
        error.message
      );
      return "acquired";
    }

    // A lock already exists. Steal it only if it is an expired crash-orphan:
    // delete the row when it is older than the TTL, then retry the insert
    // once. A live writer's lock is newer than the cutoff, so the conditional
    // delete removes nothing and we stay a loser.
    const cutoffIso = new Date(Date.now() - LOCK_TTL_MS).toISOString();
    const { error: deleteError, count } = await supabaseAdmin
      .from("interpretation_locks")
      .delete({ count: "exact" })
      .eq("campaign_id", campaignId)
      .eq("brief_submitted_at", briefSubmittedAt)
      .lt("created_at", cutoffIso);
    if (deleteError) {
      console.warn(
        "[interpretation-lock.claimInterpretation] stale-lock delete failed:",
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
      .from("interpretation_locks")
      .insert({
        campaign_id: campaignId,
        brief_submitted_at: briefSubmittedAt,
      });
    if (!reclaimError) return "acquired";
    if (reclaimError.code === UNIQUE_VIOLATION) return "exists";
    console.warn(
      "[interpretation-lock.claimInterpretation] reclaim insert failed, failing open:",
      reclaimError.message
    );
    return "acquired";
  } catch (err) {
    console.warn(
      "[interpretation-lock.claimInterpretation] threw, failing open:",
      err instanceof Error ? err.message : err
    );
    return "acquired";
  }
}

/**
 * Release a claimed slot. Called on every failure path that leaves no
 * replayable pattern row, so the brand's "refresh to try again" retries.
 * Fail-soft — a leaked lock from a crashed process is cleaned up by brief
 * resubmission (new submitted_at, new key).
 */
export async function releaseInterpretation(
  campaignId: string,
  briefSubmittedAt: string
): Promise<void> {
  try {
    const { error } = await supabaseAdmin
      .from("interpretation_locks")
      .delete()
      .eq("campaign_id", campaignId)
      .eq("brief_submitted_at", briefSubmittedAt);
    if (error) {
      console.warn(
        "[interpretation-lock.releaseInterpretation] delete failed:",
        error.message
      );
    }
  } catch (err) {
    console.warn(
      "[interpretation-lock.releaseInterpretation] threw:",
      err instanceof Error ? err.message : err
    );
  }
}
