// ============================================================
// WRITE PARSED GEOGRAPHY ONTO A VERIFIED SHOW ROW
//
// show_profiles holds the kit. Discovery scores `shows`. A profile
// may copy country shares onto a catalog row only when showEditGrantIds
// grants that show to profile.user_id. A deal show_profile_id alone
// does not. A show_owner contact email without the server owner slug
// does not. A profile with no user_id writes nothing.
//
// show_profiles.podscan_id is self-reported. It is not a tie. A profile
// that stores another show's Podscan id does not read or write that show.
//
// show_slug / generateSlug(show_name) is display-only. A profile
// named after a catalog show must not write that show's demographics.
//
// A null geography clears the four country keys on tied rows so a
// removed kit does not leave a stale share. It does not delete the show.
// Fail-soft. Never throws.
// ============================================================

import { supabaseAdmin } from "@/lib/supabase/admin";
import { getAuthEmail, getAuthUserIdByEmail } from "@/lib/auth/auth-email";
import { showEditGrantIds } from "@/lib/ownership/edit-rights";
import type { AudienceGeography, ShowDemographics, ShowProfile } from "@/lib/data/types";
import {
  GEO_KEYS,
  hasAudienceGeography,
  mergeGeographyIntoDemographics,
} from "@/lib/shows/media-kit-geo";

/** `podscan_id` may be present on the row. Geography ignores it. */
type GeoProfile = Pick<ShowProfile, "id" | "podscan_id" | "audience_geography"> & {
  user_id?: string | null;
};

interface GeoShow {
  id: string;
  demographics: ShowDemographics | null;
}

/** Catalog identity used to pull media-kit geography before scoring. */
export interface ShowGeoIdentity {
  /** Catalog `shows.id` from the stored row. Never a discovery candidate id. */
  showId?: string;
  /** Catalog `shows.podscan_id`. Not a join onto show_profiles. */
  podscanId?: string;
  contactEmail?: string;
  dataSources?: string[];
}

export interface VerifiedGeography {
  /**
   * Ignored by geographyForIdentity. A Podscan id is not a profile tie.
   * Callers match on showId.
   */
  podscanId?: string;
  showId?: string;
  geography: AudienceGeography;
}

/**
 * A show profile tied to a catalog show by a deal (`deals.show_profile_id`)
 * or by the private show_owner row whose contact email matches the profile
 * owner's auth login. `show_profiles.podscan_id` is not a tie: the host can type it.
 */
export interface VerifiedProfileTie {
  showId: string;
  profileId: string;
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
 * these catalog identities. A shared name, slug, or podscan id is not a tie.
 */
export async function getVerifiedAudienceGeography(
  identities: ShowGeoIdentity[]
): Promise<VerifiedGeography[]> {
  const out: VerifiedGeography[] = [];
  try {
    const ties = await keepGrantedProfileTies(await getVerifiedProfileTies(identities));
    const profileIds = unique(ties.map((tie) => tie.profileId));
    if (profileIds.length > 0) {
      const { data: profiles, error: profileError } = await supabaseAdmin
        .from("show_profiles")
        .select("id, audience_geography")
        .in("id", profileIds);
      if (profileError) {
        console.warn(
          "[getVerifiedAudienceGeography] tied profile read failed:",
          profileError.message
        );
      } else {
        const geoByProfile = new Map<string, AudienceGeography>();
        for (const profile of profiles ?? []) {
          const id = text(profile.id);
          const geography = profile.audience_geography as AudienceGeography | null;
          if (id && hasAudienceGeography(geography)) geoByProfile.set(id, geography);
        }
        for (const tie of ties) {
          const geography = geoByProfile.get(tie.profileId);
          if (geography) out.push({ showId: tie.showId, geography });
        }
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

/**
 * Profile ids tied to these catalog shows. A deal link, a show_owner
 * contact email, or a verified ownership proof counts. A podscan id
 * on the profile does not. Fail-soft: a read error yields whatever
 * ties were found, or none.
 */
export async function getVerifiedProfileTies(
  identities: ShowGeoIdentity[]
): Promise<VerifiedProfileTie[]> {
  const out: VerifiedProfileTie[] = [];
  const seen = new Set<string>();
  const add = (showId: string | undefined, profileId: string | undefined) => {
    if (!showId || !profileId || seen.has(`${showId}:${profileId}`)) return;
    seen.add(`${showId}:${profileId}`);
    out.push({ showId, profileId });
  };

  try {
    const showIds = unique(identities.map((row) => row.showId));
    if (showIds.length > 0) {
      const { data: deals, error } = await supabaseAdmin
        .from("deals")
        .select("show_id, show_profile_id")
        .in("show_id", showIds);
      if (error) {
        console.warn("[getVerifiedProfileTies] deal read failed:", error.message);
      } else {
        for (const deal of deals ?? []) {
          add(text(deal.show_id), text(deal.show_profile_id));
        }
      }
    }

    for (const identity of identities) {
      if (!identity.showId || !isShowOwnerRow(identity.dataSources)) continue;
      const email = identity.contactEmail?.trim();
      if (!email) continue;
      const owner = await profileByLoginEmail(email);
      if (!owner) continue;
      const { data, error } = await supabaseAdmin
        .from("show_profiles")
        .select("id")
        .eq("user_id", owner.id)
        .maybeSingle();
      if (error) {
        console.warn("[getVerifiedProfileTies] owner profile read failed:", error.message);
        continue;
      }
      add(identity.showId, text(data?.id));
    }

    if (showIds.length > 0) {
      const { data: proofs, error: proofError } = await supabaseAdmin
        .from("show_ownership_proofs")
        .select("show_id, show_profile_id")
        .in("show_id", showIds)
        .eq("status", "verified");
      if (proofError) {
        console.warn(
          "[getVerifiedProfileTies] ownership proof read failed:",
          proofError.message
        );
      } else {
        for (const proof of proofs ?? []) {
          add(text(proof.show_id), text(proof.show_profile_id));
        }
      }
    }
  } catch (err) {
    console.warn(
      "[getVerifiedProfileTies] threw:",
      err instanceof Error ? err.message : err
    );
  }
  return out;
}

/** Geography tied to this catalog show id. A podscan-id-only row is ignored. */
export function geographyForIdentity(
  identity: ShowGeoIdentity,
  rows: VerifiedGeography[]
): AudienceGeography | null {
  if (!identity.showId) return null;
  const hit = rows.find((row) => row.showId === identity.showId);
  return hit?.geography ?? null;
}

/**
 * Ties that showEditGrantIds allows for the profile's auth user.
 * A deal link or a contact email that the grant rejects is dropped.
 * Fail closed: a profile or grant read error drops every tie.
 */
export async function keepGrantedProfileTies(
  ties: VerifiedProfileTie[]
): Promise<VerifiedProfileTie[]> {
  if (ties.length === 0) return [];
  const profileIds = unique(ties.map((tie) => tie.profileId));
  try {
    const { data, error } = await supabaseAdmin
      .from("show_profiles")
      .select("id, user_id")
      .in("id", profileIds);
    if (error) {
      console.warn("[show-edit]", errorCode(error));
      return [];
    }
    const userByProfile = new Map<string, string>();
    for (const row of data ?? []) {
      const id = text(row.id);
      const userId = text(row.user_id);
      if (id && userId) userByProfile.set(id, userId);
    }
    const showsByUser = new Map<string, string[]>();
    for (const tie of ties) {
      const userId = userByProfile.get(tie.profileId);
      if (!userId || !tie.showId) continue;
      const list = showsByUser.get(userId) ?? [];
      list.push(tie.showId);
      showsByUser.set(userId, list);
    }
    const allowed = new Set<string>();
    for (const [userId, showIds] of showsByUser) {
      const granted = await showEditGrantIds(userId, unique(showIds));
      for (const showId of granted) allowed.add(`${userId}:${showId}`);
    }
    return ties.filter((tie) => {
      const userId = userByProfile.get(tie.profileId);
      return !!userId && allowed.has(`${userId}:${tie.showId}`);
    });
  } catch {
    console.warn("[show-edit]", "unknown");
    return [];
  }
}

async function findTiedShows(profile: GeoProfile): Promise<GeoShow[]> {
  const userId = text(profile.user_id);
  if (!userId) return [];
  const candidateIds = unique([
    ...(profile.id ? await dealCandidateIds(profile.id) : []),
    ...(await ownerCandidateIds(userId)),
  ]);
  if (candidateIds.length === 0) return [];
  const granted = await showEditGrantIds(userId, candidateIds);
  const ids = candidateIds.filter((id) => granted.has(id));
  if (ids.length === 0) return [];
  return loadDemographics(ids);
}

async function dealCandidateIds(showProfileId: string): Promise<string[]> {
  const { data, error } = await supabaseAdmin
    .from("deals")
    .select("show_id")
    .eq("show_profile_id", showProfileId);
  if (error) {
    console.warn("[applyAudienceGeographyToShow] deal lookup", errorCode(error));
    return [];
  }
  return unique((data ?? []).map((row) => text(row.show_id)));
}

async function ownerCandidateIds(userId: string): Promise<string[]> {
  const email = await getAuthEmail(userId);
  if (!email) return [];

  const { data, error: showError } = await supabaseAdmin
    .from("shows")
    .select("id, contact_email, data_sources")
    .contains("data_sources", ["show_owner"])
    .ilike("contact_email", escapeIlike(email));
  if (showError) {
    console.warn("[applyAudienceGeographyToShow] owner show lookup", errorCode(showError));
    return [];
  }
  const ids: string[] = [];
  for (const row of (data ?? []) as Array<{
    id?: string;
    contact_email?: string | null;
    data_sources?: string[] | null;
  }>) {
    if (!row.id || !isShowOwnerRow(row.data_sources) || !emailsMatch(row.contact_email, email)) {
      continue;
    }
    ids.push(row.id);
  }
  return ids;
}

async function loadDemographics(ids: string[]): Promise<GeoShow[]> {
  const { data, error } = await supabaseAdmin
    .from("shows")
    .select("id, demographics")
    .in("id", ids);
  if (error) {
    console.warn("[applyAudienceGeographyToShow] show read", errorCode(error));
    return [];
  }
  return (data ?? []) as GeoShow[];
}

function errorCode(error: { code?: string; message?: string } | null): string {
  return typeof error?.code === "string" && error.code ? error.code : "unknown";
}

async function profileByLoginEmail(email: string): Promise<{ id: string } | null> {
  const userId = await getAuthUserIdByEmail(email);
  return userId ? { id: userId } : null;
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
