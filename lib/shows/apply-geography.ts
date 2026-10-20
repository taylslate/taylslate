// ============================================================
// WRITE PARSED GEOGRAPHY ONTO THE SHOW ROW
//
// show_profiles holds the kit. Discovery scores `shows`. When a kit
// is saved, copy the country shares onto the matching shows row
// (podscan id, else slug) without touching age or gender. No matching
// row is a no-op — the profile still has the parse, and hydration
// can attach it later. Fail-soft. Never throws.
//
// A null geography clears the four country keys so a removed kit
// does not leave a stale share. It does not delete the show.
// ============================================================

import { supabaseAdmin } from "@/lib/supabase/admin";
import { generateSlug } from "@/lib/data/queries";
import type { AudienceGeography, ShowDemographics, ShowProfile } from "@/lib/data/types";
import {
  GEO_KEYS,
  hasAudienceGeography,
  mergeGeographyIntoDemographics,
} from "@/lib/shows/media-kit-geo";

type GeoProfile = Pick<
  ShowProfile,
  "show_name" | "show_slug" | "podscan_id" | "audience_geography"
>;

export async function applyAudienceGeographyToShow(profile: GeoProfile): Promise<boolean> {
  try {
    const row = await findShow(profile);
    if (!row) return true;

    const next = mergeGeographyIntoDemographics(
      (row.demographics ?? {}) as ShowDemographics,
      profile.audience_geography,
      { replace: true }
    );
    const { error } = await supabaseAdmin
      .from("shows")
      .update({ demographics: next, updated_at: new Date().toISOString() })
      .eq("id", row.id);
    if (error) {
      console.warn("[applyAudienceGeographyToShow] update failed:", error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.warn(
      "[applyAudienceGeographyToShow] threw:",
      err instanceof Error ? err.message : err
    );
    return false;
  }
}

async function findShow(
  profile: GeoProfile
): Promise<{ id: string; demographics: ShowDemographics | null } | null> {
  if (profile.podscan_id) {
    const byPodscan = await lookup("podscan_id", profile.podscan_id);
    if (byPodscan) return byPodscan;
  }
  const slug =
    profile.show_slug?.trim() ||
    (profile.show_name?.trim() ? generateSlug(profile.show_name) : "");
  if (!slug) return null;
  return lookup("slug", slug);
}

async function lookup(
  column: "podscan_id" | "slug",
  value: string
): Promise<{ id: string; demographics: ShowDemographics | null } | null> {
  const { data, error } = await supabaseAdmin
    .from("shows")
    .select("id, demographics")
    .eq(column, value)
    .maybeSingle();
  if (error) {
    console.warn(`[applyAudienceGeographyToShow] lookup ${column} failed:`, error.message);
    return null;
  }
  return (data as { id: string; demographics: ShowDemographics | null } | null) ?? null;
}

export async function getAudienceGeographyBySlugs(
  slugs: string[]
): Promise<Array<{ slug: string; geography: AudienceGeography }>> {
  const wanted = [...new Set(slugs.map((slug) => slug.trim()).filter(Boolean))];
  if (wanted.length === 0) return [];
  try {
    const { data, error } = await supabaseAdmin
      .from("show_profiles")
      .select("show_slug, audience_geography")
      .in("show_slug", wanted);
    if (error) {
      console.warn("[getAudienceGeographyBySlugs] read failed:", error.message);
      return [];
    }
    const out: Array<{ slug: string; geography: AudienceGeography }> = [];
    for (const row of data ?? []) {
      const slug = (row as { show_slug?: string | null }).show_slug;
      const geography = (row as { audience_geography?: AudienceGeography | null })
        .audience_geography;
      if (!slug || !hasAudienceGeography(geography)) continue;
      out.push({ slug, geography });
    }
    return out;
  } catch (err) {
    console.warn(
      "[getAudienceGeographyBySlugs] threw:",
      err instanceof Error ? err.message : err
    );
    return [];
  }
}

/** Country keys only — used by tests that assert a clear doesn't touch age. */
export const AUDIENCE_GEO_KEYS = GEO_KEYS;
