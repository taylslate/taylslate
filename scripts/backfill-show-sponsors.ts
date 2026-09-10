#!/usr/bin/env npx tsx
// ============================================================
// Backfill shows.current_sponsors from Podscan sponsor history
//
// Two calls per show:
//   GET /podcasts/{id}/analysis        — all-time sponsor list (up to 50,
//                                        episode_count desc, NO dates)
//   GET /podcasts/{id}/latest/sponsor  — sponsors of the most recent
//                                        sponsored episode: the only
//                                        recency signal Podscan exposes
//
// Stored list (cap STORED_SPONSORS_CAP, decided Sep 10 2026): latest-
// episode sponsors first (verified still-running), then the analysis
// list by episode_count desc. The cap exists because outreach prompts
// join(", ") the full column and the all-time tail is where extraction
// junk sits (placeholders, email addresses, one-off mentions); 48 of 90
// shows saturate Podscan's 50-cap with years-spanning lists.
//
// Names are stored RAW within the cap — the report FLAGS suspected
// self-promo (token overlap with the show name) and Podscan's own
// sponsor_is_commercial=false marker, so noise is a reviewed number,
// not a hidden one; downstream prompts are told to weigh external
// brands. Dropped tail counts are reported per show (no silent caps).
//
// Usage:
//   npx tsx scripts/backfill-show-sponsors.ts           # DRY RUN: full report, no writes
//   npx tsx scripts/backfill-show-sponsors.ts --apply   # write sponsor lists
//
// Scope: is_discoverable=true with a podscan_id. Shows without one are
// reported as UNREACHABLE (resolve ids via backfill-show-demographics'
// review queue first). Fill-empty-only: rows with sponsors are skipped,
// so re-runs are safe. On write, data_sources gains "podscan" (merge)
// to record that Podscan enrichment has touched the row.
// ============================================================

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { resolve } from "path";
import {
  PodscanClient,
  PodscanError,
  type PodscanLatestSponsor,
  type PodscanSponsor,
} from "../lib/enrichment/podscan";

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
// Podscan Premium: 120 req/min. Sequential with a polite delay.
const REQUEST_DELAY_MS = 600;
// Stored per show: still-running head + most-recurrent tail (see header).
const STORED_SPONSORS_CAP = 10;

interface ShowRow {
  id: string;
  name: string;
  platform: string;
  podscan_id: string | null;
  current_sponsors: string[] | null;
  data_sources: string[] | null;
  is_discoverable: boolean | null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Function words + podcast-domain generics excluded from the overlap key —
// without this, "The Home Depot" flags against any "The …" show title.
const STOPWORD_TOKENS = new Set([
  "the", "and", "with", "for", "from", "your", "you", "our", "are",
  "this", "that", "what", "who", "how", "why", "not", "all", "out",
  "its", "into", "about", "podcast", "show", "presents",
]);

/** Distinctive tokens of 3+ chars from a name, lowercased — the self-promo overlap key. */
function nameTokens(name: string): Set<string> {
  return new Set(
    name
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length >= 3 && !STOPWORD_TOKENS.has(t))
  );
}

/** Report-only heuristic: sponsor shares a token with the show name. */
function looksLikeSelfPromo(sponsorName: string, showTokens: Set<string>): boolean {
  for (const token of nameTokens(sponsorName)) {
    if (showTokens.has(token)) return true;
  }
  return false;
}

interface RankedSponsors {
  /** Capped stored list: still-running head, then all-time frequency tail. */
  stored: string[];
  /** Lowercase keys of names seen in the latest sponsored episode. */
  stillRunning: Set<string>;
  /** Lowercase keys Podscan itself marks sponsor_is_commercial=false. */
  nonCommercial: Set<string>;
  totalDistinct: number;
  droppedCount: number;
}

/**
 * Merge the two sponsor sources into the stored order: latest-episode
 * sponsors first (the only recency signal — verified still-running), then
 * analysis names by episode_count desc (API order). Trim + case-insensitive
 * dedupe, cap at STORED_SPONSORS_CAP.
 */
function rankSponsors(
  analysisSponsors: PodscanSponsor[],
  latestSponsors: PodscanLatestSponsor[]
): RankedSponsors {
  const seen = new Set<string>();
  const ordered: string[] = [];
  const stillRunning = new Set<string>();
  const nonCommercial = new Set<string>();
  for (const s of latestSponsors) {
    const name = (s.sponsor_name ?? "").trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      ordered.push(name);
    }
    stillRunning.add(key);
    if (s.sponsor_is_commercial === false) nonCommercial.add(key);
  }
  for (const s of analysisSponsors) {
    const name = (s.name ?? "").trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    ordered.push(name);
  }
  return {
    stored: ordered.slice(0, STORED_SPONSORS_CAP),
    stillRunning,
    nonCommercial,
    totalDistinct: ordered.length,
    droppedCount: Math.max(0, ordered.length - STORED_SPONSORS_CAP),
  };
}

async function main() {
  console.log(
    `\n=== Backfill shows.current_sponsors (${APPLY ? "APPLY" : "DRY RUN"}) ===\n`
  );

  const { data: allShows, error: showsError } = await supabase
    .from("shows")
    .select(
      "id, name, platform, podscan_id, current_sponsors, data_sources, is_discoverable"
    )
    .eq("is_discoverable", true)
    .order("name", { ascending: true });
  if (showsError) throw new Error(`fetch shows failed: ${showsError.message}`);

  const shows = (allShows ?? []) as ShowRow[];
  const unreachable = shows.filter((s) => !s.podscan_id);
  const alreadyFilled = shows.filter(
    (s) => s.podscan_id && (s.current_sponsors?.length ?? 0) > 0
  );
  const queue = shows.filter(
    (s) => s.podscan_id && (s.current_sponsors?.length ?? 0) === 0
  );

  console.log(`Discoverable shows: ${shows.length}`);
  console.log(
    `  to enrich: ${queue.length} · already have sponsors (skipped): ${alreadyFilled.length} · unreachable (no podscan_id): ${unreachable.length}\n`
  );

  if (!process.env.PODSCAN_API_KEY) {
    console.log("PODSCAN_API_KEY not set — stopping (no fetches possible).");
    return;
  }
  const podscan = new PodscanClient();

  let fetched = 0;
  let withSponsors = 0;
  let zeroSponsors = 0;
  let noData = 0;
  let fetchErrors = 0;
  let latestErrors = 0;
  let latestCovered = 0;
  let totalDropped = 0;
  let wrote = 0;
  let wouldWrite = 0;
  let selfPromoFlagged = 0;

  for (const [i, show] of queue.entries()) {
    let analysisSponsors: PodscanSponsor[] = [];
    let latestSponsors: PodscanLatestSponsor[] = [];
    let episodesAnalyzed: number | undefined;
    let latestPostedAt: string | undefined;
    let gotAnalysis = false;
    try {
      await sleep(REQUEST_DELAY_MS);
      const analysis = await podscan.getPodcastAnalysis(show.podscan_id!);
      gotAnalysis = analysis !== null;
      episodesAnalyzed = analysis?.episodes_analyzed;
      analysisSponsors = analysis?.sponsors ?? [];

      // Recency snapshot — fail-soft per show: a non-429 failure here
      // degrades that show to frequency-only ranking, not a skip.
      try {
        await sleep(REQUEST_DELAY_MS);
        const latest = await podscan.getLatestEpisodeSponsors(show.podscan_id!);
        latestSponsors = latest?.sponsors ?? [];
        latestPostedAt = latest?.posted_at?.slice(0, 10);
      } catch (err) {
        if (err instanceof PodscanError && err.status === 429) throw err;
        latestErrors++;
        console.log(
          `  LATEST-EP ERROR (frequency-only for this show): "${show.name}": ${err instanceof Error ? err.message : err}`
        );
      }
      fetched++;
      if (!gotAnalysis && latestSponsors.length === 0) {
        noData++;
        console.log(`  no analysis (404): "${show.name}" (${show.podscan_id})`);
        continue;
      }
    } catch (err) {
      fetchErrors++;
      console.log(
        `  FETCH ERROR: "${show.name}" (${show.podscan_id}): ${err instanceof Error ? err.message : err}`
      );
      if (err instanceof PodscanError && err.status === 429) {
        console.log(
          `  Rate limit exhausted — ${queue.length - i - 1} show(s) left unfetched this run.`
        );
        break;
      }
      continue;
    }

    const ranked = rankSponsors(analysisSponsors, latestSponsors);
    if (ranked.stored.length === 0) {
      zeroSponsors++;
      console.log(
        `  no sponsors detected: "${show.name}" (${episodesAnalyzed ?? "?"} episodes analyzed)`
      );
      continue;
    }
    withSponsors++;
    if (ranked.stillRunning.size > 0) latestCovered++;
    totalDropped += ranked.droppedCount;

    // Per-show report: stored list with markers (report-only).
    const showTokens = nameTokens(show.name);
    const flagged = ranked.stored.filter((n) => looksLikeSelfPromo(n, showTokens));
    if (flagged.length > 0) selfPromoFlagged++;
    const latestNote = latestPostedAt ? `, latest sponsored ep ${latestPostedAt}` : "";
    console.log(
      `  "${show.name}" — ${ranked.totalDistinct} detected → storing ${ranked.stored.length}, dropping ${ranked.droppedCount} (${episodesAnalyzed ?? "?"} episodes analyzed${latestNote}):`
    );
    for (const name of ranked.stored) {
      const key = name.toLowerCase();
      const markers = [
        ranked.stillRunning.has(key) ? "[still-running]" : "",
        ranked.nonCommercial.has(key) ? "[NON-COMMERCIAL]" : "",
        flagged.includes(name) ? "[SELF-PROMO?]" : "",
      ]
        .filter(Boolean)
        .join(" ");
      console.log(`      ${name}${markers ? `  ${markers}` : ""}`);
    }
    const names = ranked.stored;

    if (APPLY) {
      const dataSources = show.data_sources ?? [];
      const updates: Record<string, unknown> = {
        current_sponsors: names,
        updated_at: new Date().toISOString(),
      };
      if (!dataSources.includes("podscan")) {
        updates.data_sources = [...dataSources, "podscan"];
      }
      const { error } = await supabase
        .from("shows")
        .update(updates)
        .eq("id", show.id);
      if (error) {
        console.log(`  WRITE ERROR: "${show.name}": ${error.message}`);
      } else {
        wrote++;
      }
    } else {
      wouldWrite++;
    }
  }

  if (unreachable.length > 0) {
    console.log(`\n--- Unreachable (no podscan_id — cannot enrich) ---`);
    for (const show of unreachable) {
      console.log(`  ${show.name} [${show.platform}]`);
    }
  }

  console.log(`\n=== Summary (${APPLY ? "APPLY" : "DRY RUN"}) ===`);
  console.log(`  shows fetched:           ${fetched} (no data: ${noData}, errors: ${fetchErrors}, latest-ep errors: ${latestErrors})`);
  console.log(`  shows with sponsors:     ${withSponsors} (with self-promo flags: ${selfPromoFlagged})`);
  console.log(`  with still-running head: ${latestCovered} (latest-ep snapshot available)`);
  console.log(`  names dropped by cap ${STORED_SPONSORS_CAP}:  ${totalDropped}`);
  console.log(`  shows with zero sponsors: ${zeroSponsors}`);
  console.log(
    APPLY
      ? `  rows written:            ${wrote}`
      : `  rows that would write:   ${wouldWrite}   (re-run with --apply)`
  );
  console.log(`  already filled (skipped): ${alreadyFilled.length}`);
  console.log(`  unreachable:             ${unreachable.length}\n`);
}

main().catch((err) => {
  console.error("Backfill failed:", err);
  process.exit(1);
});
