// Ownership state for owner and admin views.
//
// Three states: unclaimed, claimed, and verified. Pending is a tag,
// not a state. It is true while a show_ownership_proofs row is pending,
// or while an agent_show_relationships row is pending. Claimed is the
// profile-control rule in tier.ts. Before migration 100 the column
// cannot store claimed, so an unclaimed column is upgraded in this
// read when that rule holds. Brand-facing UI does not show these
// labels. This module does not remove shows from discovery, booking,
// or visibility.

import { supabaseAdmin } from "@/lib/supabase/admin";
import { claimLookup } from "@/lib/ownership/persist";
import { ownershipTier, type OwnershipTier } from "@/lib/ownership/tier";

export type OwnershipStateName = OwnershipTier;

export interface OwnershipState {
  state: OwnershipStateName;
  pending: boolean;
}

/** Owner and admin copy. Do not render these on a brand-facing surface. */
export const ownershipLabels = {
  verified: "Verified",
  claimed: "Claimed",
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
      .select("id, ownership_status, contact_email, data_sources, slug")
      .in("id", ids);
    if (error) {
      console.warn("[getOwnershipState] show read failed:", error.code ?? "unknown");
    } else {
      const open: Array<{
        id: string;
        contact_email?: unknown;
        data_sources?: unknown;
        slug?: unknown;
      }> = [];
      for (const row of shows ?? []) {
        const id = text(row.id);
        const current = out.get(id);
        if (!current) continue;
        const tier = ownershipTier(row);
        if (tier === "unclaimed") {
          open.push({
            id,
            contact_email: row.contact_email,
            data_sources: row.data_sources,
            slug: row.slug,
          });
          continue;
        }
        current.state = tier;
      }
      if (open.length > 0) {
        const claimed = await claimLookup(open);
        if (claimed.ok) {
          for (const id of claimed.ids) {
            const current = out.get(id);
            if (current && current.state !== "verified") current.state = "claimed";
          }
        }
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
