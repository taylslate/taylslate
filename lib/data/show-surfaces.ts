// Server reads and writes for show_surfaces. Fail-soft on reads so a
// campaign page still renders before migration 044 is applied. Writes
// go through the service role after the route has checked the user.

import { supabaseAdmin } from "@/lib/supabase/admin";
import { createShow } from "@/lib/data/queries";
import type { ShowProfile } from "@/lib/data/types";
import {
  chooseSurfaceShowId,
  groupPublishedSurfaces,
  ownerShowSlug,
  type SellableSurface,
  type ShowSurfaceDraft,
} from "@/lib/shows/surfaces";

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

async function resolveOwnerShowId(
  userId: string,
  email: string,
  profile: ShowProfile
): Promise<string | null> {
  let catalogShowId: string | null = null;
  let catalogOwnedByOther = false;
  if (profile.podscan_id) {
    const { data } = await supabaseAdmin
      .from("shows")
      .select("id")
      .eq("podscan_id", profile.podscan_id)
      .limit(1);
    catalogShowId = (data?.[0] as { id: string } | undefined)?.id ?? null;
    if (catalogShowId) {
      const { data: owners } = await supabaseAdmin
        .from("show_surfaces")
        .select("owner_user_id")
        .eq("show_id", catalogShowId);
      catalogOwnedByOther = ((owners ?? []) as { owner_user_id: string }[]).some(
        (row) => row.owner_user_id && row.owner_user_id !== userId
      );
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
