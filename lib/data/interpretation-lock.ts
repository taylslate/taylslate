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
// Fail-open on infrastructure errors: an unreachable lock table degrades to
// the pre-lock behavior (possible duplicate run), never a blocked
// interpretation. Matches the fail-soft spirit of reasoning-log.ts.

import { supabaseAdmin } from "@/lib/supabase/admin";

const UNIQUE_VIOLATION = "23505";

export type ClaimResult = "acquired" | "exists";

/**
 * Try to claim the interpretation slot for this brief version. "exists"
 * means another request (concurrent or earlier) already owns it.
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
    if (error.code === UNIQUE_VIOLATION) return "exists";
    console.warn(
      "[interpretation-lock.claimInterpretation] insert failed, failing open:",
      error.message
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
