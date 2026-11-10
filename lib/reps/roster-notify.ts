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

import { logEvent } from "@/lib/data/events";
import { sendEmail, type SendEmailResult } from "@/lib/email/send";
import {
  renderRosterAdminAlert,
  renderRosterDisputeAlert,
  renderRosterOwnerNotice,
  renderRosterRepDecision,
  renderRosterRepOwnerHeadsUp,
  type RosterOwnerShow,
} from "@/lib/email/templates/roster-links";
import { ROSTER_REVIEW_NOTE_MAX, loadReviewedRosterLink } from "@/lib/reps/roster-review";
import type { RosterImportResultRow } from "@/lib/reps/roster-import";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const ROSTER_OWNER_EMAIL_CAP = 50;
export const ROSTER_ADMIN_NAME_CAP = 5;
export const ROSTER_HEADS_UP_CAP = 50;
const ROSTER_OWNER_SWEEP_LIMIT = 100;
const ROSTER_OWNER_NOTICE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const STALE_CLAIM_MS = 60 * 60 * 1000;

const FALLBACK_REP = "A Taylslate sales agent";

export interface RepNameFields {
  company_name?: string | null;
  full_name?: string | null;
}

interface VerifiedProof {
  id: string;
  showId: string;
  userId: string;
}

export interface OwnerHeadsUpCounts {
  sent: number;
  already: number;
  skipped: number;
}

type HeadsUpTrigger = "import" | "verified_later";

interface HeadsUpLink {
  id: string;
  showId: string;
  agentId: string;
  status: string;
  createdAt: string;
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
): Promise<SendEmailResult> {
  const result = await sendEmail(input);
  if (!result.ok) {
    console.error(`[roster-notify] ${scope} ${result.reason ?? "send_failed"}`);
  }
  return result;
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

  let verifiedProofs: VerifiedProof[] = [];
  let notifiedShowIds = new Set<string>();
  try {
    const notices = await sendOwnerNotices(input.agentId, repLabel, committed);
    verifiedProofs = notices.proofs;
    notifiedShowIds = notices.notifiedShowIds;
  } catch (err) {
    logRosterNotify("owner_notice", err);
  }

  try {
    await notifyRepsAfterImport(verifiedProofs, committed, notifiedShowIds);
  } catch (err) {
    logRosterNotify("owner_heads_up", err);
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
): Promise<{ proofs: VerifiedProof[]; notifiedShowIds: Set<string> }> {
  const existing = committed.filter(
    (row) =>
      (row.class === "link_existing" || row.class === "exclusive_conflict") &&
      typeof row.show_id === "string" &&
      row.show_id &&
      typeof row.link_id === "string" &&
      row.link_id
  );
  if (existing.length === 0) return { proofs: [], notifiedShowIds: new Set() };

  const showIds = [...new Set(existing.map((row) => row.show_id as string))];
  const status = await readOwnershipStatus(showIds);
  const verifiedIds = showIds.filter((id) => status.get(id) === "verified");
  // Unclaimed shows stop here. No proof read, no profile read.
  if (verifiedIds.length === 0) return { proofs: [], notifiedShowIds: new Set() };

  const proofs = await readVerifiedProofs(verifiedIds);
  const ownerIds = [
    ...new Set(proofs.map((proof) => proof.userId).filter((id) => id !== agentId)),
  ];
  if (ownerIds.length === 0) return { proofs, notifiedShowIds: new Set() };

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

  const buckets = new Map<
    string,
    { userId: string; email: string; shows: RosterOwnerShow[]; showIds: string[] }
  >();
  for (const row of existing) {
    const owners = ownersByShow.get(row.show_id as string) ?? [];
    for (const owner of owners) {
      let bucket = buckets.get(owner.userId);
      if (!bucket) {
        bucket = { userId: owner.userId, email: owner.email, shows: [], showIds: [] };
        buckets.set(owner.userId, bucket);
      }
      bucket.shows.push({
        name: row.show_name?.trim() || "Your show",
        linkId: row.link_id as string,
      });
      const showId = row.show_id as string;
      if (!bucket.showIds.includes(showId)) bucket.showIds.push(showId);
    }
  }

  const all = [...buckets.values()];
  const capped = all.slice(0, ROSTER_OWNER_EMAIL_CAP);
  if (all.length > ROSTER_OWNER_EMAIL_CAP) {
    console.error(`[roster-notify] owner_cap ${all.length - ROSTER_OWNER_EMAIL_CAP}`);
  }

  const notifiedShowIds = new Set<string>();
  for (const bucket of capped) {
    const rendered = renderRosterOwnerNotice({ repLabel, shows: bucket.shows });
    try {
      const sent = await deliver("owner_notice", {
        to: bucket.email,
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
        recipientProfileId: bucket.userId,
      });
      if (sent.ok) {
        for (const showId of bucket.showIds) notifiedShowIds.add(showId);
      }
    } catch (err) {
      logRosterNotify("owner_notice", err);
    }
  }
  return { proofs, notifiedShowIds };
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

async function notifyRepsAfterImport(
  proofs: VerifiedProof[],
  committed: RosterImportResultRow[],
  notifiedShowIds: Set<string>
): Promise<void> {
  const seen = new Set<string>();
  for (const proof of proofs) {
    if (!proof.id || seen.has(proof.id)) continue;
    seen.add(proof.id);
    const linkIds = committed
      .filter(
        (row) =>
          (row.class === "link_existing" || row.class === "exclusive_conflict") &&
          row.committed === true &&
          row.show_id === proof.showId &&
          typeof row.link_id === "string" &&
          row.link_id
      )
      .map((row) => row.link_id as string);
    if (linkIds.length === 0) continue;
    await notifyRepsOfOwnerVerification({
      proofId: proof.id,
      linkIds,
      trigger: "import",
      ownerNotified: notifiedShowIds.has(proof.showId),
    });
  }
}

/**
 * One heads-up per link and verified proof. Never throws. A missing
 * notices table sends nothing. send_failed deletes the claim so a
 * later sweep can retry. no_api_key and managed_inbox_unset keep the
 * row and are not retried.
 */
export async function notifyRepsOfOwnerVerification(input: {
  proofId: string;
  linkIds?: string[];
  trigger: HeadsUpTrigger;
  ownerNotified?: boolean;
}): Promise<OwnerHeadsUpCounts> {
  const counts: OwnerHeadsUpCounts = { sent: 0, already: 0, skipped: 0 };
  try {
    const proof = await readProofById(input.proofId);
    if (!proof || proof.status !== "verified") return counts;
    const show = await readShowForHeadsUp(proof.showId);
    if (!show || show.ownership !== "verified") return counts;

    const loaded = await readHeadsUpLinks(proof.showId, input.linkIds);
    const found = new Set(loaded.map((link) => link.id));
    if (input.linkIds) {
      counts.skipped += input.linkIds.filter((id) => !found.has(id)).length;
    }

    const eligible: HeadsUpLink[] = [];
    for (const link of loaded) {
      if (link.showId !== proof.showId) {
        counts.skipped += 1;
        continue;
      }
      if (link.status !== "pending" && link.status !== "approved") {
        counts.skipped += 1;
        continue;
      }
      if (link.agentId === proof.userId) {
        counts.skipped += 1;
        continue;
      }
      eligible.push(link);
    }

    const capped = eligible.slice(0, ROSTER_HEADS_UP_CAP);
    if (eligible.length > ROSTER_HEADS_UP_CAP) {
      const overflow = eligible.length - ROSTER_HEADS_UP_CAP;
      console.error(`[roster-notify] heads_up_cap ${overflow}`);
      counts.skipped += overflow;
    }
    if (capped.length === 0) return counts;

    const emails = await readProfileEmails(capped.map((link) => link.agentId));
    let missingEmail = 0;
    let reportedMissingTable = false;
    for (const link of capped) {
      const email = emails.get(link.agentId);
      if (!email) {
        missingEmail += 1;
        counts.skipped += 1;
        continue;
      }
      const claim = await claimOwnerNotice({
        linkId: link.id,
        proofId: proof.id,
        repUserId: link.agentId,
        trigger: input.trigger,
      });
      if (claim === "missing_table") {
        if (!reportedMissingTable) {
          console.error("[roster-notify] owner_heads_up missing_table");
          reportedMissingTable = true;
        }
        counts.skipped += 1;
        continue;
      }
      if (claim === "already") {
        counts.already += 1;
        continue;
      }
      if (claim !== "claimed") {
        counts.skipped += 1;
        continue;
      }

      let result: SendEmailResult;
      try {
        const rendered = renderRosterRepOwnerHeadsUp({
          showName: show.name,
          trigger: input.trigger,
          linkStatus: link.status === "approved" ? "approved" : "pending",
          ownerNotified: input.ownerNotified === true,
        });
        result = await deliver("owner_heads_up", {
          to: email,
          subject: rendered.subject,
          html: rendered.html,
          text: rendered.text,
          recipientProfileId: link.agentId,
        });
      } catch (err) {
        logRosterNotify("owner_heads_up", err);
        result = { ok: false, reason: "send_failed" };
      }

      const stored = await finishOwnerNotice(link.id, proof.id, result);
      await logEvent({
        eventType: "roster_link.owner_heads_up",
        entityType: "roster_link",
        entityId: link.id,
        actorId: null,
        payload: {
          link_id: link.id,
          show_id: proof.showId,
          proof_id: proof.id,
          trigger: input.trigger,
          result: stored,
        },
      });
      if (stored === "sent") counts.sent += 1;
      else counts.skipped += 1;
    }
    if (missingEmail > 0) {
      console.error(`[roster-notify] owner_heads_up no_email ${missingEmail}`);
    }
  } catch (err) {
    logRosterNotify("owner_heads_up", err);
  }
  return counts;
}

/**
 * Heads-up for a proof verified after the link existed, and for an
 * import send that failed inside the last 7 days. Never throws.
 */
export async function sweepOwnerVerificationNotices(): Promise<OwnerHeadsUpCounts> {
  const totals: OwnerHeadsUpCounts = { sent: 0, already: 0, skipped: 0 };
  try {
    const cutoff = new Date(Date.now() - ROSTER_OWNER_NOTICE_WINDOW_MS).toISOString();
    const recentProofs = await listProofsVerifiedSince(cutoff);
    const recentLinks = await listLinksCreatedSince(cutoff);
    const showIds = [
      ...new Set([...recentProofs.map((proof) => proof.showId), ...recentLinks.map((link) => link.showId)]),
    ];
    if (showIds.length === 0) return totals;
    const ownership = await readOwnershipStatus(showIds);
    const verifiedShows = showIds.filter((id) => ownership.get(id) === "verified");
    if (verifiedShows.length === 0) return totals;
    const verified = new Set(verifiedShows);

    const proofShows = [...new Set(recentProofs.filter((proof) => verified.has(proof.showId)).map((proof) => proof.showId))];
    const linkShows = [...new Set(recentLinks.filter((link) => verified.has(link.showId)).map((link) => link.showId))];
    const linksOnProofShows = proofShows.length > 0 ? await listLinksForShows(proofShows) : [];
    const proofsOnLinkShows = linkShows.length > 0 ? await listVerifiedProofsOnShows(linkShows) : [];

    const proofs = dedupeProofs([
      ...recentProofs.filter((proof) => verified.has(proof.showId)),
      ...proofsOnLinkShows.filter((proof) => verified.has(proof.showId)),
    ]);
    const links = dedupeLinks([
      ...linksOnProofShows,
      ...recentLinks.filter((link) => verified.has(link.showId)),
    ]);

    const pairs: { proofId: string; linkId: string }[] = [];
    for (const proof of proofs) {
      for (const link of links) {
        if (link.showId !== proof.showId) continue;
        if (proof.verifiedAt < cutoff && link.createdAt < cutoff) continue;
        pairs.push({ proofId: proof.id, linkId: link.id });
      }
    }
    if (pairs.length === 0) return totals;

    const notices = await listOwnerNotices(pairs.map((pair) => pair.linkId));
    if (notices === "missing") {
      console.error("[roster-notify] owner_heads_up missing_table");
      return totals;
    }
    const have = new Set(
      notices
        .filter((row) => !isStaleClaim(row.result, row.createdAt))
        .map((row) => `${row.linkId}:${row.proofId}`)
    );
    const pending = pairs
      .filter((pair) => !have.has(`${pair.linkId}:${pair.proofId}`))
      .slice(0, ROSTER_OWNER_SWEEP_LIMIT);
    const byProof = new Map<string, string[]>();
    for (const pair of pending) {
      const list = byProof.get(pair.proofId) ?? [];
      list.push(pair.linkId);
      byProof.set(pair.proofId, list);
    }
    for (const [proofId, linkIds] of byProof) {
      for (let index = 0; index < linkIds.length; index += ROSTER_HEADS_UP_CAP) {
        const result = await notifyRepsOfOwnerVerification({
          proofId,
          linkIds: linkIds.slice(index, index + ROSTER_HEADS_UP_CAP),
          trigger: "verified_later",
        });
        totals.sent += result.sent;
        totals.already += result.already;
        totals.skipped += result.skipped;
      }
    }
  } catch (err) {
    logRosterNotify("owner_sweep", err);
  }
  return totals;
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

async function readVerifiedProofs(showIds: string[]): Promise<VerifiedProof[]> {
  const { data, error } = await supabaseAdmin
    .from("show_ownership_proofs")
    .select("id, show_id, user_id")
    .in("show_id", showIds)
    .eq("status", "verified");
  if (error) {
    const failure = new Error("verified proof read failed");
    failure.name = error.code || "PostgrestError";
    throw failure;
  }
  const out: VerifiedProof[] = [];
  for (const row of data ?? []) {
    const showId = text((row as { show_id?: unknown }).show_id);
    const userId = text((row as { user_id?: unknown }).user_id);
    const id = text((row as { id?: unknown }).id);
    if (showId && userId) out.push({ id, showId, userId });
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

function isMissingNotices(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  const code = error.code ?? "";
  if (code === "42P01" || code === "PGRST205") return true;
  const message = error.message ?? "";
  return (
    /roster_owner_verified_notices/i.test(message) &&
    /schema cache|does not exist|could not find/i.test(message)
  );
}

function namedRead(message: string, code: string | undefined): Error {
  const failure = new Error(message);
  failure.name = code || "PostgrestError";
  return failure;
}

async function readProofById(proofId: string): Promise<{
  id: string;
  showId: string;
  userId: string;
  status: string;
  verifiedAt: string;
} | null> {
  const { data, error } = await supabaseAdmin
    .from("show_ownership_proofs")
    .select("id, show_id, user_id, status, verified_at")
    .eq("id", proofId)
    .maybeSingle();
  if (error) throw namedRead("ownership proof read failed", error.code);
  if (!data) return null;
  const row = data as Record<string, unknown>;
  const id = text(row.id);
  const showId = text(row.show_id);
  const userId = text(row.user_id);
  if (!id || !showId || !userId) return null;
  return {
    id,
    showId,
    userId,
    status: text(row.status),
    verifiedAt: text(row.verified_at),
  };
}

async function readShowForHeadsUp(
  showId: string
): Promise<{ ownership: string; name: string } | null> {
  const { data, error } = await supabaseAdmin
    .from("shows")
    .select("id, name, ownership_status")
    .eq("id", showId)
    .maybeSingle();
  if (error) throw namedRead("ownership status read failed", error.code);
  if (!data) return null;
  const row = data as Record<string, unknown>;
  return { ownership: text(row.ownership_status), name: text(row.name) || "your show" };
}

async function readHeadsUpLinks(showId: string, linkIds?: string[]): Promise<HeadsUpLink[]> {
  if (linkIds && linkIds.length === 0) return [];
  const built = linkIds
    ? supabaseAdmin
        .from("agent_show_relationships")
        .select("id, show_id, agent_id, status, created_at")
        .in("id", linkIds)
    : supabaseAdmin
        .from("agent_show_relationships")
        .select("id, show_id, agent_id, status, created_at")
        .eq("show_id", showId)
        .in("status", ["pending", "approved"]);
  const { data, error } = await built;
  if (error) throw namedRead("roster link read failed", error.code);
  return mapLinks(data ?? []);
}

async function listProofsVerifiedSince(cutoff: string): Promise<SweepProof[]> {
  const { data, error } = await supabaseAdmin
    .from("show_ownership_proofs")
    .select("id, show_id, user_id, status, verified_at")
    .eq("status", "verified")
    .gte("verified_at", cutoff)
    .limit(ROSTER_OWNER_SWEEP_LIMIT);
  if (error) throw namedRead("ownership proof read failed", error.code);
  return mapProofs(data ?? []);
}

async function listVerifiedProofsOnShows(showIds: string[]): Promise<SweepProof[]> {
  const { data, error } = await supabaseAdmin
    .from("show_ownership_proofs")
    .select("id, show_id, user_id, status, verified_at")
    .eq("status", "verified")
    .in("show_id", showIds);
  if (error) throw namedRead("ownership proof read failed", error.code);
  return mapProofs(data ?? []);
}

async function listLinksCreatedSince(cutoff: string): Promise<HeadsUpLink[]> {
  const { data, error } = await supabaseAdmin
    .from("agent_show_relationships")
    .select("id, show_id, agent_id, status, created_at")
    .in("status", ["pending", "approved"])
    .gte("created_at", cutoff)
    .limit(ROSTER_OWNER_SWEEP_LIMIT);
  if (error) throw namedRead("roster link read failed", error.code);
  return mapLinks(data ?? []);
}

async function listLinksForShows(showIds: string[]): Promise<HeadsUpLink[]> {
  const { data, error } = await supabaseAdmin
    .from("agent_show_relationships")
    .select("id, show_id, agent_id, status, created_at")
    .in("show_id", showIds)
    .in("status", ["pending", "approved"]);
  if (error) throw namedRead("roster link read failed", error.code);
  return mapLinks(data ?? []);
}

interface SweepProof {
  id: string;
  showId: string;
  userId: string;
  verifiedAt: string;
}

function mapProofs(rows: unknown[]): SweepProof[] {
  const out: SweepProof[] = [];
  for (const item of rows) {
    const row = item as Record<string, unknown>;
    const id = text(row.id);
    const showId = text(row.show_id);
    const userId = text(row.user_id);
    if (!id || !showId || !userId) continue;
    if (text(row.status) !== "verified") continue;
    out.push({ id, showId, userId, verifiedAt: text(row.verified_at) });
  }
  return out;
}

function mapLinks(rows: unknown[]): HeadsUpLink[] {
  const out: HeadsUpLink[] = [];
  for (const item of rows) {
    const row = item as Record<string, unknown>;
    const id = text(row.id);
    const showId = text(row.show_id);
    const agentId = text(row.agent_id);
    if (!id || !showId || !agentId) continue;
    out.push({
      id,
      showId,
      agentId,
      status: text(row.status),
      createdAt: text(row.created_at),
    });
  }
  return out;
}

function dedupeProofs(rows: SweepProof[]): SweepProof[] {
  const seen = new Set<string>();
  return rows.filter((row) => {
    if (seen.has(row.id)) return false;
    seen.add(row.id);
    return true;
  });
}

function dedupeLinks(rows: HeadsUpLink[]): HeadsUpLink[] {
  const seen = new Set<string>();
  return rows.filter((row) => {
    if (seen.has(row.id)) return false;
    seen.add(row.id);
    return true;
  });
}

function isStaleClaim(result: string, createdAt: string, now = Date.now()): boolean {
  if (result !== "claimed") return false;
  const created = Date.parse(createdAt);
  if (!Number.isFinite(created)) return false;
  return now - created > STALE_CLAIM_MS;
}

async function listOwnerNotices(
  linkIds: string[]
): Promise<{ linkId: string; proofId: string; result: string; createdAt: string }[] | "missing"> {
  const ids = [...new Set(linkIds)];
  if (ids.length === 0) return [];
  const { data, error } = await supabaseAdmin
    .from("roster_owner_verified_notices")
    .select("link_id, proof_id, result, created_at")
    .in("link_id", ids);
  if (error && isMissingNotices(error)) return "missing";
  if (error) throw namedRead("owner notice read failed", error.code);
  const out: { linkId: string; proofId: string; result: string; createdAt: string }[] = [];
  for (const item of data ?? []) {
    const row = item as Record<string, unknown>;
    const linkId = text(row.link_id);
    const proofId = text(row.proof_id);
    if (linkId && proofId) {
      out.push({
        linkId,
        proofId,
        result: text(row.result),
        createdAt: text(row.created_at),
      });
    }
  }
  return out;
}

type ClaimResult = "claimed" | "already" | "missing_table" | "failed";

async function insertOwnerNotice(input: {
  linkId: string;
  proofId: string;
  repUserId: string;
  trigger: HeadsUpTrigger;
}): Promise<ClaimResult> {
  const { data, error } = await supabaseAdmin
    .from("roster_owner_verified_notices")
    .insert({
      link_id: input.linkId,
      proof_id: input.proofId,
      rep_user_id: input.repUserId,
      trigger: input.trigger,
    })
    .select("id")
    .maybeSingle();
  if (error?.code === "23505") return "already";
  if (error && isMissingNotices(error)) return "missing_table";
  if (error || !data) {
    logRosterNotify("owner_heads_up", namedRead("owner notice claim failed", error?.code));
    return "failed";
  }
  return "claimed";
}

async function claimOwnerNotice(input: {
  linkId: string;
  proofId: string;
  repUserId: string;
  trigger: HeadsUpTrigger;
}): Promise<ClaimResult> {
  const inserted = await insertOwnerNotice(input);
  if (inserted !== "already") return inserted;

  const { data, error } = await supabaseAdmin
    .from("roster_owner_verified_notices")
    .select("result, created_at")
    .eq("link_id", input.linkId)
    .eq("proof_id", input.proofId)
    .maybeSingle();
  if (error || !data) return "already";
  const row = data as { result?: unknown; created_at?: unknown };
  if (!isStaleClaim(text(row.result), text(row.created_at))) return "already";

  const cutoff = new Date(Date.now() - STALE_CLAIM_MS).toISOString();
  const removed = await supabaseAdmin
    .from("roster_owner_verified_notices")
    .delete()
    .eq("link_id", input.linkId)
    .eq("proof_id", input.proofId)
    .eq("result", "claimed")
    .lt("created_at", cutoff)
    .select("id");
  if (removed.error || !Array.isArray(removed.data) || removed.data.length === 0) return "already";
  return insertOwnerNotice(input);
}

async function finishOwnerNotice(
  linkId: string,
  proofId: string,
  result: SendEmailResult
): Promise<"sent" | "no_api_key" | "managed_inbox_unset" | "send_failed"> {
  if (result.ok) {
    const { error } = await supabaseAdmin
      .from("roster_owner_verified_notices")
      .update({ result: "sent", sent_at: new Date().toISOString() })
      .eq("link_id", linkId)
      .eq("proof_id", proofId);
    if (error) logRosterNotify("owner_heads_up", namedRead("owner notice update failed", error.code));
    return "sent";
  }
  if (result.reason === "no_api_key" || result.reason === "managed_inbox_unset") {
    const { error } = await supabaseAdmin
      .from("roster_owner_verified_notices")
      .update({ result: result.reason })
      .eq("link_id", linkId)
      .eq("proof_id", proofId);
    if (error) logRosterNotify("owner_heads_up", namedRead("owner notice update failed", error.code));
    return result.reason;
  }
  const { error } = await supabaseAdmin
    .from("roster_owner_verified_notices")
    .delete()
    .eq("link_id", linkId)
    .eq("proof_id", proofId);
  if (error) logRosterNotify("owner_heads_up", namedRead("owner notice delete failed", error.code));
  return "send_failed";
}

function embedded(value: unknown): Record<string, unknown> | null {
  const row = Array.isArray(value) ? value[0] : value;
  if (!row || typeof row !== "object") return null;
  return row as Record<string, unknown>;
}
