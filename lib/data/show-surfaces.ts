// Server reads and writes for show_surfaces. Fail-soft on reads so a
// campaign page still renders before migration 044 is applied. Writes
// go through the service role after the route has checked the user.

import { supabaseAdmin } from "@/lib/supabase/admin";
import { createShow } from "@/lib/data/queries";
import type { ShowProfile } from "@/lib/data/types";
import {
  getVerifiedProfileTies,
  type ShowGeoIdentity,
} from "@/lib/shows/apply-geography";
import {
  chooseSurfaceShowId,
  groupPublishedSurfaces,
  ownerShowSlug,
  type SellableSurface,
  type ShowSurfaceDraft,
} from "@/lib/shows/surfaces";

export interface SurfaceShowIdentity {
  id: string;
  name: string;
  platform: string;
}

interface SurfaceRow {
  id: string;
  show_id: string;
  owner_user_id?: string;
  type: SellableSurface["type"];
  audience_size: number | null;
  format: string | null;
  min_buy: number | null;
  creative_constraints: string | null;
  lead_time_days: number | null;
  posting_owner: SellableSurface["posting_owner"];
  price: number | null;
  notes: string | null;
  published: boolean;
}

function toSellable(row: SurfaceRow): SellableSurface {
  return {
    id: row.id,
    show_id: row.show_id,
    type: row.type,
    audience_size: row.audience_size,
    format: row.format,
    min_buy: row.min_buy == null ? null : Number(row.min_buy),
    creative_constraints: row.creative_constraints,
    lead_time_days: row.lead_time_days,
    posting_owner: row.posting_owner === "brand" ? "brand" : "creator",
    price: row.price == null ? null : Number(row.price),
    notes: row.notes,
    published: row.published === true,
  };
}

export async function listOwnerSurfaces(userId: string): Promise<SellableSurface[]> {
  const { data, error } = await supabaseAdmin
    .from("show_surfaces")
    .select(
      "id, show_id, type, audience_size, format, min_buy, creative_constraints, lead_time_days, posting_owner, price, notes, published"
    )
    .eq("owner_user_id", userId)
    .order("created_at", { ascending: true });
  if (error) {
    console.error("[listOwnerSurfaces]", error.message);
    return [];
  }
  return ((data ?? []) as SurfaceRow[]).map(toSellable);
}

/**
 * Published add-ons for the shows a brand is looking at. A surface stored
 * on the creator's private owner row still appears when that row shares a
 * Podscan id with the catalog show. Errors return {} so discovery renders.
 */
export async function listPublishedSurfacesForShows(
  showIds: string[]
): Promise<Record<string, SellableSurface[]>> {
  const ids = [...new Set(showIds.filter((id) => typeof id === "string" && id.length > 0))];
  if (ids.length === 0) return {};
  try {
    const { data: direct, error } = await supabaseAdmin
      .from("show_surfaces")
      .select(
        "id, show_id, type, audience_size, format, min_buy, creative_constraints, lead_time_days, posting_owner, price, notes, published"
      )
      .in("show_id", ids)
      .eq("published", true);
    if (error) {
      console.error("[listPublishedSurfacesForShows]", error.message);
      return {};
    }

    const { data: catalog, error: catalogError } = await supabaseAdmin
      .from("shows")
      .select("id, podscan_id")
      .in("id", ids);
    if (catalogError) {
      console.error("[listPublishedSurfacesForShows] catalog", catalogError.message);
      return groupPublishedSurfaces({
        catalogIds: ids,
        podscanByCatalogId: new Map(),
        podscanBySurfaceShowId: new Map(),
        direct: ((direct ?? []) as SurfaceRow[]).map(toSellable),
        aliased: [],
      });
    }

    const podscanByCatalogId = new Map<string, string>();
    const podscanIds: string[] = [];
    for (const row of catalog ?? []) {
      const rec = row as { id: string; podscan_id: string | null };
      if (rec.podscan_id) {
        podscanByCatalogId.set(rec.id, rec.podscan_id);
        podscanIds.push(rec.podscan_id);
      }
    }

    const podscanBySurfaceShowId = new Map<string, string>();
    let aliased: SellableSurface[] = [];
    if (podscanIds.length > 0) {
      const { data: siblings } = await supabaseAdmin
        .from("shows")
        .select("id, podscan_id")
        .in("podscan_id", podscanIds);
      const siblingIds: string[] = [];
      for (const row of siblings ?? []) {
        const rec = row as { id: string; podscan_id: string | null };
        if (!rec.podscan_id || ids.includes(rec.id)) continue;
        podscanBySurfaceShowId.set(rec.id, rec.podscan_id);
        siblingIds.push(rec.id);
      }
      if (siblingIds.length > 0) {
        const { data: extra } = await supabaseAdmin
          .from("show_surfaces")
          .select(
            "id, show_id, type, audience_size, format, min_buy, creative_constraints, lead_time_days, posting_owner, price, notes, published"
          )
          .in("show_id", siblingIds)
          .eq("published", true);
        aliased = ((extra ?? []) as SurfaceRow[]).map(toSellable);
      }
    }

    return groupPublishedSurfaces({
      catalogIds: ids,
      podscanByCatalogId,
      podscanBySurfaceShowId,
      direct: ((direct ?? []) as SurfaceRow[]).map(toSellable),
      aliased,
    });
  } catch (err) {
    console.error("[listPublishedSurfacesForShows]", err);
    return {};
  }
}

/**
 * Catalog shows this profile may attach surfaces to. Candidates come
 * from a deal or a show_owner contact email, then getVerifiedProfileTies
 * confirms the profile. A podscan id is never the lookup key.
 */
async function verifiedCatalogShowIds(profile: ShowProfile, email: string): Promise<string[]> {
  if (!profile.id) return [];
  const identities = await catalogIdentitiesForProfile(profile.id, email);
  if (identities.length === 0) return [];
  const ties = await getVerifiedProfileTies(identities);
  const allowed = new Set(
    ties.filter((tie) => tie.profileId === profile.id).map((tie) => tie.showId)
  );
  return identities
    .map((identity) => identity.showId)
    .filter((id): id is string => !!id && allowed.has(id));
}

async function catalogIdentitiesForProfile(
  profileId: string,
  email: string
): Promise<ShowGeoIdentity[]> {
  const byId = new Map<string, ShowGeoIdentity>();
  const add = (row: {
    id?: string | null;
    contact_email?: string | null;
    data_sources?: string[] | null;
  }) => {
    if (!row.id || byId.has(row.id)) return;
    byId.set(row.id, {
      showId: row.id,
      contactEmail: row.contact_email ?? undefined,
      dataSources: row.data_sources ?? undefined,
    });
  };

  try {
    const { data: deals, error } = await supabaseAdmin
      .from("deals")
      .select("show_id")
      .eq("show_profile_id", profileId);
    if (error) {
      console.error("[resolveOwnerShowId] deal lookup", error.message);
    } else {
      const showIds = [
        ...new Set(
          ((deals ?? []) as { show_id?: string | null }[])
            .map((row) => row.show_id)
            .filter((id): id is string => !!id)
        ),
      ];
      if (showIds.length > 0) {
        const { data: shows, error: showError } = await supabaseAdmin
          .from("shows")
          .select("id, contact_email, data_sources")
          .in("id", showIds);
        if (showError) {
          console.error("[resolveOwnerShowId] deal show lookup", showError.message);
        } else {
          for (const row of (shows ?? []) as Array<{
            id: string;
            contact_email?: string | null;
            data_sources?: string[] | null;
          }>) {
            add(row);
          }
        }
      }
    }

    const trimmed = email.trim();
    if (trimmed) {
      const { data: owned, error: ownedError } = await supabaseAdmin
        .from("shows")
        .select("id, contact_email, data_sources")
        .contains("data_sources", ["show_owner"])
        .ilike("contact_email", escapeIlike(trimmed));
      if (ownedError) {
        console.error("[resolveOwnerShowId] owner show lookup", ownedError.message);
      } else {
        for (const row of (owned ?? []) as Array<{
          id: string;
          contact_email?: string | null;
          data_sources?: string[] | null;
        }>) {
          if (!isShowOwnerRow(row.data_sources) || !emailsMatch(row.contact_email, trimmed)) {
            continue;
          }
          add(row);
        }
      }
    }
  } catch (err) {
    console.error("[resolveOwnerShowId] catalog identities", err);
  }

  return [...byId.values()];
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

async function resolveOwnerShowId(
  userId: string,
  email: string,
  profile: ShowProfile
): Promise<string | null> {
  // Catalog attachment goes through a deal or a show_owner email.
  // show_profiles.podscan_id is self-reported and is not a tie.
  const verifiedShowIds = await verifiedCatalogShowIds(profile, email);
  let catalogShowId: string | null = null;
  let catalogOwnedByOther = false;
  for (const id of verifiedShowIds) {
    const { data: owners } = await supabaseAdmin
      .from("show_surfaces")
      .select("owner_user_id")
      .eq("show_id", id);
    const ownedByOther = ((owners ?? []) as { owner_user_id: string }[]).some(
      (row) => row.owner_user_id && row.owner_user_id !== userId
    );
    if (!ownedByOther) {
      catalogShowId = id;
      catalogOwnedByOther = false;
      break;
    }
    if (!catalogShowId) {
      catalogShowId = id;
      catalogOwnedByOther = true;
    }
  }

  const slug = ownerShowSlug(userId);
  const { data: existing } = await supabaseAdmin
    .from("shows")
    .select("id")
    .eq("slug", slug)
    .maybeSingle();
  const existingOwnerShowId = (existing as { id: string } | null)?.id ?? null;

  const choice = chooseSurfaceShowId({
    catalogShowId,
    catalogOwnedByOther,
    existingOwnerShowId,
  });
  if (choice.showId) return choice.showId;

  const created = await createShow({
    name: profile.show_name?.trim() || "Show",
    platform: profile.platform === "youtube" ? "youtube" : "podcast",
    slug,
    description: profile.show_description ?? "",
    categories: profile.show_categories ?? [],
    audience_size: profile.audience_size ?? undefined,
    rss_url: profile.feed_url ?? undefined,
    contact: {
      name: profile.show_name?.trim() || "Show",
      email,
      method: "email",
    },
    data_sources: ["show_owner"],
    is_claimed: true,
    is_verified: false,
    is_discoverable: false,
  });
  return created?.id ?? null;
}

/**
 * Rows for an IO attachment check. Unpublished rows are included on purpose:
 * the caller must reject them instead of treating "not in a published-only
 * query" as a skip. A lookup failure is fail-closed (`ok: false`).
 */
export async function fetchSurfaceAttachment(
  dealShowId: string,
  surfaceIds: string[]
): Promise<
  | { ok: true; surfaces: SellableSurface[]; shows: SurfaceShowIdentity[] }
  | { ok: false }
> {
  const ids = [...new Set(surfaceIds.filter((id) => id.length > 0))];
  if (!dealShowId || ids.length === 0) return { ok: false };
  try {
    const { data, error } = await supabaseAdmin
      .from("show_surfaces")
      .select(
        "id, show_id, type, audience_size, format, min_buy, creative_constraints, lead_time_days, posting_owner, price, notes, published"
      )
      .in("id", ids);
    if (error || !data) return { ok: false };

    const surfaces = (data as SurfaceRow[]).map(toSellable);
    const showIds = [...new Set([dealShowId, ...surfaces.map((surface) => surface.show_id)])];
    const { data: showRows, error: showError } = await supabaseAdmin
      .from("shows")
      .select("id, name, platform")
      .in("id", showIds);
    if (showError || !showRows) return { ok: false };

    const shows = (showRows as { id: string; name: string | null; platform: string | null }[]).map(
      (row) => ({
        id: row.id,
        name: row.name ?? "",
        platform: row.platform ?? "",
      })
    );
    return { ok: true, surfaces, shows };
  } catch (err) {
    console.error("[fetchSurfaceAttachment]", err);
    return { ok: false };
  }
}

/** Replace the creator's whole surface list. Empty drafts clear it. */
export async function replaceOwnerSurfaces(
  userId: string,
  email: string,
  profile: ShowProfile,
  drafts: ShowSurfaceDraft[]
): Promise<SellableSurface[] | null> {
  const showId = await resolveOwnerShowId(userId, email, profile);
  if (!showId) return null;

  const { error: deleteError } = await supabaseAdmin
    .from("show_surfaces")
    .delete()
    .eq("owner_user_id", userId);
  if (deleteError) {
    console.error("[replaceOwnerSurfaces] delete", deleteError.message);
    return null;
  }
  if (drafts.length === 0) return [];

  const { data, error } = await supabaseAdmin
    .from("show_surfaces")
    .insert(
      drafts.map((draft) => ({
        show_id: showId,
        owner_user_id: userId,
        type: draft.type,
        audience_size: draft.audience_size,
        format: draft.format,
        min_buy: draft.min_buy,
        creative_constraints: draft.creative_constraints,
        lead_time_days: draft.lead_time_days,
        posting_owner: draft.posting_owner,
        price: draft.price,
        notes: draft.notes,
        published: draft.published,
      }))
    )
    .select(
      "id, show_id, type, audience_size, format, min_buy, creative_constraints, lead_time_days, posting_owner, price, notes, published"
    );
  if (error || !data) {
    console.error("[replaceOwnerSurfaces] insert", error?.message);
    return null;
  }
  return (data as SurfaceRow[]).map(toSellable);
}
