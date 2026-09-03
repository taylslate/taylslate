// ============================================================
// Show row → domain object transform.
//
// Extracted from lib/data/queries.ts so both the cookie-based query layer
// AND the supabaseAdmin reasoning-log layer can map raw `shows` rows into the
// Show domain shape without either importing the other. The ONLY reshape is
// the nested `contact` object (flat contact_name/contact_email/contact_method
// → { name, email, method }); every other field is a same-key passthrough with
// a null→default coalesce. Any raw-join site that casts `shows(*)` to Show
// WITHOUT calling this leaves `contact` undefined and every nullable column raw
// null instead of its default.
// ============================================================

import type { Show, ShowContact } from "./types";

/** Transform flat DB row into Show with nested contact object */
export function transformShow(row: Record<string, unknown>): Show {
  const contact: ShowContact = {
    name: (row.contact_name as string) ?? "",
    email: (row.contact_email as string) ?? "",
    method: ((row.contact_method as string) ?? "email") as ShowContact["method"],
  };

  return {
    id: row.id as string,
    name: row.name as string,
    platform: row.platform as Show["platform"],
    description: (row.description as string) ?? "",
    image_url: row.image_url as string | undefined,
    categories: (row.categories as string[]) ?? [],
    tags: (row.tags as string[]) ?? [],
    network: row.network as string | undefined,
    contact,
    agent_id: row.agent_id as string | undefined,
    audience_size: (row.audience_size as number) ?? 0,
    demographics: (row.demographics as Show["demographics"]) ?? {},
    audience_interests: (row.audience_interests as string[]) ?? [],
    audience_purchase_power: row.audience_purchase_power as number | undefined,
    rate_card: (row.rate_card as Show["rate_card"]) ?? {},
    price_type: (row.price_type as Show["price_type"]) ?? "cpm",
    min_buy: row.min_buy as number | undefined,
    ad_formats: (row.ad_formats as Show["ad_formats"]) ?? [],
    episode_cadence: (row.episode_cadence as Show["episode_cadence"]) ?? "weekly",
    avg_episode_length_min: (row.avg_episode_length_min as number) ?? 0,
    current_sponsors: (row.current_sponsors as string[]) ?? [],
    past_sponsors: (row.past_sponsors as string[]) ?? [],
    apple_id: row.apple_id as string | undefined,
    spotify_id: row.spotify_id as string | undefined,
    youtube_channel_id: row.youtube_channel_id as string | undefined,
    rss_url: row.rss_url as string | undefined,
    is_claimed: (row.is_claimed as boolean) ?? false,
    is_verified: (row.is_verified as boolean) ?? false,
    is_discoverable: (row.is_discoverable as boolean) ?? true,
    available_slots: row.available_slots as number | undefined,
    next_available_date: row.next_available_date as string | undefined,
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
  };
}
