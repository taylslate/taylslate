// Public fields for GET /api/shows.
//
// A signed-in caller with no tie to a show gets an allowlist: id, name,
// platform, audience_size, categories, plus image_url and description
// when those strings are non-empty. image_url is the shows image column.
// Contact, rate card, and every other key stay off that object.
//
// The full show object is returned only when the caller is tied. A tie is
// the caller's show_profiles row in getVerifiedProfileTies, a deals row
// whose brand_id, agency_id, or brand_profile_id is the caller, or an
// approved agent_show_relationships row. show_profiles.podscan_id is not
// read and is not a tie. GET /api/shows still returns an agent's roster
// before this helper runs.

import type { Show } from "@/lib/data/types";
import { getVerifiedProfileTies } from "@/lib/shows/apply-geography";
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
    const profileId = await callerShowProfileId(userId);
    const ties = await getVerifiedProfileTies(await showIdentities(shows));
    if (profileId) {
      for (const tie of ties) {
        if (tie.profileId === profileId && tie.showId) ids.add(tie.showId);
      }
    }

    const brandProfileIds = await callerBrandProfileIds(userId);
    for (const showId of await dealShowIdsForCaller(userId, showIds, brandProfileIds)) {
      ids.add(showId);
    }
    for (const showId of await rosterShowIds(userId, showIds)) {
      ids.add(showId);
    }
  } catch (err) {
    console.warn(
      "[fullShowIdsForCaller]",
      err instanceof Error ? err.message : err
    );
  }
  return ids;
}

async function callerShowProfileId(userId: string): Promise<string | undefined> {
  const { data, error } = await supabaseAdmin
    .from("show_profiles")
    .select("id")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) {
    console.warn("[fullShowIdsForCaller] show profile read failed:", error.message);
    return undefined;
  }
  const row = data as { id?: unknown } | null;
  return nonEmpty(row?.id);
}

async function showIdentities(shows: ShowAccessRow[]) {
  const fallback = shows.map((show) => ({
    showId: show.id,
    contactEmail: nonEmpty(show.contact?.email),
    dataSources: stringList(show.data_sources),
  }));
  const { data, error } = await supabaseAdmin
    .from("shows")
    .select("id, contact_email, data_sources")
    .in(
      "id",
      shows.map((show) => show.id)
    );
  if (error || !Array.isArray(data) || data.length === 0) return fallback;
  const out: Array<{
    showId: string;
    contactEmail?: string;
    dataSources?: string[];
  }> = [];
  for (const row of data as Array<{ id?: unknown; contact_email?: unknown; data_sources?: unknown }>) {
    const showId = nonEmpty(row.id);
    if (!showId) continue;
    out.push({
      showId,
      contactEmail: nonEmpty(row.contact_email),
      dataSources: stringList(row.data_sources),
    });
  }
  return out.length > 0 ? out : fallback;
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

function stringList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out: string[] = [];
  for (const item of value) {
    if (typeof item === "string") out.push(item);
  }
  return out;
}
