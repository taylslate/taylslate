// Writes ownership_status. Verified is always legal. Claimed is legal
// only after migration 100. A 23514 on that one write is logged as the
// code and the caller continues, so claim, verify, and profile flows
// can ship before the migration.
//
// Claimed is not "any deal" and not "any show_owner email".
// A deal counts only when the show party accepted or signed, the
// show_profile user is the actor recorded on that action, the outreach
// address is a podscan or apple_rss show_contacts row, and that auth
// user has email_confirmed_at. Declined and unsigned deals do not count.
// A show_owner row counts only when its slug is ownerShowSlug(userId),
// the contact email is that confirmed login, and a show_profiles row
// exists. See docs/jobs/VERIFY-RANK1.md.

import { supabaseAdmin } from "@/lib/supabase/admin";
import { ownerShowSlug } from "@/lib/shows/surfaces";
import { ownershipTier, type OwnershipTier } from "@/lib/ownership/tier";

export const OWNERSHIP_CHECK_VIOLATION = "23514";

const SHOW_ACTION_EVENTS = ["deal.created", "io.show_signed", "io.counter_accepted"] as const;
const SOURCED_CONTACT = ["podscan", "apple_rss"] as const;
const OWNER_SLUG = /^owner-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

export interface ClaimRow {
  id: string;
  contact_email?: unknown;
  data_sources?: unknown;
  slug?: unknown;
  podscan_id?: unknown;
}

export type ClaimLookup =
  | { ok: true; ids: Set<string> }
  | { ok: false };

type WriteResult =
  | { ok: true }
  | { ok: false; code: string; unsupported?: boolean };

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

function isShowOwnerRow(value: unknown): boolean {
  return Array.isArray(value) && value.includes("show_owner");
}

function ownerUserId(slug: unknown): string | null {
  const match = OWNER_SLUG.exec(text(slug));
  return match ? match[1].toLowerCase() : null;
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.length > 0))];
}

async function rowsIn(
  table: string,
  column: string,
  values: string[],
  columns: string
): Promise<{ ok: true; rows: DbRow[] } | { ok: false; code: string }> {
  if (values.length === 0) return { ok: true, rows: [] };
  try {
    const { data, error } = await supabaseAdmin.from(table).select(columns).in(column, values);
    if (error) return { ok: false, code: errorCode(error) };
    return { ok: true, rows: (data ?? []) as unknown as DbRow[] };
  } catch {
    return { ok: false, code: "unknown" };
  }
}

async function confirmedLogins(
  userIds: string[]
): Promise<{ ok: true; emailById: Map<string, string> } | { ok: false; code: string }> {
  const ids = unique(userIds);
  if (ids.length === 0) return { ok: true, emailById: new Map() };
  try {
    const auth = (
      supabaseAdmin as unknown as {
        schema?: (name: string) => {
          from: (table: string) => {
            select: (cols: string) => {
              in: (
                col: string,
                vals: string[]
              ) => PromiseLike<{ data: DbRow[] | null; error: { code?: string } | null }>;
            };
          };
        };
      }
    ).schema;
    if (!auth) return { ok: false, code: "unknown" };
    const { data, error } = await auth("auth").from("users").select("id, email, email_confirmed_at").in("id", ids);
    if (error) return { ok: false, code: errorCode(error) };
    const emailById = new Map<string, string>();
    for (const row of data ?? []) {
      const id = text(row.id);
      const email = lower(row.email);
      if (!id || !email || !text(row.email_confirmed_at)) continue;
      emailById.set(id, email);
    }
    return { ok: true, emailById };
  } catch {
    return { ok: false, code: "unknown" };
  }
}

function sourcedEmail(contacts: DbRow[], showId: string, sentTo: string): boolean {
  const wanted = lower(sentTo);
  if (!wanted) return false;
  return contacts.some((row) => {
    const source = text(row.source);
    if (source !== "podscan" && source !== "apple_rss") return false;
    if (lower(row.email) !== wanted) return false;
    return text(row.show_id) === showId;
  });
}

function showActed(deal: DbRow, outreach: DbRow | undefined): boolean {
  if (!outreach) return false;
  const response = text(outreach.response_status);
  if (response === "declined" || text(deal.status) === "cancelled") return false;
  const accepted = response === "accepted";
  const signed = text(deal.show_signed_at).length > 0;
  return accepted || signed;
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
    return (entityType === "deal" && entityId === dealId) || (entityType === "outreach" && entityId === outreachId);
  });
}

/**
 * Show ids a show account controls under the tight claim rule.
 * A read failure returns ok: false so a sync does not clear a stored
 * claim it could not re-check. Does not log emails or ids.
 */
export async function claimLookup(rows: ClaimRow[]): Promise<ClaimLookup> {
  const shows = rows.filter((row) => text(row.id).length > 0);
  const ids = unique(shows.map((row) => text(row.id)));
  const claimed = new Set<string>();
  if (ids.length === 0) return { ok: true, ids: claimed };

  const deals = await rowsIn(
    "deals",
    "show_id",
    ids,
    "id, show_id, show_profile_id, outreach_id, status, show_signed_at"
  );
  if (!deals.ok) {
    console.warn("[ownership]", deals.code);
    return { ok: false };
  }

  const profileIds = unique(deals.rows.map((row) => text(row.show_profile_id)));
  const outreachIds = unique(deals.rows.map((row) => text(row.outreach_id)));
  const ownerIds = unique(
    shows.filter((row) => isShowOwnerRow(row.data_sources)).map((row) => ownerUserId(row.slug) ?? "")
  );

  const [outreaches, contactsByShow, profilesById, profilesByUser] = await Promise.all([
    rowsIn("outreaches", "id", outreachIds, "id, sent_to_email, response_status"),
    rowsIn("show_contacts", "show_id", ids, "show_id, email, source"),
    rowsIn("show_profiles", "id", profileIds, "id, user_id"),
    rowsIn("show_profiles", "user_id", ownerIds, "id, user_id"),
  ]);
  if (!outreaches.ok || !contactsByShow.ok || !profilesById.ok || !profilesByUser.ok) {
    const failed = [outreaches, contactsByShow, profilesById, profilesByUser].find((part) => !part.ok);
    console.warn("[ownership]", failed && !failed.ok ? failed.code : "unknown");
    return { ok: false };
  }

  const outreachById = new Map(outreaches.rows.map((row) => [text(row.id), row]));
  const profileUserById = new Map(profilesById.rows.map((row) => [text(row.id), text(row.user_id)]));
  const profilesForUser = new Set(profilesByUser.rows.map((row) => text(row.user_id)));
  const contacts = contactsByShow.rows.filter((row) =>
    SOURCED_CONTACT.includes(text(row.source) as (typeof SOURCED_CONTACT)[number])
  );

  const actorIds = unique([
    ...profileUserById.values(),
    ...ownerIds.filter((id) => profilesForUser.has(id)),
  ]);
  const events = await rowsIn(
    "domain_events",
    "actor_id",
    actorIds,
    "actor_id, entity_type, entity_id, event_type"
  );
  if (!events.ok) {
    console.warn("[ownership]", events.code);
    return { ok: false };
  }
  const logins = await confirmedLogins(actorIds);
  if (!logins.ok) {
    console.warn("[ownership]", logins.code);
    return { ok: false };
  }

  for (const deal of deals.rows) {
    const showId = text(deal.show_id);
    const profileId = text(deal.show_profile_id);
    const userId = profileUserById.get(profileId) ?? "";
    const outreach = outreachById.get(text(deal.outreach_id));
    if (!showId || !profileId || !userId || !outreach) continue;
    if (!logins.emailById.has(userId)) continue;
    if (!showActed(deal, outreach)) continue;
    if (!sourcedEmail(contacts, showId, text(outreach.sent_to_email))) continue;
    if (!actorRecorded(events.rows, deal, userId)) continue;
    claimed.add(showId);
  }

  for (const row of shows) {
    const showId = text(row.id);
    if (!showId || claimed.has(showId) || !isShowOwnerRow(row.data_sources)) continue;
    const userId = ownerUserId(row.slug);
    if (!userId || !profilesForUser.has(userId)) continue;
    if (lower(row.slug) !== ownerShowSlug(userId).toLowerCase()) continue;
    const email = logins.emailById.get(userId);
    if (!email || lower(row.contact_email) !== email) continue;
    claimed.add(showId);
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
 * Claimed and unclaimed updates also require the row not be verified,
 * so a verify that lands between the read and the write is kept.
 * A claimed write that hits the pre-100 check logs 23514 and returns.
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
    const update = supabaseAdmin.from("shows").update({ ownership_status: status }).eq("id", id);
    const filtered = status === "verified" ? update : update.neq("ownership_status", "verified");
    const { error } = await filtered;
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
      .select("id, ownership_status, contact_email, data_sources, slug, podscan_id")
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
        slug: data.slug,
        podscan_id: data.podscan_id,
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
 * Does not attach a brand-facing label.
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
