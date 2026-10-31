// Best-effort mail after a roster link write. Every function here runs
// only after that write returned success. A send failure, a missing
// key, or a thrown client is logged as a name or code and never thrown.
// Logs do not include an address, a note, a token, or a row.
//
// Owner recipients are verified proofs only. This reads the proof
// branch of getVerifiedProfileTies (show_ownership_proofs, status
// verified) and deliberately skips the deal ties and show_owner
// contact-email ties that helper also returns. Those are not an
// ownership claim worth mailing. The profile id is proofs.user_id.
// Show name, a contact email, and a podscan id are not match keys.

import { sendEmail } from "@/lib/email/send";
import {
  renderRosterAdminAlert,
  renderRosterDisputeAlert,
  renderRosterOwnerNotice,
  renderRosterRepDecision,
  type RosterOwnerShow,
} from "@/lib/email/templates/roster-links";
import { ROSTER_REVIEW_NOTE_MAX, loadReviewedRosterLink } from "@/lib/reps/roster-review";
import type { RosterImportResultRow } from "@/lib/reps/roster-import";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const ROSTER_OWNER_EMAIL_CAP = 50;
export const ROSTER_ADMIN_NAME_CAP = 5;

const FALLBACK_REP = "A Taylslate sales agent";

export interface RepNameFields {
  company_name?: string | null;
  full_name?: string | null;
}

export function rosterRepLabel(profile: RepNameFields | null | undefined): string {
  const company = profile?.company_name?.trim() ?? "";
  if (company) return company;
  const name = profile?.full_name?.trim() ?? "";
  if (name) return name;
  return FALLBACK_REP;
}

export function rosterAdminAlertEmail(): string {
  return process.env.INTERNAL_ALERT_EMAIL || "chris@taylslate.com";
}

export interface OwnerRosterLinkView {
  ok: true;
  linkId: string;
  showId: string;
  showName: string;
  repLabel: string;
  status: "pending" | "approved" | "rejected";
  agentId: string;
}

function logRosterNotify(scope: string, err: unknown): void {
  const name = err instanceof Error && err.name ? err.name : "error";
  let code = "";
  if (err && typeof err === "object" && "code" in err) {
    const value = (err as { code?: unknown }).code;
    if (typeof value === "string" && /^[A-Za-z0-9_]+$/.test(value)) code = value;
  }
  console.error(`[roster-notify] ${scope} ${name}${code ? ` ${code}` : ""}`);
}

function boundedNote(note: string | null | undefined): string | null {
  if (!note) return null;
  const trimmed = note.trim();
  if (!trimmed) return null;
  const chars = Array.from(trimmed);
  if (chars.length <= ROSTER_REVIEW_NOTE_MAX) return trimmed;
  return chars.slice(0, ROSTER_REVIEW_NOTE_MAX).join("");
}

async function deliver(
  scope: string,
  input: {
    to: string;
    subject: string;
    html: string;
    text: string;
    recipientProfileId?: string;
  }
): Promise<void> {
  const result = await sendEmail(input);
  if (!result.ok) {
    console.error(`[roster-notify] ${scope} ${result.reason ?? "send_failed"}`);
  }
}

function committedRows(rows: RosterImportResultRow[]): RosterImportResultRow[] {
  return rows.filter((row) => row.committed === true && typeof row.link_id === "string" && row.link_id);
}

export async function notifyRosterImportCommit(input: {
  agentId: string;
  rows: RosterImportResultRow[];
}): Promise<void> {
  const committed = committedRows(input.rows);
  if (committed.length === 0) return;

  let repLabel = FALLBACK_REP;
  try {
    repLabel = rosterRepLabel(await readRepProfile(input.agentId));
  } catch (err) {
    logRosterNotify("import_rep", err);
  }

  try {
    await sendAdminImportAlert(repLabel, committed);
  } catch (err) {
    logRosterNotify("admin_alert", err);
  }

  try {
    await sendOwnerNotices(input.agentId, repLabel, committed);
  } catch (err) {
    logRosterNotify("owner_notice", err);
  }
}

async function sendAdminImportAlert(
  repLabel: string,
  committed: RosterImportResultRow[]
): Promise<void> {
  const names = committed
    .map((row) => row.show_name?.trim() ?? "")
    .filter((name) => name.length > 0);
  const newShowCount = committed.filter((row) => row.class === "new_show").length;
  const rendered = renderRosterAdminAlert({
    repLabel,
    count: committed.length,
    newShowCount,
    existingShowCount: committed.length - newShowCount,
    showNames: names.slice(0, ROSTER_ADMIN_NAME_CAP),
    omittedShowCount: Math.max(0, names.length - ROSTER_ADMIN_NAME_CAP),
  });
  await deliver("admin_alert", {
    to: rosterAdminAlertEmail(),
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
  });
}

async function sendOwnerNotices(
  agentId: string,
  repLabel: string,
  committed: RosterImportResultRow[]
): Promise<void> {
  const existing = committed.filter(
    (row) =>
      (row.class === "link_existing" || row.class === "exclusive_conflict") &&
      typeof row.show_id === "string" &&
      row.show_id &&
      typeof row.link_id === "string" &&
      row.link_id
  );
  if (existing.length === 0) return;

  const showIds = [...new Set(existing.map((row) => row.show_id as string))];
  const status = await readOwnershipStatus(showIds);
  const verifiedIds = showIds.filter((id) => status.get(id) === "verified");
  // Unclaimed shows stop here. No proof read, no profile read.
  if (verifiedIds.length === 0) return;

  const proofs = await readVerifiedProofs(verifiedIds);
  const ownerIds = [
    ...new Set(proofs.map((proof) => proof.userId).filter((id) => id !== agentId)),
  ];
  if (ownerIds.length === 0) return;

  const emails = await readProfileEmails(ownerIds);
  let missingEmail = 0;
  const ownersByShow = new Map<string, { userId: string; email: string }[]>();
  for (const proof of proofs) {
    if (proof.userId === agentId) continue;
    const email = emails.get(proof.userId);
    if (!email) {
      missingEmail += 1;
      continue;
    }
    const list = ownersByShow.get(proof.showId) ?? [];
    if (!list.some((owner) => owner.userId === proof.userId)) {
      list.push({ userId: proof.userId, email });
    }
    ownersByShow.set(proof.showId, list);
  }
  if (missingEmail > 0) {
    console.error(`[roster-notify] owner_notice no_email ${missingEmail}`);
  }

  const buckets = new Map<string, { userId: string; email: string; shows: RosterOwnerShow[] }>();
  for (const row of existing) {
    const owners = ownersByShow.get(row.show_id as string) ?? [];
    for (const owner of owners) {
      let bucket = buckets.get(owner.userId);
      if (!bucket) {
        bucket = { userId: owner.userId, email: owner.email, shows: [] };
        buckets.set(owner.userId, bucket);
      }
      bucket.shows.push({
        name: row.show_name?.trim() || "Your show",
        linkId: row.link_id as string,
      });
    }
  }

  const all = [...buckets.values()];
  const capped = all.slice(0, ROSTER_OWNER_EMAIL_CAP);
  if (all.length > ROSTER_OWNER_EMAIL_CAP) {
    console.error(`[roster-notify] owner_cap ${all.length - ROSTER_OWNER_EMAIL_CAP}`);
  }

  for (const bucket of capped) {
    const rendered = renderRosterOwnerNotice({ repLabel, shows: bucket.shows });
    await deliver("owner_notice", {
      to: bucket.email,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      recipientProfileId: bucket.userId,
    });
  }
}

export async function notifyRosterLinkDecision(input: {
  relationshipId: string;
  decision: "approved" | "declined";
}): Promise<void> {
  try {
    const link = await loadReviewedRosterLink(input.relationshipId);
    if (!link) {
      console.error("[roster-notify] rep_decision missing");
      return;
    }
    if (!link.repEmail) {
      console.error("[roster-notify] rep_decision no_email");
      return;
    }
    const note = input.decision === "declined" ? boundedNote(link.reviewNote) : null;
    const rendered = renderRosterRepDecision({
      showName: link.showName,
      decision: input.decision,
      note,
    });
    await deliver("rep_decision", {
      to: link.repEmail,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      recipientProfileId: link.agentId,
    });
  } catch (err) {
    logRosterNotify("rep_decision", err);
  }
}

export async function notifyRosterDispute(input: {
  showName: string;
  repLabel: string;
  ownerEmail: string;
  note: string | null;
}): Promise<void> {
  try {
    const rendered = renderRosterDisputeAlert({
      showName: input.showName,
      repLabel: input.repLabel,
      ownerEmail: input.ownerEmail,
      note: boundedNote(input.note),
    });
    await deliver("dispute_alert", {
      to: rosterAdminAlertEmail(),
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
    });
  } catch (err) {
    logRosterNotify("dispute_alert", err);
  }
}

/**
 * Signed-in view of one roster link. ok false means the link is missing
 * or the caller is not a verified owner. Both look the same on purpose.
 * A database error throws. Unclaimed shows do not read proofs.
 */
export async function loadOwnerRosterLink(
  linkId: string,
  userId: string
): Promise<OwnerRosterLinkView | { ok: false }> {
  const { data, error } = await supabaseAdmin
    .from("agent_show_relationships")
    .select(
      "id, show_id, agent_id, status, shows!agent_show_relationships_show_id_fkey(name, ownership_status)"
    )
    .eq("id", linkId)
    .maybeSingle();
  if (error) {
    const failure = new Error("roster link read failed");
    failure.name = error.code || "PostgrestError";
    throw failure;
  }
  if (!data) return { ok: false };
  const row = data as Record<string, unknown>;
  const showId = text(row.show_id);
  const agentId = text(row.agent_id);
  const status = text(row.status);
  if (!showId || !agentId) return { ok: false };
  if (status !== "pending" && status !== "approved" && status !== "rejected") {
    return { ok: false };
  }
  const show = embedded(row.shows);
  const ownership = text(show?.ownership_status);
  if (ownership !== "verified") return { ok: false };
  if (!(await callerHasVerifiedProof(showId, userId))) return { ok: false };

  const profile = await readRepProfile(agentId);
  return {
    ok: true,
    linkId,
    showId,
    showName: text(show?.name) || "Your show",
    repLabel: rosterRepLabel(profile),
    status,
    agentId,
  };
}

async function callerHasVerifiedProof(showId: string, userId: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from("show_ownership_proofs")
    .select("user_id")
    .eq("show_id", showId)
    .eq("status", "verified")
    .eq("user_id", userId)
    .limit(1);
  if (error) {
    const failure = new Error("ownership proof read failed");
    failure.name = error.code || "PostgrestError";
    throw failure;
  }
  return (data ?? []).some((row) => text((row as { user_id?: unknown }).user_id) === userId);
}

async function readRepProfile(agentId: string): Promise<RepNameFields & { email?: string | null } | null> {
  const { data, error } = await supabaseAdmin
    .from("profiles")
    .select("company_name, full_name, email")
    .eq("id", agentId)
    .maybeSingle();
  if (error) {
    const failure = new Error("rep profile read failed");
    failure.name = error.code || "PostgrestError";
    throw failure;
  }
  return (data as RepNameFields & { email?: string | null } | null) ?? null;
}

async function readOwnershipStatus(showIds: string[]): Promise<Map<string, string>> {
  const { data, error } = await supabaseAdmin
    .from("shows")
    .select("id, ownership_status")
    .in("id", showIds);
  if (error) {
    const failure = new Error("ownership status read failed");
    failure.name = error.code || "PostgrestError";
    throw failure;
  }
  const out = new Map<string, string>();
  for (const row of data ?? []) {
    const id = text((row as { id?: unknown }).id);
    const status = text((row as { ownership_status?: unknown }).ownership_status);
    if (id) out.set(id, status);
  }
  return out;
}

async function readVerifiedProofs(
  showIds: string[]
): Promise<{ showId: string; userId: string }[]> {
  const { data, error } = await supabaseAdmin
    .from("show_ownership_proofs")
    .select("show_id, user_id")
    .in("show_id", showIds)
    .eq("status", "verified");
  if (error) {
    const failure = new Error("verified proof read failed");
    failure.name = error.code || "PostgrestError";
    throw failure;
  }
  const out: { showId: string; userId: string }[] = [];
  for (const row of data ?? []) {
    const showId = text((row as { show_id?: unknown }).show_id);
    const userId = text((row as { user_id?: unknown }).user_id);
    if (showId && userId) out.push({ showId, userId });
  }
  return out;
}

async function readProfileEmails(userIds: string[]): Promise<Map<string, string>> {
  const { data, error } = await supabaseAdmin
    .from("profiles")
    .select("id, email")
    .in("id", userIds);
  if (error) {
    const failure = new Error("owner profile read failed");
    failure.name = error.code || "PostgrestError";
    throw failure;
  }
  const out = new Map<string, string>();
  for (const row of data ?? []) {
    const id = text((row as { id?: unknown }).id);
    const email = text((row as { email?: unknown }).email);
    if (id && email) out.set(id, email);
  }
  return out;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function embedded(value: unknown): Record<string, unknown> | null {
  const row = Array.isArray(value) ? value[0] : value;
  if (!row || typeof row !== "object") return null;
  return row as Record<string, unknown>;
}
