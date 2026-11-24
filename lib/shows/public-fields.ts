// Public fields for GET /api/shows.
//
// A signed-in caller with no tie to a show gets an allowlist: id, name,
// platform, audience_size, categories, plus image_url and description
// when those strings are non-empty. image_url is the shows image column.
// Contact, rate card, and every other key stay off that object.
//
// The full show object is returned when showEditGrantIds grants the show,
// when a deals row names this caller as brand_id, agency_id, or
// brand_profile_id, or when an approved roster link does. A deal
// show_profile_id is not a full-row grant. show_profiles.podscan_id is
// not read. GET /api/shows still returns an agent's roster before this
// helper runs.
//
// ownership_status uses the same edit grant. A brand deal does not.

import type { Show } from "@/lib/data/types";
import { ownershipStatusFromRow } from "@/lib/data/show-transform";
import { showEditGrantIds } from "@/lib/ownership/edit-rights";
import { redactShowContact } from "@/lib/relay/contact-visibility";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const PUBLIC_SHOW_FIELDS = [
  "id",
  "name",
  "platform",
  "audience_size",
  "categories",
] as const;

export interface PublicShowFields {
  id: string;
  name: string;
  platform: Show["platform"];
  audience_size: number;
  categories: string[];
  image_url?: string;
  description?: string;
}

export interface ShowAccessRow {
  id: string;
  contact?: { email?: string | null } | null;
  data_sources?: string[] | null;
}

export function toPublicShowFields(row: unknown): PublicShowFields {
  const show =
    row && typeof row === "object" ? (row as Record<string, unknown>) : {};
  const platform: Show["platform"] = show.platform === "youtube" ? "youtube" : "podcast";
  const audience =
    typeof show.audience_size === "number" && Number.isFinite(show.audience_size)
      ? show.audience_size
      : 0;
  const categories = Array.isArray(show.categories)
    ? show.categories.filter((category): category is string => typeof category === "string")
    : [];
  const out: PublicShowFields = {
    id: typeof show.id === "string" ? show.id : "",
    name: typeof show.name === "string" ? show.name : "",
    platform,
    audience_size: audience,
    categories,
  };
  const image = nonEmpty(show.image_url);
  if (image) out.image_url = image;
  const description = nonEmpty(show.description);
  if (description) out.description = description;
  return out;
}

export function projectShows<T extends { id: string }>(
  shows: T[],
  fullIds: ReadonlySet<string>
): Array<T | PublicShowFields> {
  return shows.map((show) =>
    fullIds.has(show.id) ? show : toPublicShowFields(show)
  );
}

export function projectShowsForViewer<T extends { id: string; contact?: { email?: string | null } | null }>(
  shows: T[],
  fullIds: ReadonlySet<string>,
  contactVisible: ReadonlySet<string>
): Array<T | PublicShowFields> {
  return shows.map((show) => {
    if (!fullIds.has(show.id)) return toPublicShowFields(show);
    if (contactVisible.has(show.id)) return show;
    return redactShowContact(show);
  });
}

export function hasOwnershipStatus(show: object): boolean {
  return Object.prototype.hasOwnProperty.call(show, "ownership_status");
}

/**
 * Copy ownership_status from raw shows rows onto already transformed
 * shows. transformShow leaves the column off. GET /api/shows uses this
 * and then strips the field unless the caller is the owner or an admin.
 * A read error returns the shows unchanged.
 */
export async function attachOwnershipStatus<T extends { id: string }>(shows: T[]): Promise<T[]> {
  const ids = [...new Set(shows.map((show) => show.id).filter((id) => id.length > 0))];
  if (ids.length === 0) return shows;
  try {
    const { data, error } = await supabaseAdmin
      .from("shows")
      .select("id, ownership_status")
      .in("id", ids);
    if (error) {
      console.warn("[shows] ownership read", error.code ?? "unknown");
      return shows;
    }
    const byId = new Map<string, NonNullable<Show["ownership_status"]>>();
    for (const row of data ?? []) {
      const id = typeof row.id === "string" ? row.id : "";
      const status = ownershipStatusFromRow(row.ownership_status);
      if (id && status) byId.set(id, status);
    }
    if (byId.size === 0) return shows;
    return shows.map((show) => {
      const status = byId.get(show.id);
      if (!status) return show;
      return { ...show, ownership_status: status };
    });
  } catch {
    console.warn("[shows] ownership read", "unknown");
    return shows;
  }
}

/** Drop ranking state unless this caller is the show owner or an admin. */
export function stripOwnershipStatus<T extends { id: string }>(
  shows: T[],
  keepIds: ReadonlySet<string>
): T[] {
  return shows.map((show) => {
    if (keepIds.has(show.id)) return show;
    if (!Object.prototype.hasOwnProperty.call(show, "ownership_status")) return show;
    const copy = { ...show };
    delete (copy as { ownership_status?: unknown }).ownership_status;
    return copy;
  });
}

/**
 * Show ids whose ownership_status this caller may see. An admin sees
 * every id. Anyone else sees a show only when showEditGrantIds says
 * they may edit it. A brand deal does not qualify. A loose profile
 * tie does not qualify.
 */
export async function ownershipVisibleIds(
  userId: string,
  shows: Array<ShowAccessRow & { slug?: string | null }>,
  admin: boolean
): Promise<Set<string>> {
  if (admin) return new Set(shows.map((show) => show.id));
  if (!userId) return new Set();
  return showEditGrantIds(
    userId,
    shows.map((show) => show.id)
  );
}

/**
 * Show ids this caller may see in full. Fail-soft: a read error yields
 * whatever ids were already collected, or none. Never consults podscan_id.
 */
export async function fullShowIdsForCaller(
  userId: string,
  shows: ShowAccessRow[]
): Promise<Set<string>> {
  const ids = new Set<string>();
  if (!userId || shows.length === 0) return ids;

  try {
    const showIds = shows.map((show) => show.id);
    for (const showId of await showEditGrantIds(userId, showIds)) ids.add(showId);

    const brandProfileIds = await callerBrandProfileIds(userId);
    for (const showId of await dealShowIdsForCaller(userId, showIds, brandProfileIds)) {
      ids.add(showId);
    }
    for (const showId of await rosterShowIds(userId, showIds)) {
      ids.add(showId);
    }
  } catch {
    console.warn("[fullShowIdsForCaller]", "unknown");
  }
  return ids;
}

async function callerBrandProfileIds(userId: string): Promise<Set<string>> {
  const ids = new Set<string>();
  const { data, error } = await supabaseAdmin
    .from("brand_profiles")
    .select("id")
    .eq("user_id", userId);
  if (error || !Array.isArray(data)) return ids;
  for (const row of data as Array<{ id?: unknown }>) {
    const id = nonEmpty(row.id);
    if (id) ids.add(id);
  }
  return ids;
}

async function dealShowIdsForCaller(
  userId: string,
  showIds: string[],
  brandProfileIds: ReadonlySet<string>
): Promise<string[]> {
  const { data, error } = await supabaseAdmin
    .from("deals")
    .select("show_id, brand_id, agency_id, brand_profile_id")
    .in("show_id", showIds);
  if (error) {
    console.warn("[fullShowIdsForCaller] deal read failed:", error.message);
    return [];
  }
  const rows = (data ?? []) as Array<{
    show_id?: unknown;
    brand_id?: unknown;
    agency_id?: unknown;
    brand_profile_id?: unknown;
  }>;
  const out: string[] = [];
  for (const row of rows) {
    const showId = nonEmpty(row.show_id);
    const brandProfileId = nonEmpty(row.brand_profile_id);
    if (!showId) continue;
    if (
      row.brand_id === userId ||
      row.agency_id === userId ||
      (brandProfileId != null && brandProfileIds.has(brandProfileId))
    ) {
      out.push(showId);
    }
  }
  return out;
}

async function rosterShowIds(userId: string, showIds: string[]): Promise<string[]> {
  const { data, error } = await supabaseAdmin
    .from("agent_show_relationships")
    .select("show_id, status")
    .eq("agent_id", userId)
    .in("show_id", showIds);
  if (error || !Array.isArray(data)) return [];
  const out: string[] = [];
  for (const row of data as Array<{ show_id?: unknown; status?: unknown }>) {
    const showId = nonEmpty(row.show_id);
    if (!showId || row.status !== "approved") continue;
    out.push(showId);
  }
  return out;
}

function nonEmpty(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}
