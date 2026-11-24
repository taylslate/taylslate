// Who may see a show contact email. Fail closed. Server only.
// Do not import this module from a client component.

import { supabaseAdmin } from "@/lib/supabase/admin";
import { isShowsAdmin } from "@/lib/shows/can-edit-show";
import { showEditGrantIds } from "@/lib/ownership/edit-rights";
import { isRelayUnlocked } from "@/lib/relay/unlock";

export const CONTACT_FIELDS_HIDDEN = ["contact_email", "contactEmail", "contact.email"] as const;

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
    const { data, error } = await supabaseAdmin
      .from("deals")
      .select("outreach_id, brand_id, agency_id, brand_profile_id, show_signed_at, brand_signed_at, status")
      .in("outreach_id", ids);
    if (error) {
      console.warn("[relay] contact visibility", error.code ?? "unknown");
      return visible;
    }
    for (const row of (data ?? []) as DealRow[]) {
      const outreachId = text(row.outreach_id);
      if (!outreachId || !ownsDeal(row, userId, profiles)) continue;
      if (isRelayUnlocked(row)) visible.add(outreachId);
    }
  } catch {
    console.warn("[relay] contact visibility", "unknown");
  }
  return visible;
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
  const { data, error } = await supabaseAdmin
    .from("agent_show_relationships")
    .select("show_id, status")
    .eq("agent_id", userId)
    .in("show_id", showIds);
  if (error) {
    console.warn("[relay] contact visibility", error.code ?? "unknown");
    return [];
  }
  const out: string[] = [];
  for (const row of (data ?? []) as Array<{ show_id?: unknown; status?: unknown }>) {
    const showId = text(row.show_id);
    if (!showId || row.status !== "approved") continue;
    out.push(showId);
  }
  return out;
}

async function unlockedDealShowIds(userId: string, showIds: string[]): Promise<string[]> {
  const profiles = await brandProfileIds(userId);
  const { data, error } = await supabaseAdmin
    .from("deals")
    .select("show_id, brand_id, agency_id, brand_profile_id, show_signed_at, brand_signed_at, status")
    .in("show_id", showIds);
  if (error) {
    console.warn("[relay] contact visibility", error.code ?? "unknown");
    return [];
  }
  const out: string[] = [];
  for (const row of (data ?? []) as DealRow[]) {
    const showId = text(row.show_id);
    if (!showId || !ownsDeal(row, userId, profiles)) continue;
    if (isRelayUnlocked(row)) out.push(showId);
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
