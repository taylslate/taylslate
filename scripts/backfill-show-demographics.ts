#!/usr/bin/env npx tsx
// ============================================================
// Backfill shows.podscan_id + shows.demographics (audience-fit live)
//
// Resolution policy (locked by Chris, Sep 8 2026): a podscan_id is WRITTEN
// only when it comes from a certain source —
//   (a) shows.podscan_id already set, or
//   (b) an exact outreaches.podscan_id join on show_id (single distinct id).
// Name-search matches are REPORT-ONLY: the script prints each proposed
// match (with rss/name verification status) for manual review and never
// writes one — even verified, a fuzzy match is a human decision because a
// wrong podscan_id silently poisons that show's demographics forever.
//
// Demographics are fetched for every id-resolved show whose demographics
// are empty, transformed via podscanDemographicsToShowDemographics (age
// buckets + gender only — audience_purchase_power stays on the category
// proxy; see PRODUCT_BACKLOG), and written fill-empty-only.
//
// Usage:
//   npx tsx scripts/backfill-show-demographics.ts           # DRY RUN: full report, no writes
//   npx tsx scripts/backfill-show-demographics.ts --apply   # write id-resolved rows
//
// Scope: platform='podcast', is_discoverable=true. Accept-materialized
// (otr-) and seeded rows are skipped + counted.
// ============================================================

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { resolve } from "path";
import {
  PodscanClient,
  PodscanError,
  type PodscanPodcast,
} from "../lib/enrichment/podscan";
import { podscanDemographicsToShowDemographics } from "../lib/discovery/format-discovered-show";
import { isVerifiedPodcastMatch } from "../lib/enrichment/podscan-match";
import type { ShowDemographics } from "../lib/data/types";

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

interface ShowRow {
  id: string;
  name: string;
  slug: string;
  platform: string;
  rss_url: string | null;
  podscan_id: string | null;
  demographics: Record<string, unknown> | null;
  is_discoverable: boolean | null;
}

const hasDemo = (d: Record<string, unknown> | null | undefined): boolean =>
  !!d && Object.keys(d).length > 0;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  console.log(
    `\n=== Backfill shows demographics (${APPLY ? "APPLY" : "DRY RUN"}) ===\n`
  );

  // ---- Load podcast shows ----
  const { data: allShows, error: showsError } = await supabase
    .from("shows")
    .select(
      "id, name, slug, platform, rss_url, podscan_id, demographics, is_discoverable"
    )
    .eq("platform", "podcast")
    .order("name", { ascending: true });
  if (showsError) throw new Error(`fetch shows failed: ${showsError.message}`);

  const rows = (allShows ?? []) as ShowRow[];
  const skippedNonCatalog = rows.filter((s) => s.is_discoverable === false);
  const shows = rows.filter((s) => s.is_discoverable !== false);

  console.log(`Podcast shows: ${rows.length}`);
  console.log(
    `  in scope: ${shows.length} · skipped non-catalog (otr-/seeded): ${skippedNonCatalog.length}`
  );
  const withDemoBefore = shows.filter((s) => hasDemo(s.demographics)).length;
  console.log(
    `  baseline: ${shows.filter((s) => s.podscan_id).length} with podscan_id, ${withDemoBefore} with demographics\n`
  );

  // ---- Resolve podscan_id: existing column, then exact outreach join ----
  const unresolvedIds = shows.filter((s) => !s.podscan_id).map((s) => s.id);
  const outreachIdByShow = new Map<string, Set<string>>();
  if (unresolvedIds.length > 0) {
    const { data: outreaches, error: outreachError } = await supabase
      .from("outreaches")
      .select("show_id, podscan_id")
      .in("show_id", unresolvedIds)
      .not("podscan_id", "is", null);
    if (outreachError) {
      throw new Error(`fetch outreaches failed: ${outreachError.message}`);
    }
    for (const o of outreaches ?? []) {
      if (!o.show_id || !o.podscan_id) continue;
      const set = outreachIdByShow.get(o.show_id) ?? new Set<string>();
      set.add(o.podscan_id);
      outreachIdByShow.set(o.show_id, set);
    }
  }

  type Resolved = { show: ShowRow; podscanId: string; source: "column" | "outreach" };
  const resolved: Resolved[] = [];
  const conflicts: Array<{ show: ShowRow; ids: string[] }> = [];
  const nameMatchQueue: ShowRow[] = [];

  for (const show of shows) {
    if (show.podscan_id) {
      resolved.push({ show, podscanId: show.podscan_id, source: "column" });
      continue;
    }
    const outreachIds = outreachIdByShow.get(show.id);
    if (outreachIds && outreachIds.size === 1) {
      resolved.push({
        show,
        podscanId: [...outreachIds][0],
        source: "outreach",
      });
    } else if (outreachIds && outreachIds.size > 1) {
      conflicts.push({ show, ids: [...outreachIds] });
    } else {
      nameMatchQueue.push(show);
    }
  }

  console.log(
    `Resolution: ${resolved.length} id-resolved (${resolved.filter((r) => r.source === "column").length} column, ${resolved.filter((r) => r.source === "outreach").length} outreach) · ${conflicts.length} outreach conflicts · ${nameMatchQueue.length} for name-match review\n`
  );
  for (const c of conflicts) {
    console.log(
      `  CONFLICT (skipped): "${c.show.name}" has ${c.ids.length} distinct outreach podscan_ids: ${c.ids.join(", ")}`
    );
  }

  // ---- Podscan client (needed for demographics + name-match report) ----
  if (!process.env.PODSCAN_API_KEY) {
    console.log(
      "\nPODSCAN_API_KEY not set — stopping after resolution report (no fetches possible)."
    );
    return;
  }
  const podscan = new PodscanClient();

  // ---- Fetch + write demographics for id-resolved shows ----
  let fetched = 0;
  let noData = 0;
  let wrote = 0;
  let wroteDemo = 0;
  let wouldWrite = 0;
  let fetchErrors = 0;

  for (const { show, podscanId, source } of resolved) {
    const needsId = !show.podscan_id;
    const needsDemo = !hasDemo(show.demographics);
    if (!needsId && !needsDemo) continue;

    let demographics: ShowDemographics | undefined;
    if (needsDemo) {
      try {
        await sleep(REQUEST_DELAY_MS);
        const payload = await podscan.getPodcastDemographics(podscanId);
        fetched++;
        if (payload) {
          const transformed = podscanDemographicsToShowDemographics(payload);
          if (hasDemo(transformed as Record<string, unknown>)) {
            demographics = transformed;
          } else {
            noData++;
            console.log(`  no usable sections: "${show.name}" (${podscanId})`);
          }
        } else {
          noData++;
          console.log(`  no demographics (404): "${show.name}" (${podscanId})`);
        }
      } catch (err) {
        fetchErrors++;
        console.log(
          `  FETCH ERROR: "${show.name}" (${podscanId}): ${err instanceof Error ? err.message : err}`
        );
        if (err instanceof PodscanError && err.status === 429) {
          console.log("  Rate limit exhausted — stopping fetches.");
          break;
        }
        continue;
      }
    }

    const updates: Record<string, unknown> = {};
    if (needsId) updates.podscan_id = podscanId;
    if (demographics) updates.demographics = demographics;
    if (Object.keys(updates).length === 0) continue;

    const summary = Object.keys(updates).join(" + ");
    if (APPLY) {
      updates.updated_at = new Date().toISOString();
      const { error } = await supabase
        .from("shows")
        .update(updates)
        .eq("id", show.id);
      if (error) {
        console.log(`  WRITE ERROR: "${show.name}": ${error.message}`);
      } else {
        wrote++;
        if (demographics) wroteDemo++;
        console.log(`  wrote ${summary}: "${show.name}" (${source})`);
      }
    } else {
      wouldWrite++;
      console.log(`  would write ${summary}: "${show.name}" (${source})`);
    }
  }

  // ---- Name-match report (REPORT ONLY — never written) ----
  if (nameMatchQueue.length > 0) {
    console.log(
      `\n--- Name-match candidates (report only; approve manually) ---`
    );
    for (const show of nameMatchQueue) {
      try {
        await sleep(REQUEST_DELAY_MS);
        const podcast: PodscanPodcast | null = await podscan.findPodcastByName(
          show.name
        );
        if (!podcast) {
          console.log(`  NO MATCH: "${show.name}"`);
          continue;
        }
        const verified = isVerifiedPodcastMatch(
          { name: show.name, rss_url: show.rss_url },
          podcast
        );
        console.log(
          `  ${verified ? "VERIFIED" : "unverified"}: "${show.name}" → ${podcast.podcast_id} "${podcast.podcast_name}"` +
            `\n      show rss: ${show.rss_url ?? "—"}\n      pod  rss: ${podcast.rss_url ?? podcast.rss_url_normalized ?? "—"}`
        );
      } catch (err) {
        console.log(
          `  SEARCH ERROR: "${show.name}": ${err instanceof Error ? err.message : err}`
        );
        if (err instanceof PodscanError && err.status === 429) {
          console.log("  Rate limit exhausted — stopping name-match report.");
          break;
        }
      }
    }
    console.log(
      `\nTo take a reviewed match manually:` +
        `\n  UPDATE public.shows SET podscan_id = '<pd_...>' WHERE id = '<show id>';` +
        `\nthen re-run this script — the id-resolved pass picks it up.`
    );
  }

  // ---- Summary ----
  console.log(`\n=== Summary (${APPLY ? "APPLY" : "DRY RUN"}) ===`);
  console.log(`  id-resolved shows:       ${resolved.length}`);
  console.log(`  demographics fetched:    ${fetched} (no data: ${noData}, errors: ${fetchErrors})`);
  console.log(
    APPLY
      ? `  rows written:            ${wrote}`
      : `  rows that would write:   ${wouldWrite}   (re-run with --apply)`
  );
  console.log(`  name-match review queue: ${nameMatchQueue.length}`);
  console.log(`  outreach conflicts:      ${conflicts.length}`);
  console.log(
    `  demographics coverage:   ${withDemoBefore}/${shows.length} before${APPLY ? ` → ${withDemoBefore + wroteDemo} after` : ""}\n`
  );
}

main().catch((err) => {
  console.error("Backfill failed:", err);
  process.exit(1);
});
