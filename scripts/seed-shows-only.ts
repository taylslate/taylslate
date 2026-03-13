#!/usr/bin/env npx tsx
// Quick seed: just shows from seed data (no Podscan, no FK dependencies)

import { createClient } from "@supabase/supabase-js";
import { createHash } from "crypto";
import { shows } from "../lib/data/seed";
import { readFileSync } from "fs";
import { resolve } from "path";

// Load env
const envContent = readFileSync(resolve(process.cwd(), ".env.local"), "utf-8");
for (const line of envContent.split("\n")) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) continue;
  const eqIdx = trimmed.indexOf("=");
  if (eqIdx === -1) continue;
  const key = trimmed.slice(0, eqIdx);
  const value = trimmed.slice(eqIdx + 1);
  if (!process.env[key]) process.env[key] = value;
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

function toUUID(fakeId: string): string {
  const hash = createHash("md5").update(fakeId).digest("hex");
  return [hash.slice(0, 8), hash.slice(8, 12), hash.slice(12, 16), hash.slice(16, 20), hash.slice(20, 32)].join("-");
}

async function main() {
  console.log(`Seeding ${shows.length} shows...\n`);

  const rows = shows.map((s) => {
    const { contact, ...rest } = s;
    return {
      id: toUUID(s.id),
      name: s.name,
      slug: s.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, ""),
      platform: s.platform,
      description: s.description || "",
      image_url: s.image_url || null,
      categories: s.categories,
      tags: s.tags,
      network: s.network || null,
      contact_name: contact.name,
      contact_email: contact.email,
      contact_method: contact.method,
      agent_id: null,
      audience_size: s.audience_size,
      demographics: s.demographics,
      audience_interests: s.audience_interests,
      rate_card: s.rate_card,
      price_type: s.price_type,
      min_buy: s.min_buy || null,
      ad_formats: s.ad_formats,
      episode_cadence: s.episode_cadence,
      avg_episode_length_min: s.avg_episode_length_min,
      current_sponsors: s.current_sponsors,
      past_sponsors: s.past_sponsors ?? [],
      apple_id: s.apple_id || null,
      spotify_id: s.spotify_id || null,
      youtube_channel_id: s.youtube_channel_id || null,
      rss_url: s.rss_url || null,
      is_claimed: s.is_claimed,
      is_verified: s.is_verified,
      data_sources: ["seed"],
      available_slots: s.available_slots || null,
      next_available_date: s.next_available_date || null,
      created_at: s.created_at,
      updated_at: s.updated_at,
    };
  });

  const { error } = await supabase.from("shows").upsert(rows, { onConflict: "id" });
  if (error) {
    console.error("✗ Error:", error.message);
    process.exit(1);
  }

  const { data, error: countErr } = await supabase
    .from("shows")
    .select("id, name, audience_size, platform")
    .order("audience_size", { ascending: false });

  if (!countErr && data) {
    console.log(`✅ ${data.length} shows inserted!\n`);
    for (const s of data) {
      console.log(`  ${s.name.padEnd(35)} ${String(s.audience_size).padStart(8)} dl/ep  [${s.platform}]`);
    }
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
