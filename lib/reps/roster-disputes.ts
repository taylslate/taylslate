// Open owner disputes block roster approval. 075 is live, so a
// read error fails closed. There is no missing-table branch.
// Resolve updates open rows only. It does not approve, reject,
// publish, or send mail. resolved_by is the session admin.

import { logEvent } from "@/lib/data/events";
import { supabaseAdmin } from "@/lib/supabase/admin";

export class RosterLinkDisputedError extends Error {
  readonly showId: string | null;

  constructor(showId: string | null) {
    super("This link has an open dispute.");
    this.name = "RosterLinkDisputedError";
    this.showId = showId;
  }
}

export class RosterDisputeReadError extends Error {
  constructor() {
    super("Couldn't check the dispute.");
    this.name = "RosterDisputeReadError";
  }
}

export class RosterResolutionUnavailableError extends Error {
  constructor() {
    super("Resolving disputes needs migration 081.");
    this.name = "RosterResolutionUnavailableError";
  }
}

function asText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function noteLength(note: string): number {
  return Array.from(note).length;
}

export function isOpenDisputeDbError(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return error.code === "P0001" && /open dispute/i.test(error.message ?? "");
}

function missingResolutionNote(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  const message = error.message ?? "";
  if (!/resolution_note/i.test(message)) return false;
  return (
    error.code === "42703" ||
    error.code === "PGRST204" ||
    /does not exist|schema cache|could not find/i.test(message)
  );
}

/** Throws when an open dispute exists or the read fails. */
export async function assertNoOpenDispute(linkId: string): Promise<void> {
  const { data, error } = await supabaseAdmin
    .from("roster_link_disputes")
    .select("id, show_id, status")
    .eq("link_id", linkId)
    .eq("status", "open");
  if (error) throw new RosterDisputeReadError();
  const rows = Array.isArray(data) ? data : [];
  const open = rows.find((row) => asText((row as { status?: unknown }).status) === "open");
  if (!open) return;
  throw new RosterLinkDisputedError(asText((open as { show_id?: unknown }).show_id));
}

/**
 * Resolves every open dispute on one link. A missing resolution_note
 * column means migration 081 is not applied. Zero rows means there
 * was nothing open. The link row is not updated.
 */
export async function resolveRosterDispute(
  adminId: string,
  linkId: string,
  note: string
): Promise<{ resolved_count: number }> {
  const { data, error } = await supabaseAdmin
    .from("roster_link_disputes")
    .update({
      status: "resolved",
      resolved_at: new Date().toISOString(),
      resolved_by: adminId,
      resolution_note: note,
    })
    .eq("link_id", linkId)
    .eq("status", "open")
    .select("id, link_id, show_id");
  if (missingResolutionNote(error)) throw new RosterResolutionUnavailableError();
  if (error) {
    const failure = new Error("Couldn't resolve that dispute.");
    failure.name = error.code || "PostgrestError";
    throw failure;
  }
  const rows = Array.isArray(data) ? data : [];
  if (rows.length === 0) return { resolved_count: 0 };

  const showId = asText((rows[0] as { show_id?: unknown }).show_id);
  await logEvent({
    eventType: "roster_link.dispute_resolved",
    entityType: "roster_link",
    entityId: linkId,
    actorId: adminId,
    payload: {
      link_id: linkId,
      show_id: showId,
      resolved_count: rows.length,
      note_length: noteLength(note),
    },
  });
  return { resolved_count: rows.length };
}
