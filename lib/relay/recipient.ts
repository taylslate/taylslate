// Resolve an outreach recipient from the server-side catalog.
// Campaign JSON is only an ownership and membership check.
// Never read an address from the request or from campaign JSON.

import { supabaseAdmin } from "@/lib/supabase/admin";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CHUNK = 80;

type CampaignRow = {
  id?: unknown;
  user_id?: unknown;
  selected_show_ids?: unknown;
  scored_shows?: unknown;
  recommendations?: unknown;
  youtube_recommendations?: unknown;
  expansion_opportunities?: unknown;
};

type ShowRef = { showId?: string | null; podscanId?: string | null };

type CatalogShow = {
  id: string;
  email: string | null;
  discoverable: boolean;
  podscanId: string | null;
};

export type ResolvedRecipient =
  | { ok: true; email: string; catalogShowId: string | null }
  | { ok: false; reason: "not_found" | "no_contact" };

export async function resolveOutreachRecipient(input: {
  userId: string;
  campaignId: string;
  showId?: string | null;
  podscanId?: string | null;
}): Promise<ResolvedRecipient> {
  const [resolved] = await resolveMany(input.userId, input.campaignId, [
    { showId: input.showId, podscanId: input.podscanId },
  ]);
  return resolved ?? { ok: false, reason: "not_found" };
}

export async function canReachOut(input: {
  userId: string;
  campaignId: string;
  showId?: string | null;
  podscanId?: string | null;
}): Promise<boolean> {
  const resolved = await resolveOutreachRecipient(input);
  return resolved.ok;
}

/** One campaign read, then batched catalog reads, for every show. */
export async function canReachOutMany(input: {
  userId: string;
  campaignId: string;
  shows: ShowRef[];
}): Promise<boolean[]> {
  const resolved = await resolveMany(input.userId, input.campaignId, input.shows);
  return resolved.map((row) => row.ok);
}

/**
 * Shows this caller may pitch. Discoverable catalog rows, an approved
 * roster row, or a deal that came from an accepted outreach. A legacy
 * deal with a null outreach_id does not count. Fail closed.
 */
export async function pitchableShowIds(userId: string, showIds: string[]): Promise<Set<string>> {
  const out = new Set<string>();
  const ids = uniqueUuids(showIds);
  if (!userId || ids.length === 0) return out;

  for (const chunk of chunks(ids)) {
    try {
      const { data, error } = await supabaseAdmin
        .from("shows")
        .select("id, is_discoverable")
        .in("id", chunk);
      if (error) {
        console.warn("[relay] recipient", error.code ?? "unknown");
        continue;
      }
      for (const row of (data ?? []) as Array<{ id?: unknown; is_discoverable?: unknown }>) {
        if (typeof row.id === "string" && row.is_discoverable === true) out.add(row.id);
      }
    } catch {
      console.warn("[relay] recipient", "unknown");
    }
  }

  for (const chunk of chunks(ids)) {
    try {
      const { data, error } = await supabaseAdmin
        .from("agent_show_relationships")
        .select("show_id, status")
        .eq("agent_id", userId)
        .in("show_id", chunk);
      if (error) {
        console.warn("[relay] recipient", error.code ?? "unknown");
        continue;
      }
      for (const row of (data ?? []) as Array<{ show_id?: unknown; status?: unknown }>) {
        if (typeof row.show_id === "string" && row.status === "approved") out.add(row.show_id);
      }
    } catch {
      console.warn("[relay] recipient", "unknown");
    }
  }

  let profiles = new Set<string>();
  try {
    profiles = await brandProfileIds(userId);
  } catch {
    console.warn("[relay] recipient", "unknown");
  }
  for (const chunk of chunks(ids)) {
    try {
      const { data, error } = await supabaseAdmin
        .from("deals")
        .select("show_id, outreach_id, brand_id, agency_id, brand_profile_id")
        .in("show_id", chunk)
        .not("outreach_id", "is", null);
      if (error) {
        console.warn("[relay] recipient", error.code ?? "unknown");
        continue;
      }
      for (const row of (data ?? []) as Array<{
        show_id?: unknown;
        outreach_id?: unknown;
        brand_id?: unknown;
        agency_id?: unknown;
        brand_profile_id?: unknown;
      }>) {
        if (typeof row.show_id !== "string" || row.outreach_id == null || row.outreach_id === "") {
          continue;
        }
        const profileId = typeof row.brand_profile_id === "string" ? row.brand_profile_id : null;
        if (
          row.brand_id === userId ||
          row.agency_id === userId ||
          (profileId != null && profiles.has(profileId))
        ) {
          out.add(row.show_id);
        }
      }
    } catch {
      console.warn("[relay] recipient", "unknown");
    }
  }
  return out;
}

async function resolveMany(
  userId: string,
  campaignId: string,
  shows: ShowRef[]
): Promise<ResolvedRecipient[]> {
  try {
    const campaign = await loadCampaign(campaignId);
    if (!campaign || campaign.user_id !== userId) {
      return shows.map(() => ({ ok: false, reason: "not_found" as const }));
    }
    const onCampaign = campaignShowKeys(campaign);
    const uuidIds: string[] = [];
    const podscanIds: string[] = [];
    for (const show of shows) {
      for (const id of stringRefs(show)) {
        if (!onCampaign.has(id)) continue;
        if (UUID.test(id)) {
          if (!uuidIds.includes(id)) uuidIds.push(id);
        } else if (!podscanIds.includes(id)) {
          podscanIds.push(id);
        }
      }
    }
    const byId = await catalogById(uuidIds);
    const byPodscan = await catalogByPodscan(podscanIds);
    const matched = [
      ...byId.values(),
      ...byPodscan.values(),
    ].map((row) => row.id);
    const pitchable = await pitchableShowIds(userId, matched);
    return shows.map((show) => resolveOne(onCampaign, byId, byPodscan, pitchable, show));
  } catch {
    console.warn("[relay] recipient", "unknown");
    return shows.map(() => ({ ok: false, reason: "not_found" as const }));
  }
}

function resolveOne(
  onCampaign: Set<string>,
  byId: Map<string, CatalogShow>,
  byPodscan: Map<string, CatalogShow>,
  pitchable: Set<string>,
  show: ShowRef
): ResolvedRecipient {
  const refs = stringRefs(show);
  const uuids = refs.filter((id) => UUID.test(id));
  if (uuids.some((id) => !onCampaign.has(id))) {
    return { ok: false, reason: "not_found" };
  }
  for (const id of uuids) {
    const row = byId.get(id);
    if (!row) continue;
    if (!pitchable.has(row.id)) return { ok: false, reason: "not_found" };
    return row.email
      ? { ok: true, email: row.email, catalogShowId: row.id }
      : { ok: false, reason: "no_contact" };
  }
  for (const id of refs) {
    if (UUID.test(id) || !onCampaign.has(id)) continue;
    const row = byPodscan.get(id);
    if (!row) continue;
    if (!pitchable.has(row.id)) return { ok: false, reason: "not_found" };
    return row.email
      ? { ok: true, email: row.email, catalogShowId: row.id }
      : { ok: false, reason: "no_contact" };
  }
  return { ok: false, reason: "no_contact" };
}

async function loadCampaign(campaignId: string): Promise<CampaignRow | null> {
  const { data, error } = await supabaseAdmin
    .from("campaigns")
    .select(
      "id, user_id, selected_show_ids, scored_shows, recommendations, youtube_recommendations, expansion_opportunities"
    )
    .eq("id", campaignId)
    .maybeSingle();
  if (error) {
    console.warn("[relay] recipient", error.code ?? "unknown");
    return null;
  }
  return (data as CampaignRow | null) ?? null;
}

async function catalogById(ids: string[]): Promise<Map<string, CatalogShow>> {
  const found = new Map<string, CatalogShow>();
  for (const chunk of chunks(ids)) {
    const { data, error } = await supabaseAdmin
      .from("shows")
      .select("id, contact_email, is_discoverable, podscan_id")
      .in("id", chunk);
    if (error) {
      console.warn("[relay] recipient", error.code ?? "unknown");
      continue;
    }
    for (const row of (data ?? []) as Array<Record<string, unknown>>) {
      const show = catalogShow(row);
      if (show) found.set(show.id, show);
    }
  }
  return found;
}

async function catalogByPodscan(ids: string[]): Promise<Map<string, CatalogShow>> {
  const found = new Map<string, CatalogShow>();
  for (const chunk of chunks(ids)) {
    const { data, error } = await supabaseAdmin
      .from("shows")
      .select("id, contact_email, is_discoverable, podscan_id")
      .in("podscan_id", chunk);
    if (error) {
      console.warn("[relay] recipient", error.code ?? "unknown");
      continue;
    }
    for (const row of (data ?? []) as Array<Record<string, unknown>>) {
      const show = catalogShow(row);
      if (!show?.podscanId || found.has(show.podscanId)) continue;
      found.set(show.podscanId, show);
    }
  }
  return found;
}

function catalogShow(row: Record<string, unknown>): CatalogShow | null {
  if (typeof row.id !== "string") return null;
  return {
    id: row.id,
    email: validEmail(row.contact_email),
    discoverable: row.is_discoverable === true,
    podscanId: typeof row.podscan_id === "string" && row.podscan_id.length > 0 ? row.podscan_id : null,
  };
}

async function brandProfileIds(userId: string): Promise<Set<string>> {
  const ids = new Set<string>();
  const { data, error } = await supabaseAdmin
    .from("brand_profiles")
    .select("id")
    .eq("user_id", userId);
  if (error) {
    console.warn("[relay] recipient", error.code ?? "unknown");
    return ids;
  }
  for (const row of (data ?? []) as Array<{ id?: unknown }>) {
    if (typeof row.id === "string" && row.id.length > 0) ids.add(row.id);
  }
  return ids;
}

function campaignShowKeys(campaign: CampaignRow): Set<string> {
  const keys = new Set<string>();
  if (Array.isArray(campaign.selected_show_ids)) {
    for (const id of campaign.selected_show_ids) addKey(keys, id);
  }
  if (Array.isArray(campaign.scored_shows)) {
    for (const row of campaign.scored_shows) {
      if (!row || typeof row !== "object") continue;
      addKey(keys, (row as { podcastId?: unknown }).podcastId);
    }
  }
  for (const list of [campaign.recommendations, campaign.youtube_recommendations, campaign.expansion_opportunities]) {
    if (!Array.isArray(list)) continue;
    for (const row of list) {
      if (!row || typeof row !== "object") continue;
      addKey(keys, (row as { show_id?: unknown }).show_id);
    }
  }
  return keys;
}

function stringRefs(show: ShowRef): string[] {
  const out: string[] = [];
  if (typeof show.showId === "string" && show.showId.length > 0) out.push(show.showId);
  if (typeof show.podscanId === "string" && show.podscanId.length > 0 && show.podscanId !== show.showId) {
    out.push(show.podscanId);
  }
  return out;
}

function addKey(keys: Set<string>, value: unknown) {
  if (typeof value === "string" && value.length > 0) keys.add(value);
}

function validEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  if (!email || email.length > 320 || !EMAIL.test(email)) return null;
  return email;
}

function uniqueUuids(values: string[]): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    if (!UUID.test(value) || seen.has(value)) continue;
    seen.add(value);
    ids.push(value);
  }
  return ids;
}

function chunks(ids: string[]): string[][] {
  const out: string[][] = [];
  for (let index = 0; index < ids.length; index += CHUNK) {
    out.push(ids.slice(index, index + CHUNK));
  }
  return out;
}
