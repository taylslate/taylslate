#!/usr/bin/env npx tsx
// ============================================================
// Backfill campaigns.scored_shows[].contactEmail
//
// Existing campaigns froze a scored_shows snapshot while the discovery path
// cast raw joined `shows` rows to Show WITHOUT transformShow, so the adapter's
// `show.contact?.email` always resolved to null. The source is now fixed
// (lib/data/show-transform.ts applied in reasoning-log.ts), but already-planned
// campaigns keep the stale null in their persisted snapshot. This patches only
// contactEmail, only where it is currently empty AND the live shows row has a
// real contact_email. Every other snapshot field is left untouched.
//
// Match key: scored_shows[].podcastId === shows.id (the adapter sets
// podcastId = conviction_scores.show_id FK). Records with no matching shows row
// are counted and skipped, never guessed.
//
// Usage:
//   npx tsx scripts/backfill-scored-shows-contact.ts           # DRY RUN (default): counts + per-campaign plan, no writes
//   npx tsx scripts/backfill-scored-shows-contact.ts --apply   # write empty contactEmail only (non-clobber)
// ============================================================

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { resolve } from "path";

// Load env (same pattern as the other scripts in this dir)
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

const APPLY = process.argv.includes("--apply");

type ScoredShow = { podcastId?: string | null; contactEmail?: string | null; name?: string };
type CampaignRow = { id: string; name: string | null; scored_shows: ScoredShow[] | null };

const isEmpty = (v: string | null | undefined) => v == null || v.trim() === "";
// shows.id is a UUID. Some scored_shows came from a podscan-sourced path whose
// podcastId is a podscan id (e.g. "pd_lz3od9w77wr5vxa8"), which can never match
// a shows.id — filter those out before the id query and bucket them separately.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v: string | null | undefined): v is string => !!v && UUID_RE.test(v);

async function main() {
  console.log(`\n=== Backfill scored_shows[].contactEmail (${APPLY ? "APPLY" : "DRY RUN"}) ===\n`);

  // 1. Every campaign with a snapshot.
  const { data: campaigns, error: campErr } = await supabase
    .from("campaigns")
    .select("id, name, scored_shows");
  if (campErr) {
    console.error("Failed to read campaigns:", campErr.message);
    process.exit(1);
  }
  const rows = (campaigns ?? []) as CampaignRow[];
  const withSnapshot = rows.filter((c) => Array.isArray(c.scored_shows) && c.scored_shows.length > 0);

  // 2. Collect every UUID show id referenced by an empty-contactEmail record.
  const neededIds = new Set<string>();
  for (const c of withSnapshot) {
    for (const s of c.scored_shows ?? []) {
      if (isEmpty(s.contactEmail) && isUuid(s.podcastId)) neededIds.add(s.podcastId);
    }
  }

  // 3. Fetch live contact_email for those shows (batched by id).
  const emailById = new Map<string, string | null>();
  const idList = [...neededIds];
  for (let i = 0; i < idList.length; i += 500) {
    const chunk = idList.slice(i, i + 500);
    const { data: shows, error: showErr } = await supabase
      .from("shows")
      .select("id, contact_email")
      .in("id", chunk);
    if (showErr) {
      console.error("Failed to read shows:", showErr.message);
      process.exit(1);
    }
    for (const s of shows ?? []) emailById.set(s.id as string, (s.contact_email as string) ?? null);
  }

  // 4. Compute the patch per campaign (non-clobber, contactEmail only).
  let campaignsAffected = 0;
  let showsFilled = 0;
  let alreadyPopulated = 0;
  let skipNonUuidId = 0;
  let skipNoMatchingShow = 0;
  let skipShowHasNoEmail = 0;
  const perCampaign: Array<{ id: string; name: string; filled: number; updated: ScoredShow[] }> = [];

  for (const c of withSnapshot) {
    const updated = (c.scored_shows ?? []).map((s) => ({ ...s }));
    let filled = 0;
    for (const s of updated) {
      if (!isEmpty(s.contactEmail)) {
        alreadyPopulated++;
        continue;
      }
      if (!isUuid(s.podcastId)) {
        skipNonUuidId++; // podscan-sourced record, never a shows.id
        continue;
      }
      if (!emailById.has(s.podcastId)) {
        skipNoMatchingShow++;
        continue;
      }
      const liveEmail = emailById.get(s.podcastId) ?? null;
      if (isEmpty(liveEmail)) {
        skipShowHasNoEmail++;
        continue;
      }
      s.contactEmail = liveEmail;
      filled++;
    }
    if (filled > 0) {
      campaignsAffected++;
      showsFilled += filled;
      perCampaign.push({ id: c.id, name: c.name ?? "(unnamed)", filled, updated });
    }
  }

  // 5. Report.
  console.log(`Campaigns scanned (with snapshot): ${withSnapshot.length}`);
  console.log(`Distinct shows referenced by empty records: ${neededIds.size}`);
  console.log(`  of those found in shows table: ${emailById.size}`);
  console.log("");
  console.log(`Campaigns to change:               ${campaignsAffected}`);
  console.log(`Shows to fill (contactEmail):      ${showsFilled}`);
  console.log(`Records already populated (skip):  ${alreadyPopulated}`);
  console.log(`Empty, podscan-id (not a shows.id):${skipNonUuidId}`);
  console.log(`Empty, no matching shows row:      ${skipNoMatchingShow}`);
  console.log(`Empty, shows row has no email:     ${skipShowHasNoEmail}`);
  console.log("");
  if (perCampaign.length > 0) {
    console.log("Per-campaign fill counts:");
    for (const p of perCampaign) {
      console.log(`  ${p.id}  ${p.filled.toString().padStart(3)}  ${p.name}`);
    }
    console.log("");
  }

  if (!APPLY) {
    console.log("DRY RUN — no writes. Re-run with --apply to persist.\n");
    return;
  }

  // 6. Write back only changed campaigns.
  let written = 0;
  for (const p of perCampaign) {
    const { error } = await supabase
      .from("campaigns")
      .update({ scored_shows: p.updated, updated_at: new Date().toISOString() })
      .eq("id", p.id);
    if (error) {
      console.error(`  FAILED ${p.id}: ${error.message}`);
      continue;
    }
    written++;
  }
  console.log(`\nAPPLIED — updated ${written}/${perCampaign.length} campaigns.\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
