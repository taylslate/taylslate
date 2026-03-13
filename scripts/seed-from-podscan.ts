#!/usr/bin/env npx tsx
// ============================================================
// SEED SHOWS FROM PODSCAN API
// Run: npx tsx scripts/seed-from-podscan.ts
//
// Looks up each show from seed data in Podscan, pulls real
// audience data, categories, sponsors, and description.
// Agent-provided CPMs and rate cards ALWAYS take precedence.
// ============================================================

import { createClient } from "@supabase/supabase-js";
import { createHash } from "crypto";
import { shows } from "../lib/data/seed";
import type { Show } from "../lib/data/types";

// Convert fake string IDs like "show-005" into valid UUIDs (deterministic)
function toUUID(fakeId: string): string {
  const hash = createHash("md5").update(fakeId).digest("hex");
  return [
    hash.slice(0, 8),
    hash.slice(8, 12),
    hash.slice(12, 16),
    hash.slice(16, 20),
    hash.slice(20, 32),
  ].join("-");
}

// Load env
import { readFileSync } from "fs";
import { resolve } from "path";
const envPath = resolve(process.cwd(), ".env.local");
const envContent = readFileSync(envPath, "utf-8");
for (const line of envContent.split("\n")) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) continue;
  const eqIdx = trimmed.indexOf("=");
  if (eqIdx === -1) continue;
  const key = trimmed.slice(0, eqIdx);
  const value = trimmed.slice(eqIdx + 1);
  if (!process.env[key]) process.env[key] = value;
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const podscanKey = process.env.PODSCAN_API_KEY!;

if (!supabaseUrl || !serviceRoleKey) {
  console.error("Missing Supabase env vars");
  process.exit(1);
}
if (!podscanKey) {
  console.error("Missing PODSCAN_API_KEY in .env.local");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey);

const PODSCAN_BASE = "https://podscan.fm/api/v1";

interface PodscanPodcast {
  podcast_id: string;
  podcast_name: string;
  podcast_description?: string;
  podcast_image_url?: string;
  podcast_categories?: string[];
  podcast_has_sponsors?: boolean;
  publisher_name?: string;
  reach?: number;
  rss_url?: string;
  episode_count?: number;
  language?: string;
  is_active?: boolean;
  last_posted_at?: string;
}

interface PodscanEpisode {
  episode_id: string;
  episode_title: string;
  podcast_id?: string;
  podcast_name?: string;
  podcast?: PodscanPodcast;
}

interface PodscanEntity {
  entity_id: string;
  name: string;
  type: string;
}

async function podscanFetch<T>(path: string, params?: Record<string, string>): Promise<T> {
  const url = new URL(`${PODSCAN_BASE}${path}`);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v) url.searchParams.set(k, v);
    }
  }
  const res = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${podscanKey}`,
      "Content-Type": "application/json",
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Podscan ${res.status}: ${text}`);
  }
  return res.json() as Promise<T>;
}

async function findPodcast(name: string): Promise<PodscanPodcast | null> {
  try {
    const res = await podscanFetch<{ data: PodscanEpisode[] }>("/episodes/search", {
      query: name,
      per_page: "5",
      show_full_podcast: "true",
      exclude_transcript: "true",
      order_by: "best_match",
      show_only_fully_processed: "true",
    });

    if (!res.data || res.data.length === 0) return null;

    const normalizedQuery = name.toLowerCase().trim();
    const match = res.data.find((ep) => {
      const podName = (ep.podcast?.podcast_name ?? ep.podcast_name ?? "").toLowerCase().trim();
      return podName === normalizedQuery || podName.includes(normalizedQuery) || normalizedQuery.includes(podName);
    });

    return match?.podcast ?? res.data[0]?.podcast ?? null;
  } catch (err) {
    console.warn(`  ⚠ Podscan search failed for "${name}": ${err}`);
    return null;
  }
}

async function getSponsors(podcastId: string): Promise<string[]> {
  try {
    // Get recent episodes with sponsors
    const episodes = await podscanFetch<{ data: PodscanEpisode[] }>("/episodes/search", {
      podcast_ids: podcastId,
      per_page: "10",
      exclude_transcript: "true",
      has_sponsors: "true",
      order_by: "posted_at",
      order_dir: "desc",
    });

    if (!episodes.data || episodes.data.length === 0) return [];

    const sponsorSet = new Set<string>();

    // Pull sponsor entities from up to 5 episodes
    for (const ep of episodes.data.slice(0, 5)) {
      try {
        const entities = await podscanFetch<{ sponsors?: PodscanEntity[] }>(
          `/episodes/${ep.episode_id}/entities`,
          { role: "sponsor" }
        );
        if (entities.sponsors) {
          for (const s of entities.sponsors) {
            sponsorSet.add(s.name);
          }
        }
      } catch {
        continue;
      }
      // Small delay to respect rate limits
      await sleep(200);
    }

    return Array.from(sponsorSet);
  } catch {
    return [];
  }
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function seedShow(show: Show) {
  const isPodcast = show.platform === "podcast";

  // Only look up podcasts in Podscan (not YouTube channels)
  let podscanData: PodscanPodcast | null = null;
  let sponsors: string[] = [];

  if (isPodcast) {
    podscanData = await findPodcast(show.name);

    if (podscanData) {
      console.log(`  ✓ Found "${show.name}" in Podscan (reach: ${podscanData.reach ?? "N/A"})`);

      // Get sponsors if found
      sponsors = await getSponsors(podscanData.podcast_id);
      if (sponsors.length > 0) {
        console.log(`    → ${sponsors.length} sponsors detected: ${sponsors.slice(0, 5).join(", ")}`);
      }
    } else {
      console.log(`  ○ "${show.name}" not found in Podscan — using seed data`);
    }
  } else {
    console.log(`  ○ "${show.name}" (YouTube) — Podscan is podcast-only, using seed data`);
  }

  // Build the row — agent data takes precedence, Podscan fills gaps
  const slug = show.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

  const row: Record<string, unknown> = {
    id: toUUID(show.id),
    name: show.name,
    slug,
    platform: show.platform,
    // Description: prefer seed if exists, else Podscan
    description: show.description || podscanData?.podcast_description || "",
    // Image: prefer Podscan (real), fallback to seed
    image_url: podscanData?.podcast_image_url || show.image_url || null,
    // Categories: merge seed + Podscan
    categories: mergeLists(show.categories, podscanData?.podcast_categories ?? []),
    tags: show.tags,
    network: show.network || podscanData?.publisher_name || null,
    contact_name: show.contact.name,
    contact_email: show.contact.email,
    contact_method: show.contact.method,
    // agent_id skipped — FK requires real profile UUID, seed has fake IDs
    // Audience: prefer seed (agent-provided), else Podscan reach
    audience_size: show.audience_size > 0 ? show.audience_size : (podscanData?.reach ?? 0),
    demographics: show.demographics,
    audience_interests: show.audience_interests,
    // Rate card: ALWAYS from seed — agent CPMs take precedence
    rate_card: show.rate_card,
    price_type: show.price_type,
    min_buy: show.min_buy || null,
    ad_formats: show.ad_formats,
    episode_cadence: show.episode_cadence,
    avg_episode_length_min: show.avg_episode_length_min,
    // Sponsors: merge seed + Podscan
    current_sponsors: mergeLists(show.current_sponsors, sponsors),
    past_sponsors: show.past_sponsors ?? [],
    apple_id: show.apple_id || null,
    spotify_id: show.spotify_id || null,
    youtube_channel_id: show.youtube_channel_id || null,
    rss_url: show.rss_url || podscanData?.rss_url || null,
    is_claimed: show.is_claimed,
    is_verified: show.is_verified,
    data_sources: podscanData ? ["seed", "podscan"] : ["seed"],
    available_slots: show.available_slots || null,
    next_available_date: show.next_available_date || null,
    last_api_refresh: podscanData ? new Date().toISOString() : null,
    created_at: show.created_at,
    updated_at: show.updated_at,
  };

  const { error } = await supabase.from("shows").upsert(row, { onConflict: "id" });
  if (error) {
    console.error(`  ✗ Failed to insert "${show.name}": ${error.message}`);
    return false;
  }
  return true;
}

function mergeLists(a: string[], b: string[]): string[] {
  const set = new Set(a.map((s) => s.toLowerCase()));
  const merged = [...a];
  for (const item of b) {
    if (!set.has(item.toLowerCase())) {
      merged.push(item);
      set.add(item.toLowerCase());
    }
  }
  return merged;
}

async function main() {
  console.log("🔍 Seeding shows from Podscan API + seed data...\n");
  console.log(`   ${shows.length} shows to process\n`);

  let success = 0;
  let failed = 0;

  for (const show of shows) {
    const ok = await seedShow(show);
    if (ok) success++;
    else failed++;

    // Rate limit: 10 req/min on trial plan — 7s between shows to stay safe
    await sleep(7000);
  }

  console.log(`\n✅ Done! ${success} inserted, ${failed} failed.`);

  // Verify
  const { data, error } = await supabase.from("shows").select("id, name, audience_size, data_sources").order("audience_size", { ascending: false });
  if (!error && data) {
    console.log(`\n📊 Shows in database (${data.length}):`);
    for (const s of data) {
      const sources = (s.data_sources ?? []).join("+");
      console.log(`   ${s.name.padEnd(30)} ${String(s.audience_size).padStart(8)} dl/ep  [${sources}]`);
    }
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
