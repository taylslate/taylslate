// Writes ownership_status. Verified is always legal. Claimed is legal
// only after migration 100. A 23514 on that one write is logged as the
// code and the caller continues, so claim, verify, and profile flows
// can ship before the migration.
//
// The claim rule is documented on ownershipTier in tier.ts.

import { supabaseAdmin } from "@/lib/supabase/admin";
import { getAuthUserIdByEmail } from "@/lib/auth/auth-email";
import { ownershipTier, type OwnershipTier } from "@/lib/ownership/tier";

export const OWNERSHIP_CHECK_VIOLATION = "23514";

export interface ClaimRow {
  id: string;
  contact_email?: unknown;
  data_sources?: unknown;
}

export type ClaimLookup =
  | { ok: true; ids: Set<string> }
  | { ok: false };

type WriteResult =
  | { ok: true }
  | { ok: false; code: string; unsupported?: boolean };

function errorCode(error: { code?: string } | null): string {
  return typeof error?.code === "string" && error.code ? error.code : "unknown";
}

function isShowOwnerRow(value: unknown): boolean {
  return Array.isArray(value) && value.includes("show_owner");
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Show ids in this set that a show account controls and that are not
 * already verified. A read failure returns ok: false so a sync does
 * not clear a stored claim it could not re-check.
 */
export async function claimLookup(rows: ClaimRow[]): Promise<ClaimLookup> {
  const ids = [...new Set(rows.map((row) => text(row.id)).filter((id) => id.length > 0))];
  const claimed = new Set<string>();
  if (ids.length === 0) return { ok: true, ids: claimed };

  try {
    const { data, error } = await supabaseAdmin
      .from("deals")
      .select("show_id, show_profile_id")
      .in("show_id", ids);
    if (error) {
      console.warn("[ownership]", errorCode(error));
      return { ok: false };
    }
    for (const row of data ?? []) {
      const showId = text(row.show_id);
      const profileId = text(row.show_profile_id);
      if (showId && profileId) claimed.add(showId);
    }
  } catch {
    console.warn("[ownership] claim read");
    return { ok: false };
  }

  for (const row of rows) {
    const showId = text(row.id);
    if (!showId || claimed.has(showId) || !isShowOwnerRow(row.data_sources)) continue;
    const email = text(row.contact_email);
    if (!email) continue;
    try {
      const userId = await getAuthUserIdByEmail(email);
      if (!userId) continue;
      const { data, error } = await supabaseAdmin
        .from("show_profiles")
        .select("id")
        .eq("user_id", userId)
        .maybeSingle();
      if (error) {
        console.warn("[ownership]", errorCode(error));
        continue;
      }
      if (text(data?.id)) claimed.add(showId);
    } catch {
      console.warn("[ownership] claim read");
    }
  }

  return { ok: true, ids: claimed };
}

async function readStatus(
  showId: string
): Promise<{ ok: true; status: OwnershipTier | "missing" } | { ok: false }> {
  try {
    const { data, error } = await supabaseAdmin
      .from("shows")
      .select("id, ownership_status")
      .eq("id", showId)
      .maybeSingle();
    if (error) {
      console.warn("[ownership]", errorCode(error));
      return { ok: false };
    }
    if (!data?.id) return { ok: true, status: "missing" };
    return { ok: true, status: ownershipTier(data) };
  } catch {
    console.warn("[ownership] claim read");
    return { ok: false };
  }
}

/**
 * Persist one tier. Verified overwrites claimed or unclaimed.
 * Claimed and unclaimed never overwrite verified. A claimed write that
 * hits the pre-100 check constraint logs 23514 and returns unsupported.
 */
export async function writeOwnershipStatus(
  showId: string,
  status: OwnershipTier
): Promise<WriteResult> {
  const id = text(showId);
  if (!id) return { ok: false, code: "unknown" };

  if (status !== "verified") {
    const current = await readStatus(id);
    if (!current.ok) return { ok: false, code: "unknown" };
    if (current.status === "missing" || current.status === "verified") return { ok: true };
    if (current.status === status) return { ok: true };
  }

  try {
    const { error } = await supabaseAdmin
      .from("shows")
      .update({ ownership_status: status })
      .eq("id", id);
    if (!error) return { ok: true };
    const code = errorCode(error);
    if (status === "claimed" && code === OWNERSHIP_CHECK_VIOLATION) {
      console.warn("[ownership]", OWNERSHIP_CHECK_VIOLATION);
      return { ok: false, code, unsupported: true };
    }
    return { ok: false, code };
  } catch {
    return { ok: false, code: "unknown" };
  }
}

/**
 * Set claimed when the rule holds, or unclaimed when it does not.
 * Leaves verified alone. Never throws.
 */
export async function syncShowClaim(showId: string): Promise<void> {
  const id = text(showId);
  if (!id) return;
  try {
    const { data, error } = await supabaseAdmin
      .from("shows")
      .select("id, ownership_status, contact_email, data_sources")
      .eq("id", id)
      .maybeSingle();
    if (error) {
      console.warn("[ownership]", errorCode(error));
      return;
    }
    if (!data?.id) return;
    if (ownershipTier(data) === "verified") return;

    const lookup = await claimLookup([
      {
        id,
        contact_email: data.contact_email,
        data_sources: data.data_sources,
      },
    ]);
    if (!lookup.ok) return;
    const next: OwnershipTier = lookup.ids.has(id) ? "claimed" : "unclaimed";
    if (ownershipTier(data) === next) return;
    const written = await writeOwnershipStatus(id, next);
    if (!written.ok && !written.unsupported) {
      console.warn("[ownership]", written.code);
    }
  } catch {
    console.warn("[ownership] claim sync");
  }
}

export interface RankingOwnershipCandidate {
  ownership_status?: OwnershipTier | null;
}

export interface RankingOwnershipStored extends ClaimRow {
  ownership_status?: unknown;
}

/**
 * Copy a stored claimed or verified tier onto a discovery candidate.
 * When the column is still unclaimed, apply the claim rule in memory
 * so ranking works before migration 100. Does not write the database.
 */
export async function stampRankingOwnership(
  pairs: Array<{ candidate: RankingOwnershipCandidate; stored: RankingOwnershipStored }>
): Promise<void> {
  const pending: Array<{ candidate: RankingOwnershipCandidate; stored: RankingOwnershipStored }> = [];
  for (const pair of pairs) {
    const stored = ownershipTier({
      ownership_status: typeof pair.stored.ownership_status === "string" ? pair.stored.ownership_status : null,
    });
    if (stored === "verified" || stored === "claimed") {
      pair.candidate.ownership_status = stored;
      continue;
    }
    pending.push(pair);
  }
  if (pending.length === 0) return;
  const lookup = await claimLookup(pending.map((pair) => pair.stored));
  if (!lookup.ok) return;
  for (const pair of pending) {
    if (lookup.ids.has(text(pair.stored.id))) pair.candidate.ownership_status = "claimed";
  }
}
