// POST /api/roster-links/[id]/dispute
//
// A verified owner flags a pending or approved roster link. The insert
// does not change the link. A rejected link returns a calm 200 and
// writes nothing. A repeat flag is 200 and sends nothing. Mail goes
// out only after the first insert, and a send failure does not change
// this response.

import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/data/queries";
import { loadOwnerRosterLink, notifyRosterDispute } from "@/lib/reps/roster-notify";
import { enforceRosterDispute } from "@/lib/security/rate-limit";
import { supabaseAdmin } from "@/lib/supabase/admin";

const NOT_FOUND = { error: "Not found" };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** A note is at most 500 characters. 16 KB is enough for that JSON and nothing larger is parsed. */
const DISPUTE_MAX_BODY_BYTES = 16 * 1024;

function noteLength(value: string): number {
  return Array.from(value).length;
}

function parseDisputeNote(
  value: unknown
): { ok: true; note: string | null } | { ok: false } {
  if (value === undefined || value === null) return { ok: true, note: null };
  if (typeof value !== "string") return { ok: false };
  const note = value.trim();
  if (!note) return { ok: true, note: null };
  if (noteLength(note) > 500) return { ok: false };
  return { ok: true, note };
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const limited = await enforceRosterDispute(user.id);
  if (limited) return limited;

  const declared = request.headers.get("content-length");
  if (declared !== null && /^\d+$/.test(declared.trim()) && Number(declared) > DISPUTE_MAX_BODY_BYTES) {
    return NextResponse.json({ error: "Request body is too large." }, { status: 413 });
  }

  let noteValue: unknown;
  const raw = await request.text();
  if (Buffer.byteLength(raw, "utf8") > DISPUTE_MAX_BODY_BYTES) {
    return NextResponse.json({ error: "Request body is too large." }, { status: 413 });
  }
  if (raw.trim()) {
    try {
      const parsed = JSON.parse(raw) as { note?: unknown };
      noteValue = parsed?.note;
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }
  }
  const note = parseDisputeNote(noteValue);
  if (!note.ok) {
    return NextResponse.json(
      { error: "A note can be at most 500 characters." },
      { status: 400 }
    );
  }

  const { id } = await params;
  if (typeof id !== "string" || !UUID.test(id)) {
    return NextResponse.json(NOT_FOUND, { status: 404 });
  }

  let access: Awaited<ReturnType<typeof loadOwnerRosterLink>>;
  try {
    access = await loadOwnerRosterLink(id, user.id);
  } catch (err) {
    console.error("[roster-dispute] load", err instanceof Error ? err.name : "error");
    return NextResponse.json({ error: "Couldn't flag that link." }, { status: 500 });
  }
  if (!access.ok) {
    return NextResponse.json(NOT_FOUND, { status: 404 });
  }
  if (access.status === "rejected") {
    return NextResponse.json({ ok: true, result: "already declined" });
  }

  const { data, error } = await supabaseAdmin
    .from("roster_link_disputes")
    .insert({
      link_id: access.linkId,
      show_id: access.showId,
      owner_user_id: user.id,
      note: note.note,
      status: "open",
    })
    .select("id")
    .maybeSingle();

  if (error?.code === "23505") {
    return NextResponse.json({ ok: true, result: "already flagged" });
  }
  if (error || !data) {
    console.error("[roster-dispute] insert", error?.code ?? "error");
    return NextResponse.json({ error: "Couldn't flag that link." }, { status: 500 });
  }

  const ownerEmail = typeof user.email === "string" ? user.email.trim() : "";
  try {
    await notifyRosterDispute({
      showName: access.showName,
      repLabel: access.repLabel,
      ownerEmail: ownerEmail || "No email on the account",
      note: note.note,
    });
  } catch (err) {
    console.error("[roster-dispute] notify", err instanceof Error ? err.name : "error");
  }

  return NextResponse.json({ ok: true, result: "flagged" });
}
