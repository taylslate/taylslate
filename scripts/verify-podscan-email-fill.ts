#!/usr/bin/env npx tsx
// ============================================================
// VERIFY: Podscan reach.email fill rate across a realistic discovery run
// Run: npx tsx scripts/verify-podscan-email-fill.ts
//
// RESULT (July 2026): 97.7% fill across 86 discovered shows; 95.8% on the
// 5k–25k tier, 100% at 25k+. Contact email is not a materially missing
// input at discovery for mainstream verticals.
//
// Calls the REAL production discovery path (discoverShows) against 2-3
// representative briefs, podcast-only, and measures what fraction of
// discovered shows come back with a usable contact email.
//
// contact.email on a discovered show == extractEmail(podcast.reach)
//   == reach?.email ?? ""   (lib/discovery/format-discovered-show.ts:70-72,98)
// so "non-empty contact.email" is exactly "non-empty Podscan reach.email".
//
// Read-only: hits Podscan API, writes nothing.
// ============================================================

import { readFileSync } from "fs";
import { resolve } from "path";

// ---- Load .env.local into process.env (same pattern as seed-from-podscan.ts) ----
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

if (!process.env.PODSCAN_API_KEY) {
  console.error("Missing PODSCAN_API_KEY in .env.local");
  process.exit(1);
}

import { discoverShows, type DiscoveryBrief } from "../lib/discovery/discover-shows";
import type { Show } from "../lib/data/types";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---- 2-3 representative mid-market briefs across the biggest podcast verticals ----
const BRIEFS: { label: string; brief: DiscoveryBrief }[] = [
  {
    label: "Health / Wellness DTC",
    brief: {
      target_interests: ["health", "fitness", "nutrition", "wellness"],
      keywords: ["supplements", "workout", "healthy eating", "longevity"],
      target_age_range: "25-44",
      target_gender: "all",
      campaign_goals: "Drive trial of a DTC supplement",
      platforms: ["podcast"],
    },
  },
  {
    label: "Business / Finance / Tech",
    brief: {
      target_interests: ["business", "entrepreneurship", "finance", "technology"],
      keywords: ["startups", "investing", "productivity", "marketing"],
      target_age_range: "25-54",
      target_gender: "all",
      campaign_goals: "B2B SaaS awareness",
      platforms: ["podcast"],
    },
  },
  {
    label: "True Crime / Entertainment",
    brief: {
      target_interests: ["true crime", "comedy", "entertainment", "pop culture"],
      keywords: ["storytelling", "interviews", "culture", "humor"],
      target_age_range: "18-44",
      target_gender: "all",
      campaign_goals: "Broad consumer DTC launch",
      platforms: ["podcast"],
    },
  },
];

function hasEmail(s: Show): boolean {
  return (s.contact?.email ?? "").trim() !== "";
}
function looksLikeEmail(s: Show): boolean {
  const e = (s.contact?.email ?? "").trim();
  return e.includes("@") && e.includes(".");
}
function pct(n: number, d: number): string {
  return d === 0 ? "n/a" : `${((100 * n) / d).toFixed(1)}%`;
}

function sizeTier(a: number): string {
  if (a <= 0) return "0 / unknown";
  if (a < 25_000) return "5k–25k";
  if (a < 100_000) return "25k–100k";
  return "100k+";
}
const TIER_ORDER = ["0 / unknown", "5k–25k", "25k–100k", "100k+"];

async function main() {
  console.log("=".repeat(64));
  console.log("PODSCAN reach.email FILL-RATE VERIFICATION");
  console.log("Path: production discoverShows() · podcast-only · read-only");
  console.log("=".repeat(64));

  const perBrief: { label: string; shows: Show[]; errors: string[] }[] = [];

  for (let i = 0; i < BRIEFS.length; i++) {
    const { label, brief } = BRIEFS[i];
    console.log(`\n--- Brief ${i + 1}/${BRIEFS.length}: ${label} ---`);
    const res = await discoverShows(brief);
    const podcastShows = res.discovered.filter((s) => s.platform === "podcast");
    perBrief.push({ label, shows: podcastShows, errors: res.errors });
    const withEmail = podcastShows.filter(hasEmail).length;
    console.log(
      `  → ${podcastShows.length} podcast shows | ${withEmail} with email (${pct(
        withEmail,
        podcastShows.length
      )}) | podscan errors: ${res.errors.length}`
    );
    if (res.errors.length) res.errors.forEach((e) => console.log(`     ! ${e}`));
    if (i < BRIEFS.length - 1) await sleep(20_000); // respect ~10 req/min limit
  }

  // ---- Per-brief table ----
  console.log("\n" + "=".repeat(64));
  console.log("PER-BRIEF FILL RATE");
  console.log("=".repeat(64));
  for (const b of perBrief) {
    const n = b.shows.length;
    const e = b.shows.filter(hasEmail).length;
    console.log(`  ${b.label.padEnd(30)} ${String(e).padStart(3)}/${String(n).padStart(3)}  ${pct(e, n)}`);
  }

  // ---- Deduped universe (a show can surface under multiple briefs) ----
  const uni = new Map<string, Show>();
  for (const b of perBrief) for (const s of b.shows) if (!uni.has(s.id)) uni.set(s.id, s);
  const all = [...uni.values()];
  const N = all.length;
  const E = all.filter(hasEmail).length;
  const Evalid = all.filter(looksLikeEmail).length;

  console.log("\n" + "=".repeat(64));
  console.log("AGGREGATE (deduped across all briefs)");
  console.log("=".repeat(64));
  console.log(`  Sample size (unique discovered podcast shows): ${N}`);
  console.log(`  Non-empty reach.email:                         ${E}  (${pct(E, N)})`);
  console.log(`  ...that look like a real email (has @ + .):     ${Evalid}  (${pct(Evalid, N)})`);

  // ---- Cut: shows WITH audience data vs without (proxy for full reach object) ----
  const withAud = all.filter((s) => (s.audience_size ?? 0) > 0);
  const noAud = all.filter((s) => (s.audience_size ?? 0) <= 0);
  console.log("\n  By presence of Podscan reach/audience data:");
  console.log(
    `    has audience_size>0:  ${withAud.filter(hasEmail).length}/${withAud.length}  ${pct(
      withAud.filter(hasEmail).length,
      withAud.length
    )}`
  );
  console.log(
    `    audience_size 0/unk:  ${noAud.filter(hasEmail).length}/${noAud.length}  ${pct(
      noAud.filter(hasEmail).length,
      noAud.length
    )}`
  );

  // ---- By size tier ----
  console.log("\n  By audience-size tier:");
  const byTier = new Map<string, Show[]>();
  for (const s of all) {
    const t = sizeTier(s.audience_size ?? 0);
    if (!byTier.has(t)) byTier.set(t, []);
    byTier.get(t)!.push(s);
  }
  for (const t of TIER_ORDER) {
    const arr = byTier.get(t) ?? [];
    if (arr.length === 0) continue;
    const e = arr.filter(hasEmail).length;
    console.log(`    ${t.padEnd(14)} ${String(e).padStart(3)}/${String(arr.length).padStart(3)}  ${pct(e, arr.length)}`);
  }

  // ---- By category (a show may appear in multiple; only categories with >=5 shows) ----
  console.log("\n  By category (categories with >=5 discovered shows):");
  const byCat = new Map<string, { n: number; e: number }>();
  for (const s of all) {
    for (const c of s.categories ?? []) {
      const rec = byCat.get(c) ?? { n: 0, e: 0 };
      rec.n += 1;
      if (hasEmail(s)) rec.e += 1;
      byCat.set(c, rec);
    }
  }
  const cats = [...byCat.entries()].filter(([, v]) => v.n >= 5).sort((a, b) => b[1].n - a[1].n);
  if (cats.length === 0) {
    console.log("    (no category has >=5 shows — sample too small for category breakout)");
  } else {
    for (const [c, v] of cats.slice(0, 15)) {
      console.log(`    ${c.slice(0, 26).padEnd(26)} ${String(v.e).padStart(3)}/${String(v.n).padStart(3)}  ${pct(v.e, v.n)}`);
    }
  }

  console.log("\n" + "=".repeat(64));
  console.log(`HEADLINE: ${E}/${N} discovered shows have a non-empty Podscan email = ${pct(E, N)}`);
  console.log("=".repeat(64));
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
