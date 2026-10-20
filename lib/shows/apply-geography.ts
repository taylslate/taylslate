// ============================================================
// WRITE PARSED GEOGRAPHY ONTO A VERIFIED SHOW ROW
//
// show_profiles holds the kit. Discovery scores `shows`. A profile
// may copy country shares onto a catalog row only through a verified
// tie — the same three user_owns_show uses:
//   1. show_profiles.podscan_id = shows.podscan_id
//   2. a deal whose show_profile_id is this profile and whose show_id
//      is the catalog row
//   3. the private show_owner row (data_sources contains show_owner)
//      whose contact_email matches the profile owner's login
//
// show_slug / generateSlug(show_name) is display-only. A profile
// named after a catalog show must not write that show's demographics.
//
// A null geography clears the four country keys on tied rows so a
// removed kit does not leave a stale share. It does not delete the show.
// Fail-soft. Never throws.
// ============================================================

import { supabaseAdmin } from "@/lib/supabase/admin";
import type { AudienceGeography, ShowDemographics, ShowProfile } from "@/lib/data/types";
import {
  GEO_KEYS,
  hasAudienceGeography,
  mergeGeographyIntoDemographics,
} from "@/lib/shows/media-kit-geo";

type GeoProfile = Pick<ShowProfile, "id" | "user_id" | "podscan_id" | "audience_geography">;

interface GeoShow {
  id: string;
  demographics: ShowDemographics | null;
}

/** Catalog identity used to pull media-kit geography before scoring. */
export interface ShowGeoIdentity {
  /** Catalog `shows.id` from the stored row. Never a discovery candidate id. */
  showId?: string;
  podscanId?: string;
  contactEmail?: string;
  dataSources?: string[];
}

export interface VerifiedGeography {
  podscanId?: string;
  showId?: string;
  geography: AudienceGeography;
}

export async function applyAudienceGeographyToShow(profile: GeoProfile): Promise<boolean> {
  try {
    const rows = await findTiedShows(profile);
    if (rows.length === 0) return true;

    let ok = true;
    for (const row of rows) {
      const next = mergeGeographyIntoDemographics(
        row.demographics,
        profile.audience_geography,
        { replace: true }
      );
      const { error } = await supabaseAdmin
        .from("shows")
        .update({ demographics: next, updated_at: new Date().toISOString() })
        .eq("id", row.id);
      if (error) {
        console.warn("[applyAudienceGeographyToShow] update failed:", error.message);
        ok = false;
      }
    }
    return ok;
  } catch (err) {
    console.warn(
      "[applyAudienceGeographyToShow] threw:",
      err instanceof Error ? err.message : err
    );
    return false;
  }
}

/**
 * Country shares from show_profiles that have a verified tie to one of
 * these catalog identities. A shared name or slug is not a tie.
 */
export async function getVerifiedAudienceGeography(
  identities: ShowGeoIdentity[]
): Promise<VerifiedGeography[]> {
  const out: VerifiedGeography[] = [];
  try {
    const podscanIds = unique(identities.map((row) => row.podscanId));
    if (podscanIds.length > 0) {
      const { data, error } = await supabaseAdmin
        .from("show_profiles")
        .select("podscan_id, audience_geography")
        .in("podscan_id", podscanIds);
      if (error) {
        console.warn("[getVerifiedAudienceGeography] podscan read failed:", error.message);
      } else {
        for (const row of data ?? []) {
          const podscanId = text(row.podscan_id);
          const geography = row.audience_geography as AudienceGeography | null;
          if (!podscanId || !hasAudienceGeography(geography)) continue;
          out.push({ podscanId, geography });
        }
      }
    }

    const showIds = unique(identities.map((row) => row.showId));
    if (showIds.length > 0) {
      const { data: deals, error } = await supabaseAdmin
        .from("deals")
        .select("show_id, show_profile_id")
        .in("show_id", showIds);
      if (error) {
        console.warn("[getVerifiedAudienceGeography] deal read failed:", error.message);
      } else {
        const profileIds = unique(
          (deals ?? []).map((row) => text(row.show_profile_id))
        );
        if (profileIds.length > 0) {
          const { data: profiles, error: profileError } = await supabaseAdmin
            .from("show_profiles")
            .select("id, audience_geography")
            .in("id", profileIds);
          if (profileError) {
            console.warn(
              "[getVerifiedAudienceGeography] deal profile read failed:",
              profileError.message
            );
          } else {
            const geoByProfile = new Map<string, AudienceGeography>();
            for (const profile of profiles ?? []) {
              const id = text(profile.id);
              const geography = profile.audience_geography as AudienceGeography | null;
              if (id && hasAudienceGeography(geography)) geoByProfile.set(id, geography);
            }
            for (const deal of deals ?? []) {
              const showId = text(deal.show_id);
              const geography = geoByProfile.get(text(deal.show_profile_id) ?? "");
              if (showId && geography) out.push({ showId, geography });
            }
          }
        }
      }
    }

    for (const identity of identities) {
      if (!identity.showId || !isShowOwnerRow(identity.dataSources)) continue;
      const email = identity.contactEmail?.trim();
      if (!email) continue;
      const owner = await profileByEmail(email);
      if (!owner) continue;
      const { data, error } = await supabaseAdmin
        .from("show_profiles")
        .select("audience_geography")
        .eq("user_id", owner.id)
        .maybeSingle();
      if (error) {
        console.warn("[getVerifiedAudienceGeography] owner read failed:", error.message);
        continue;
      }
      const geography = data?.audience_geography as AudienceGeography | null;
      if (hasAudienceGeography(geography)) {
        out.push({ showId: identity.showId, geography });
      }
    }
  } catch (err) {
    console.warn(
      "[getVerifiedAudienceGeography] threw:",
      err instanceof Error ? err.message : err
    );
  }
  return out;
}

/** First verified geography for this identity. Podscan tie, then show id. */
export function geographyForIdentity(
  identity: ShowGeoIdentity,
  rows: VerifiedGeography[]
): AudienceGeography | null {
  if (identity.podscanId) {
    const hit = rows.find((row) => row.podscanId === identity.podscanId);
    if (hit) return hit.geography;
  }
  if (identity.showId) {
    const hit = rows.find((row) => row.showId === identity.showId);
    if (hit) return hit.geography;
  }
  return null;
}

async function findTiedShows(profile: GeoProfile): Promise<GeoShow[]> {
  const found = new Map<string, GeoShow>();
  const add = (rows: GeoShow[]) => {
    for (const row of rows) {
      if (row.id && !found.has(row.id)) found.set(row.id, row);
    }
  };

  const podscanId = profile.podscan_id?.trim();
  if (podscanId) add(await showsByPodscanId(podscanId));
  if (profile.id) add(await showsByDeal(profile.id));
  if (profile.user_id) add(await showsByOwner(profile.user_id));
  return [...found.values()];
}

async function showsByPodscanId(podscanId: string): Promise<GeoShow[]> {
  const { data, error } = await supabaseAdmin
    .from("shows")
    .select("id, demographics")
    .eq("podscan_id", podscanId);
  if (error) {
    console.warn("[applyAudienceGeographyToShow] podscan lookup failed:", error.message);
    return [];
  }
  return (data ?? []) as GeoShow[];
}

async function showsByDeal(showProfileId: string): Promise<GeoShow[]> {
  const { data: deals, error } = await supabaseAdmin
    .from("deals")
    .select("show_id")
    .eq("show_profile_id", showProfileId);
  if (error) {
    console.warn("[applyAudienceGeographyToShow] deal lookup failed:", error.message);
    return [];
  }
  const showIds = unique((deals ?? []).map((row) => text(row.show_id)));
  if (showIds.length === 0) return [];
  const { data, error: showError } = await supabaseAdmin
    .from("shows")
    .select("id, demographics")
    .in("id", showIds);
  if (showError) {
    console.warn("[applyAudienceGeographyToShow] deal show lookup failed:", showError.message);
    return [];
  }
  return (data ?? []) as GeoShow[];
}

async function showsByOwner(userId: string): Promise<GeoShow[]> {
  const { data: owner, error } = await supabaseAdmin
    .from("profiles")
    .select("email")
    .eq("id", userId)
    .maybeSingle();
  if (error) {
    console.warn("[applyAudienceGeographyToShow] owner lookup failed:", error.message);
    return [];
  }
  const email = text(owner?.email)?.trim();
  if (!email) return [];

  const { data, error: showError } = await supabaseAdmin
    .from("shows")
    .select("id, demographics, contact_email, data_sources")
    .contains("data_sources", ["show_owner"])
    .ilike("contact_email", escapeIlike(email));
  if (showError) {
    console.warn("[applyAudienceGeographyToShow] owner show lookup failed:", showError.message);
    return [];
  }
  return ((data ?? []) as Array<GeoShow & { contact_email?: string | null; data_sources?: string[] | null }>)
    .filter(
      (row) => isShowOwnerRow(row.data_sources) && emailsMatch(row.contact_email, email)
    )
    .map((row) => ({ id: row.id, demographics: row.demographics }));
}

async function profileByEmail(email: string): Promise<{ id: string } | null> {
  const { data, error } = await supabaseAdmin
    .from("profiles")
    .select("id, email")
    .ilike("email", escapeIlike(email))
    .maybeSingle();
  if (error || !data) return null;
  if (!emailsMatch(text(data.email), email)) return null;
  const id = text(data.id);
  return id ? { id } : null;
}

function isShowOwnerRow(dataSources?: string[] | null): boolean {
  return Array.isArray(dataSources) && dataSources.includes("show_owner");
}

function emailsMatch(left?: string | null, right?: string | null): boolean {
  const a = left?.trim().toLowerCase();
  const b = right?.trim().toLowerCase();
  return !!a && !!b && a === b;
}

function escapeIlike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function unique(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => !!value))];
}

/** Country keys only — used by tests that assert a clear doesn't touch age. */
export const AUDIENCE_GEO_KEYS = GEO_KEYS;
