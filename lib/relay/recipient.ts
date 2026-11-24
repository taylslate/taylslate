// Resolve an outreach recipient from a show on a campaign the caller
// owns. Never read an address from the request. Server only.

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

/** One campaign read, then one batched catalog read, for every show. */
export async function canReachOutMany(input: {
  userId: string;
  campaignId: string;
  shows: ShowRef[];
}): Promise<boolean[]> {
  const resolved = await resolveMany(input.userId, input.campaignId, input.shows);
  return resolved.map((row) => row.ok);
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
    const catalogIds: string[] = [];
    for (const show of shows) {
      for (const id of uuidRefs(show)) {
        if (onCampaign.has(id) && !catalogIds.includes(id)) catalogIds.push(id);
      }
    }
    const emails = await catalogEmails(catalogIds);
    return shows.map((show) => resolveOne(campaign, onCampaign, emails, show));
  } catch {
    console.warn("[relay] recipient", "unknown");
    return shows.map(() => ({ ok: false, reason: "not_found" as const }));
  }
}

function resolveOne(
  campaign: CampaignRow,
  onCampaign: Set<string>,
  emails: Map<string, string | null>,
  show: ShowRef
): ResolvedRecipient {
  const uuids = uuidRefs(show);
  if (uuids.some((id) => !onCampaign.has(id))) {
    return { ok: false, reason: "not_found" };
  }
  for (const id of uuids) {
    if (!emails.has(id)) continue;
    const email = emails.get(id);
    return email
      ? { ok: true, email, catalogShowId: id }
      : { ok: false, reason: "no_contact" };
  }
  const fromCampaign = emailFromCampaign(campaign, show.showId, show.podscanId);
  if (fromCampaign) return { ok: true, email: fromCampaign, catalogShowId: null };
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

async function catalogEmails(ids: string[]): Promise<Map<string, string | null>> {
  const emails = new Map<string, string | null>();
  for (let index = 0; index < ids.length; index += CHUNK) {
    const chunk = ids.slice(index, index + CHUNK);
    const { data, error } = await supabaseAdmin
      .from("shows")
      .select("id, contact_email")
      .in("id", chunk);
    if (error) {
      console.warn("[relay] recipient", error.code ?? "unknown");
      continue;
    }
    for (const row of (data ?? []) as Array<{ id?: unknown; contact_email?: unknown }>) {
      if (typeof row.id !== "string") continue;
      emails.set(row.id, validEmail(row.contact_email));
    }
  }
  return emails;
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

function emailFromCampaign(campaign: CampaignRow, showId?: string | null, podscanId?: string | null): string | null {
  const keys = new Set(stringRefs({ showId, podscanId }));
  if (keys.size === 0) return null;
  if (Array.isArray(campaign.scored_shows)) {
    for (const row of campaign.scored_shows) {
      if (!row || typeof row !== "object") continue;
      const record = row as { podcastId?: unknown; contactEmail?: unknown };
      if (typeof record.podcastId === "string" && keys.has(record.podcastId)) {
        const email = validEmail(record.contactEmail);
        if (email) return email;
      }
    }
  }
  for (const list of [campaign.recommendations, campaign.youtube_recommendations, campaign.expansion_opportunities]) {
    if (!Array.isArray(list)) continue;
    for (const row of list) {
      if (!row || typeof row !== "object") continue;
      const record = row as { show_id?: unknown; contact_email?: unknown };
      if (typeof record.show_id === "string" && keys.has(record.show_id)) {
        const email = validEmail(record.contact_email);
        if (email) return email;
      }
    }
  }
  return null;
}

function uuidRefs(show: ShowRef): string[] {
  return stringRefs(show).filter((id) => UUID.test(id));
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
