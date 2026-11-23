// Who may edit a catalog show.
//
// The same rule as claimLookup in persist.ts, plus a verified proof
// whose user_id is this auth user. A deal show_profile_id is not
// enough. A show_owner contact email is not enough. profiles.email
// is not read. Identity is auth.uid() only.
//
// Admin is isInternalAdmin on the auth login from getUserById, the
// same source as isShowsAdmin. The allowlist is not in the database,
// so the SQL function has no admin branch.
//
// Deal grants stay dormant. No current route records the show user's
// auth.uid() as domain_events.actor_id. This file does not add that
// plumbing.

import { supabaseAdmin } from "@/lib/supabase/admin";
import { isInternalAdmin } from "@/lib/auth/admin";
import { ownerShowSlug } from "@/lib/shows/surfaces";

const SHOW_ACTION_EVENTS = ["deal.created", "io.show_signed", "io.counter_accepted"] as const;
const SOURCED_CONTACT = ["podscan", "apple_rss"] as const;

type DbRow = Record<string, unknown>;

function errorCode(error: { code?: string } | null): string {
  return typeof error?.code === "string" && error.code ? error.code : "unknown";
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function lower(value: unknown): string {
  return text(value).toLowerCase();
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.length > 0))];
}

function isShowOwnerRow(value: unknown): boolean {
  return Array.isArray(value) && value.includes("show_owner");
}

function warn(code: string): void {
  console.warn("[show-edit]", code);
}

async function rowsIn(
  table: string,
  column: string,
  values: string[],
  columns: string
): Promise<{ ok: true; rows: DbRow[] } | { ok: false }> {
  if (values.length === 0) return { ok: true, rows: [] };
  try {
    const { data, error } = await supabaseAdmin.from(table).select(columns).in(column, values);
    if (error) {
      warn(errorCode(error));
      return { ok: false };
    }
    return { ok: true, rows: (data ?? []) as unknown as DbRow[] };
  } catch {
    warn("unknown");
    return { ok: false };
  }
}

interface Login {
  admin: boolean;
  confirmedEmail: string | null;
}

async function readLogin(userId: string): Promise<Login> {
  try {
    const result = await supabaseAdmin.auth.admin.getUserById(userId);
    if (result.error) {
      warn(errorCode(result.error));
      return { admin: false, confirmedEmail: null };
    }
    const email = lower(result.data?.user?.email);
    const confirmed = text(result.data?.user?.email_confirmed_at).length > 0;
    return {
      admin: confirmed && isInternalAdmin(email || null),
      confirmedEmail: email && confirmed ? email : null,
    };
  } catch {
    warn("unknown");
    return { admin: false, confirmedEmail: null };
  }
}

async function readProfile(userId: string): Promise<{ ok: true; id: string | null } | { ok: false }> {
  try {
    const { data, error } = await supabaseAdmin
      .from("show_profiles")
      .select("id")
      .eq("user_id", userId)
      .maybeSingle();
    if (error) {
      warn(errorCode(error));
      return { ok: false };
    }
    const id = text(data?.id);
    return { ok: true, id: id || null };
  } catch {
    warn("unknown");
    return { ok: false };
  }
}

function ownerMatch(row: DbRow, userId: string, email: string): boolean {
  const showId = text(row.id);
  if (!showId || !isShowOwnerRow(row.data_sources)) return false;
  if (lower(row.slug) !== ownerShowSlug(userId).toLowerCase()) return false;
  return lower(row.contact_email) === email;
}

function showActed(deal: DbRow, outreach: DbRow | undefined): boolean {
  if (!outreach) return false;
  const response = text(outreach.response_status);
  if (response === "declined" || text(deal.status) === "cancelled") return false;
  return response === "accepted" || text(deal.show_signed_at).length > 0;
}

function sourcedEmail(contacts: DbRow[], showId: string, sentTo: string): boolean {
  const wanted = lower(sentTo);
  if (!wanted) return false;
  return contacts.some((row) => {
    const source = text(row.source);
    if (!SOURCED_CONTACT.includes(source as (typeof SOURCED_CONTACT)[number])) return false;
    if (lower(row.email) !== wanted) return false;
    return text(row.show_id) === showId;
  });
}

function actorRecorded(events: DbRow[], deal: DbRow, userId: string): boolean {
  const dealId = text(deal.id);
  const outreachId = text(deal.outreach_id);
  return events.some((event) => {
    if (text(event.actor_id) !== userId) return false;
    const type = text(event.event_type);
    if (!SHOW_ACTION_EVENTS.includes(type as (typeof SHOW_ACTION_EVENTS)[number])) return false;
    const entityId = text(event.entity_id);
    const entityType = text(event.entity_type);
    return (
      (entityType === "deal" && entityId === dealId) ||
      (entityType === "outreach" && entityId === outreachId)
    );
  });
}

async function addDealGrants(
  userId: string,
  profileId: string,
  showIds: string[],
  granted: Set<string>
): Promise<void> {
  const deals = await rowsIn(
    "deals",
    "show_id",
    showIds,
    "id, show_id, show_profile_id, outreach_id, status, show_signed_at"
  );
  if (!deals.ok) return;
  const mine = deals.rows.filter(
    (row) => text(row.show_profile_id) === profileId && text(row.show_id).length > 0
  );
  if (mine.length === 0) return;

  const outreachIds = unique(mine.map((row) => text(row.outreach_id)));
  const [outreaches, contacts, events] = await Promise.all([
    rowsIn("outreaches", "id", outreachIds, "id, sent_to_email, response_status"),
    rowsIn("show_contacts", "show_id", showIds, "show_id, email, source"),
    rowsIn("domain_events", "actor_id", [userId], "actor_id, entity_type, entity_id, event_type"),
  ]);
  if (!outreaches.ok || !contacts.ok || !events.ok) return;

  const outreachById = new Map(outreaches.rows.map((row) => [text(row.id), row]));
  const sourced = contacts.rows.filter((row) =>
    SOURCED_CONTACT.includes(text(row.source) as (typeof SOURCED_CONTACT)[number])
  );
  for (const deal of mine) {
    const showId = text(deal.show_id);
    const outreach = outreachById.get(text(deal.outreach_id));
    if (!showId || !outreach) continue;
    if (!showActed(deal, outreach)) continue;
    if (!sourcedEmail(sourced, showId, text(outreach.sent_to_email))) continue;
    if (!actorRecorded(events.rows, deal, userId)) continue;
    granted.add(showId);
  }
}

/**
 * Show ids from the list that this auth user may edit.
 * A read failure skips that branch. It does not grant the rest of
 * a failed read. Does not log emails or ids.
 */
export async function showEditGrantIds(userId: string, showIds: string[]): Promise<Set<string>> {
  const caller = text(userId);
  const ids = unique(showIds.map(text));
  const granted = new Set<string>();
  if (!caller || ids.length === 0) return granted;

  const login = await readLogin(caller);
  if (login.admin) {
    for (const id of ids) granted.add(id);
    return granted;
  }

  const [shows, profile, proofs] = await Promise.all([
    rowsIn("shows", "id", ids, "id, contact_email, data_sources, slug"),
    readProfile(caller),
    verifiedProofs(caller, ids),
  ]);

  if (shows.ok && profile.ok && profile.id && login.confirmedEmail) {
    for (const row of shows.rows) {
      if (ownerMatch(row, caller, login.confirmedEmail)) granted.add(text(row.id));
    }
  }

  if (proofs.ok) {
    for (const showId of proofs.ids) granted.add(showId);
  }

  if (profile.ok && profile.id && login.confirmedEmail) {
    await addDealGrants(caller, profile.id, ids, granted);
  }

  return granted;
}

async function verifiedProofs(
  userId: string,
  showIds: string[]
): Promise<{ ok: true; ids: string[] } | { ok: false }> {
  try {
    const { data, error } = await supabaseAdmin
      .from("show_ownership_proofs")
      .select("show_id, user_id, status")
      .in("show_id", showIds)
      .eq("user_id", userId)
      .eq("status", "verified");
    if (error) {
      warn(errorCode(error));
      return { ok: false };
    }
    const ids: string[] = [];
    for (const row of (data ?? []) as DbRow[]) {
      if (text(row.user_id) !== userId || text(row.status) !== "verified") continue;
      const showId = text(row.show_id);
      if (showId && showIds.includes(showId)) ids.push(showId);
    }
    return { ok: true, ids };
  } catch {
    warn("unknown");
    return { ok: false };
  }
}

/** True when this auth user may edit this show. Missing ids are false. */
export async function showEditGrant(userId: string, showId: string): Promise<boolean> {
  if (!text(userId) || !text(showId)) return false;
  const granted = await showEditGrantIds(userId, [showId]);
  return granted.has(text(showId));
}
