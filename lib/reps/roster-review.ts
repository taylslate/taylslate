// Admin review of pending roster links.
//
// Reads and the reject write go through supabaseAdmin. approveRosterLink
// in lib/reps/store.ts is the approve write. This module does not change
// it, and reject never writes public.shows.
//
// Ownership proof is omitted until O1 merges. Do not import lib/ownership
// before that module exists. The slot is a gap, not a failed read.

import { supabaseAdmin } from "@/lib/supabase/admin";
import { isShowsAdmin } from "@/lib/shows/can-edit-show";

export const ROSTER_REVIEW_NOTE_MAX = 500;

const PENDING_SELECT = [
  "id",
  "agent_id",
  "show_id",
  "source",
  "is_exclusive",
  "created_at",
  "shows!agent_show_relationships_show_id_fkey(name,is_discoverable,agent_id)",
  "profiles!agent_show_relationships_agent_id_fkey(email)",
].join(",");

const OTHER_SELECT = [
  "id",
  "agent_id",
  "show_id",
  "status",
  "source",
  "is_exclusive",
  "profiles!agent_show_relationships_agent_id_fkey(email)",
].join(",");

export interface RosterLinkConflict {
  id: string;
  agentId: string;
  agentEmail: string | null;
  status: "pending" | "approved";
  source: string | null;
  isExclusive: boolean;
}

export interface PendingRosterRequest {
  id: string;
  agentId: string;
  agentEmail: string | null;
  showId: string;
  showName: string;
  discoverable: boolean;
  source: string | null;
  isExclusive: boolean;
  createdAt: string;
  showAgentId: string | null;
  showAgentDiffers: boolean;
  otherLinks: RosterLinkConflict[];
  exclusiveConflict: boolean;
  status: "pending";
}

interface OtherLink extends RosterLinkConflict {
  showId: string;
}

function asText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function embedded(value: unknown): Record<string, unknown> | null {
  const row = Array.isArray(value) ? value[0] : value;
  if (!row || typeof row !== "object") return null;
  return row as Record<string, unknown>;
}

function noteLength(value: string): number {
  return Array.from(value).length;
}

/** Trimmed note of 1 to 500 characters, or null when the value cannot be stored. */
export function rosterReviewNote(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const note = value.trim();
  const length = noteLength(note);
  if (length < 1 || length > ROSTER_REVIEW_NOTE_MAX) return null;
  return note;
}

function parsePending(row: Record<string, unknown>): PendingRosterRequest | null {
  const id = asText(row.id);
  const agentId = asText(row.agent_id);
  const showId = asText(row.show_id);
  if (!id || !agentId || !showId) return null;
  const show = embedded(row.shows);
  const profile = embedded(row.profiles);
  const showAgentId = asText(show?.agent_id);
  return {
    id,
    agentId,
    agentEmail: asText(profile?.email),
    showId,
    showName: asText(show?.name) ?? "",
    discoverable: show?.is_discoverable === true,
    source: asText(row.source),
    isExclusive: row.is_exclusive === true,
    createdAt: asText(row.created_at) ?? "",
    showAgentId,
    showAgentDiffers: showAgentId !== agentId,
    otherLinks: [],
    exclusiveConflict: false,
    status: "pending",
  };
}

function parseOther(row: Record<string, unknown>): OtherLink | null {
  const id = asText(row.id);
  const agentId = asText(row.agent_id);
  const showId = asText(row.show_id);
  const status = asText(row.status);
  if (!id || !agentId || !showId) return null;
  if (status !== "pending" && status !== "approved") return null;
  const profile = embedded(row.profiles);
  return {
    id,
    showId,
    agentId,
    agentEmail: asText(profile?.email),
    status,
    source: asText(row.source),
    isExclusive: row.is_exclusive === true,
  };
}

export async function listPendingRosterLinks(): Promise<PendingRosterRequest[]> {
  const { data, error } = await supabaseAdmin
    .from("agent_show_relationships")
    .select(PENDING_SELECT)
    .eq("status", "pending")
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);

  const pending = ((data ?? []) as unknown as Record<string, unknown>[])
    .map((row) => parsePending(row))
    .filter((row): row is PendingRosterRequest => row !== null);
  if (pending.length === 0) return [];

  const showIds = [...new Set(pending.map((row) => row.showId))];
  const { data: others, error: otherError } = await supabaseAdmin
    .from("agent_show_relationships")
    .select(OTHER_SELECT)
    .in("show_id", showIds)
    .in("status", ["pending", "approved"]);
  if (otherError) throw new Error(otherError.message);

  const otherLinks = ((others ?? []) as unknown as Record<string, unknown>[])
    .map((row) => parseOther(row))
    .filter((row): row is OtherLink => row !== null);

  for (const row of pending) {
    const related = otherLinks
      .filter((link) => link.showId === row.showId && link.id !== row.id)
      .sort((a, b) => (a.agentEmail ?? "").localeCompare(b.agentEmail ?? "") || a.id.localeCompare(b.id));
    row.otherLinks = related.map((link) => ({
      id: link.id,
      agentId: link.agentId,
      agentEmail: link.agentEmail,
      status: link.status,
      source: link.source,
      isExclusive: link.isExclusive,
    }));
    row.exclusiveConflict = row.otherLinks.some(
      (link) => link.status === "approved" && link.isExclusive
    );
  }

  pending.sort(
    (a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)
  );
  return pending;
}

/**
 * Reject one pending roster link. The note is required. The update matches
 * status pending only, so an approved or rejected row is left as it is.
 * public.shows is not written.
 */
export async function rejectRosterLink(
  adminUserId: string,
  relationshipId: string,
  note: unknown
): Promise<{ id: string; status: "rejected" }> {
  if (!(await isShowsAdmin(adminUserId))) {
    throw new Error("Only an admin can reject a roster link.");
  }
  const reviewNote = rosterReviewNote(note);
  if (!reviewNote) {
    throw new Error("A note of 1 to 500 characters is required.");
  }

  const rejectedAt = new Date().toISOString();
  const { data, error } = await supabaseAdmin
    .from("agent_show_relationships")
    .update({
      status: "rejected",
      review_note: reviewNote,
      rejected_by: adminUserId,
      rejected_at: rejectedAt,
    })
    .eq("id", relationshipId)
    .eq("status", "pending")
    .select("id, status")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Roster link is not pending.");

  const id = asText((data as { id?: unknown }).id);
  if (!id) throw new Error("Roster link is not pending.");
  return { id, status: "rejected" };
}
