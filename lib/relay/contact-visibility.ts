// Who may see a show contact email. Fail closed. Server only.
// Do not import this module from a client component.

import { supabaseAdmin } from "@/lib/supabase/admin";
import { isShowsAdmin } from "@/lib/shows/can-edit-show";
import { showEditGrantIds } from "@/lib/ownership/edit-rights";
import { isRelayUnlocked } from "@/lib/relay/unlock";

export const CONTACT_FIELDS_HIDDEN = ["contact_email", "contactEmail", "contact.email"] as const;

const CHUNK = 80;

type DealRow = {
  show_id?: unknown;
  outreach_id?: unknown;
  brand_id?: unknown;
  agency_id?: unknown;
  brand_profile_id?: unknown;
  show_signed_at?: string | null;
  brand_signed_at?: string | null;
  status?: string | null;
};

export async function contactVisibleShowIds(
  userId: string,
  showIds: string[]
): Promise<Set<string>> {
  const visible = new Set<string>();
  const ids = uniqueIds(showIds);
  if (!userId || ids.length === 0) return visible;

  try {
    if (await isShowsAdmin(userId)) {
      for (const id of ids) visible.add(id);
      return visible;
    }
  } catch {
    console.warn("[relay] contact visibility", "unknown");
  }

  try {
    for (const id of await showEditGrantIds(userId, ids)) visible.add(id);
  } catch {
    console.warn("[relay] contact visibility", "unknown");
  }

  try {
    for (const id of await rosterShowIds(userId, ids)) visible.add(id);
  } catch {
    console.warn("[relay] contact visibility", "unknown");
  }

  try {
    for (const id of await unlockedDealShowIds(userId, ids)) visible.add(id);
  } catch {
    console.warn("[relay] contact visibility", "unknown");
  }

  return visible;
}

export async function contactVisibleOutreachIds(
  userId: string,
  outreachIds: string[]
): Promise<Set<string>> {
  const visible = new Set<string>();
  const ids = uniqueIds(outreachIds);
  if (!userId || ids.length === 0) return visible;
  try {
    if (await isShowsAdmin(userId)) {
      for (const id of ids) visible.add(id);
      return visible;
    }
  } catch {
    console.warn("[relay] contact visibility", "unknown");
    return visible;
  }
  try {
    const profiles = await brandProfileIds(userId);
    for (const chunk of chunks(ids)) {
      const { data, error } = await supabaseAdmin
        .from("deals")
        .select("outreach_id, brand_id, agency_id, brand_profile_id, show_signed_at, brand_signed_at, status")
        .in("outreach_id", chunk);
      if (error) {
        console.warn("[relay] contact visibility", error.code ?? "unknown");
        continue;
      }
      for (const row of (data ?? []) as DealRow[]) {
        const outreachId = text(row.outreach_id);
        if (!outreachId || !ownsDeal(row, userId, profiles)) continue;
        if (isRelayUnlocked(row)) visible.add(outreachId);
      }
    }
  } catch {
    console.warn("[relay] contact visibility", "unknown");
  }
  return visible;
}

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Fill contact.email for ids the caller may already see. Other rows stay
 * as they were (an empty string after a user-client read). A read error
 * returns the input unchanged. Never throws.
 */
export async function attachVisibleShowContacts<
  T extends { id: string; contact?: { email?: string | null } | null },
>(shows: T[], visible: ReadonlySet<string>): Promise<T[]> {
  const ids = uuidIds(visible);
  if (ids.length === 0) return shows;
  try {
    const emails = new Map<string, string>();
    for (const chunk of chunks(ids)) {
      const { data, error } = await supabaseAdmin
        .from("shows")
        .select("id, contact_email")
        .in("id", chunk);
      if (error) {
        console.warn("[relay] attach contact", error.code ?? "unknown");
        return shows;
      }
      for (const row of (data ?? []) as Array<{ id?: unknown; contact_email?: unknown }>) {
        if (typeof row.id !== "string" || !rowHas(row, "contact_email")) continue;
        emails.set(row.id, typeof row.contact_email === "string" ? row.contact_email : "");
      }
    }
    if (emails.size === 0) return shows;
    return shows.map((show) => {
      if (!emails.has(show.id)) return show;
      const contact =
        show.contact && typeof show.contact === "object" ? show.contact : {};
      return { ...show, contact: { ...contact, email: emails.get(show.id) ?? "" } };
    });
  } catch {
    console.warn("[relay] attach contact", "unknown");
    return shows;
  }
}

/** Same rule for outreaches.sent_to_email. Never throws. */
export async function attachVisibleOutreachEmails<T extends { id: string }>(
  rows: T[],
  visible: ReadonlySet<string>
): Promise<T[]> {
  const ids = uuidIds(visible);
  if (ids.length === 0) return rows;
  try {
    const emails = new Map<string, string>();
    for (const chunk of chunks(ids)) {
      const { data, error } = await supabaseAdmin
        .from("outreaches")
        .select("id, sent_to_email")
        .in("id", chunk);
      if (error) {
        console.warn("[relay] attach contact", error.code ?? "unknown");
        return rows;
      }
      for (const row of (data ?? []) as Array<{ id?: unknown; sent_to_email?: unknown }>) {
        if (typeof row.id !== "string" || !rowHas(row, "sent_to_email")) continue;
        emails.set(row.id, typeof row.sent_to_email === "string" ? row.sent_to_email : "");
      }
    }
    if (emails.size === 0) return rows;
    return rows.map((row) => {
      if (!emails.has(row.id)) return row;
      return { ...row, sent_to_email: emails.get(row.id) ?? "" };
    });
  } catch {
    console.warn("[relay] attach contact", "unknown");
    return rows;
  }
}

function uuidIds(values: ReadonlySet<string>): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    if (!UUID.test(value) || seen.has(value)) continue;
    seen.add(value);
    ids.push(value);
  }
  return ids;
}

function rowHas(row: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(row, key);
}

export function redactShowContact<T extends { contact?: { email?: string | null } | null }>(show: T): T {
  if (!show || typeof show !== "object") return show;
  const contact = show.contact;
  if (!contact || typeof contact !== "object") return { ...show };
  return { ...show, contact: { ...contact, email: "" } };
}

export function redactScoredShowRecord<T extends { contactEmail?: string | null }>(record: T): T {
  return { ...record, contactEmail: null };
}

export function redactCampaignContacts<T>(campaign: T): T {
  if (!campaign || typeof campaign !== "object") return campaign;
  const copy = { ...(campaign as Record<string, unknown>) };
  for (const key of [
    "recommendations",
    "youtube_recommendations",
    "expansion_opportunities",
    "outreach_drafts",
  ]) {
    const value = copy[key];
    if (!Array.isArray(value)) continue;
    copy[key] = value.map((row) => blankContactEmail(row));
  }
  if (Array.isArray(copy.scored_shows)) {
    copy.scored_shows = copy.scored_shows.map((row) => {
      if (!row || typeof row !== "object") return row;
      return redactScoredShowRecord(row as { contactEmail?: string | null });
    });
  }
  return copy as T;
}

export function redactTieredUniverse<
  Row extends { showId: string; show: { id: string; contact?: { email?: string | null } | null } | null },
  T extends { test: Row[]; scale: Row[]; bench: Row[] },
>(tiered: T, visible: ReadonlySet<string>): T {
  const mapRow = (row: Row): Row => {
    if (!row.show) return row;
    const id = row.show.id || row.showId;
    if (visible.has(id) || visible.has(row.showId)) return row;
    return { ...row, show: redactShowContact(row.show) };
  };
  return {
    ...tiered,
    test: tiered.test.map(mapRow),
    scale: tiered.scale.map(mapRow),
    bench: tiered.bench.map(mapRow),
  };
}

export function redactConvictionUniverse<
  T extends { groups: Array<{ shows: Array<{ show: ({ id: string; contact?: { email?: string | null } | null } | null) }> }> },
>(universe: T, visible: ReadonlySet<string>): T {
  return {
    ...universe,
    groups: universe.groups.map((group) => ({
      ...group,
      shows: group.shows.map((entry) => {
        if (!entry.show || visible.has(entry.show.id)) return entry;
        return { ...entry, show: redactShowContact(entry.show) };
      }),
    })),
  };
}

function blankContactEmail(row: unknown): unknown {
  if (!row || typeof row !== "object" || !("contact_email" in row)) return row;
  return { ...(row as Record<string, unknown>), contact_email: "" };
}

async function rosterShowIds(userId: string, showIds: string[]): Promise<string[]> {
  const out: string[] = [];
  for (const chunk of chunks(showIds)) {
    const { data, error } = await supabaseAdmin
      .from("agent_show_relationships")
      .select("show_id, status")
      .eq("agent_id", userId)
      .in("show_id", chunk);
    if (error) {
      console.warn("[relay] contact visibility", error.code ?? "unknown");
      continue;
    }
    for (const row of (data ?? []) as Array<{ show_id?: unknown; status?: unknown }>) {
      const showId = text(row.show_id);
      if (!showId || row.status !== "approved") continue;
      out.push(showId);
    }
  }
  return out;
}

async function unlockedDealShowIds(userId: string, showIds: string[]): Promise<string[]> {
  const profiles = await brandProfileIds(userId);
  const out: string[] = [];
  for (const chunk of chunks(showIds)) {
    const { data, error } = await supabaseAdmin
      .from("deals")
      .select("show_id, brand_id, agency_id, brand_profile_id, show_signed_at, brand_signed_at, status")
      .in("show_id", chunk);
    if (error) {
      console.warn("[relay] contact visibility", error.code ?? "unknown");
      continue;
    }
    for (const row of (data ?? []) as DealRow[]) {
      const showId = text(row.show_id);
      if (!showId || !ownsDeal(row, userId, profiles)) continue;
      if (isRelayUnlocked(row)) out.push(showId);
    }
  }
  return out;
}

async function brandProfileIds(userId: string): Promise<Set<string>> {
  const ids = new Set<string>();
  const { data, error } = await supabaseAdmin
    .from("brand_profiles")
    .select("id")
    .eq("user_id", userId);
  if (error) {
    console.warn("[relay] contact visibility", error.code ?? "unknown");
    return ids;
  }
  for (const row of (data ?? []) as Array<{ id?: unknown }>) {
    const id = text(row.id);
    if (id) ids.add(id);
  }
  return ids;
}

function ownsDeal(row: DealRow, userId: string, profiles: ReadonlySet<string>): boolean {
  const profileId = text(row.brand_profile_id);
  return row.brand_id === userId || row.agency_id === userId || (profileId != null && profiles.has(profileId));
}

function chunks(ids: string[]): string[][] {
  const out: string[][] = [];
  for (let index = 0; index < ids.length; index += CHUNK) {
    out.push(ids.slice(index, index + CHUNK));
  }
  return out;
}

function uniqueIds(values: string[]): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    if (typeof value !== "string" || value.length === 0 || seen.has(value)) continue;
    seen.add(value);
    ids.push(value);
  }
  return ids;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}
