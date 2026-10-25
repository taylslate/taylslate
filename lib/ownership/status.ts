// Ownership state for owner and admin views.
//
// Two states: unclaimed and verified. Pending is a tag, not a state.
// It is true while a show_ownership_proofs row is pending, or while an
// agent_show_relationships row is pending. Brand-facing UI does not
// show these labels. This module does not change discovery, booking,
// or visibility.

import { supabaseAdmin } from "@/lib/supabase/admin";

export type OwnershipStateName = "unclaimed" | "verified";

export interface OwnershipState {
  state: OwnershipStateName;
  pending: boolean;
}

/** Owner and admin copy. Do not render these on a brand-facing surface. */
export const ownershipLabels = {
  verified: "Verified",
  unclaimed: "Unclaimed",
  pending: "Pending",
} as const;

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/**
 * One entry per requested show id. Unknown ids are unclaimed and not
 * pending. A read error is fail-soft: that source contributes nothing.
 */
export async function getOwnershipState(
  showIds: string[]
): Promise<Map<string, OwnershipState>> {
  const ids = [...new Set(showIds.map((id) => id.trim()).filter((id) => id.length > 0))];
  const out = new Map<string, OwnershipState>();
  for (const id of ids) out.set(id, { state: "unclaimed", pending: false });
  if (ids.length === 0) return out;

  try {
    const { data: shows, error } = await supabaseAdmin
      .from("shows")
      .select("id, ownership_status")
      .in("id", ids);
    if (error) {
      console.warn("[getOwnershipState] show read failed:", error.message);
    } else {
      for (const row of shows ?? []) {
        const id = text(row.id);
        const current = out.get(id);
        if (!current) continue;
        current.state = row.ownership_status === "verified" ? "verified" : "unclaimed";
      }
    }

    const { data: proofs, error: proofError } = await supabaseAdmin
      .from("show_ownership_proofs")
      .select("show_id")
      .in("show_id", ids)
      .eq("status", "pending");
    if (proofError) {
      console.warn("[getOwnershipState] proof read failed:", proofError.message);
    } else {
      for (const row of proofs ?? []) {
        const current = out.get(text(row.show_id));
        if (current) current.pending = true;
      }
    }

    const { data: links, error: linkError } = await supabaseAdmin
      .from("agent_show_relationships")
      .select("show_id")
      .in("show_id", ids)
      .eq("status", "pending");
    if (linkError) {
      console.warn("[getOwnershipState] roster read failed:", linkError.message);
    } else {
      for (const row of links ?? []) {
        const current = out.get(text(row.show_id));
        if (current) current.pending = true;
      }
    }
  } catch (err) {
    console.warn(
      "[getOwnershipState] threw:",
      err instanceof Error ? err.message : err
    );
  }

  return out;
}
