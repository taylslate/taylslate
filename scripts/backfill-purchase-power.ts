#!/usr/bin/env npx tsx
// ============================================================
// Backfill shows.audience_purchase_power (Wave 14 Phase 2B — Layer 1)
//
// Populates the purchase-power category proxy over existing shows. The
// scoring/decision logic lives in lib/scoring/purchase-power.ts
// (planPurchasePowerBackfill); this runner just reads rows, prints the
// plan, and — only with --apply — writes the updates.
//
// Usage:
//   npx tsx scripts/backfill-purchase-power.ts              # DRY RUN (default): plan + histogram, no writes
//   npx tsx scripts/backfill-purchase-power.ts --apply      # write NULL rows only (non-clobber)
//   npx tsx scripts/backfill-purchase-power.ts --apply --recompute   # overwrite ALL rows (escape hatch)
//
// Default is null-only and override-safe; --recompute overwrites existing
// values and must be combined with --apply to actually write.
// ============================================================

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { resolve } from "path";
import {
  planPurchasePowerBackfill,
  type ShowBackfillRow,
} from "../lib/scoring/purchase-power";

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
const RECOMPUTE = process.argv.includes("--recompute");
const PAGE_SIZE = 1000;
const WRITE_CHUNK = 50;

async function fetchAllShows(): Promise<ShowBackfillRow[]> {
  const rows: ShowBackfillRow[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from("shows")
      .select("id, categories, audience_purchase_power")
      .order("id", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(`fetch shows failed: ${error.message}`);
    if (!data || data.length === 0) break;
    rows.push(...(data as ShowBackfillRow[]));
    if (data.length < PAGE_SIZE) break;
  }
  return rows;
}

function histogram(scores: number[]): Record<string, number> {
  const h: Record<string, number> = {};
  for (const s of scores) {
    const key = `${s}`;
    h[key] = (h[key] ?? 0) + 1;
  }
  return h;
}

async function main() {
  console.log(
    `\nBackfill purchase-power  [mode: ${APPLY ? "APPLY" : "DRY RUN"}${
      RECOMPUTE ? " + RECOMPUTE" : ""
    }]\n`
  );

  const rows = await fetchAllShows();
  const nullCount = rows.filter(
    (r) => r.audience_purchase_power === null || r.audience_purchase_power === undefined
  ).length;
  console.log(`Read ${rows.length} shows (${nullCount} with NULL purchase power).`);

  const updates = planPurchasePowerBackfill(rows, { recompute: RECOMPUTE });
  console.log(`Planned writes: ${updates.length}`);
  console.log("Resulting-score distribution:", histogram(updates.map((u) => u.audience_purchase_power)));

  if (updates.length === 0) {
    console.log("\nNothing to write. Done.");
    return;
  }

  if (!APPLY) {
    console.log("\nDRY RUN — no writes performed. Re-run with --apply to write.");
    // Show a small sample so the histogram is easy to sanity-check.
    console.log("Sample:", updates.slice(0, 10));
    return;
  }

  console.log(`\nWriting ${updates.length} updates in chunks of ${WRITE_CHUNK}...`);
  let written = 0;
  let failed = 0;
  for (let i = 0; i < updates.length; i += WRITE_CHUNK) {
    const chunk = updates.slice(i, i + WRITE_CHUNK);
    const results = await Promise.all(
      chunk.map((u) =>
        supabase
          .from("shows")
          .update({ audience_purchase_power: u.audience_purchase_power })
          .eq("id", u.id)
      )
    );
    for (const r of results) {
      if (r.error) {
        failed++;
        console.error(`  ✗ update failed: ${r.error.message}`);
      } else {
        written++;
      }
    }
  }
  console.log(`\n✅ Done. ${written} written, ${failed} failed.`);
}

main().catch((err) => {
  console.error("Backfill failed:", err);
  process.exit(1);
});
