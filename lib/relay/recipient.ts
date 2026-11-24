// Resolve an outreach recipient from a show the caller owns on a
// campaign. Never read an address from the request. Server only.

import { supabaseAdmin } from "@/lib/supabase/admin";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type CampaignRow = {
  id?: unknown;
  user_id?: unknown;
  scored_shows?: unknown;
  recommendations?: unknown;
  youtube_recommendations?: unknown;
  expansion_opportunities?: unknown;
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
  try {
    const { data, error } = await supabaseAdmin
      .from("campaigns")
      .select("id, user_id, scored_shows, recommendations, youtube_recommendations, expansion_opportunities")
      .eq("id", input.campaignId)
      .maybeSingle();
    if (error) {
      console.warn("[relay] recipient", error.code ?? "unknown");
      return { ok: false, reason: "not_found" };
    }
    const campaign = data as CampaignRow | null;
    if (!campaign || campaign.user_id !== input.userId) return { ok: false, reason: "not_found" };

    const catalog = await catalogContact(input.showId, input.podscanId);
    if (catalog.found) {
      return catalog.email
        ? { ok: true, email: catalog.email, catalogShowId: catalog.id }
        : { ok: false, reason: "no_contact" };
    }

    const fromCampaign = emailFromCampaign(campaign, input.showId, input.podscanId);
    if (fromCampaign) return { ok: true, email: fromCampaign, catalogShowId: null };
    return { ok: false, reason: "no_contact" };
  } catch {
    console.warn("[relay] recipient", "unknown");
    return { ok: false, reason: "not_found" };
  }
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

async function catalogContact(
  showId?: string | null,
  podscanId?: string | null
): Promise<{ found: boolean; id: string | null; email: string | null }> {
  const candidates = [showId, podscanId].filter((value): value is string => typeof value === "string" && UUID.test(value));
  for (const id of candidates) {
    const { data, error } = await supabaseAdmin
      .from("shows")
      .select("id, contact_email")
      .eq("id", id)
      .maybeSingle();
    if (error) {
      console.warn("[relay] recipient", error.code ?? "unknown");
      continue;
    }
    if (!data) continue;
    return { found: true, id, email: validEmail(data.contact_email) };
  }
  return { found: false, id: null, email: null };
}

function emailFromCampaign(campaign: CampaignRow, showId?: string | null, podscanId?: string | null): string | null {
  const keys = new Set([showId, podscanId].filter((value): value is string => typeof value === "string" && value.length > 0));
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

function validEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  if (!email || email.length > 320 || !EMAIL.test(email)) return null;
  return email;
}
