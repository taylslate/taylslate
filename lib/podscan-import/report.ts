// Dry-run report. Counts, ids, and domains only.

import type { CappedSlice } from "./candidates";
import { SEARCH_QUERY } from "./candidates";

export interface Coverage {
  podscanOnly: number;
  appleOnly: number;
  both: number;
  neither: number;
}

export interface FloorPlan {
  calls: number;
  days: number;
}

export interface ImportReport {
  generatedAt: string;
  sample: number | null;
  language: string;
  region: string | null;
  activeDays: number;
  candidates: { sponsored: number; unsponsored: number };
  sponsoredLast12m: number;
  hasSponsorsProbeNull: number;
  kept: { 1000: number; 2500: number; 5000: number };
  keptFloorSponsored: { 1000: number; 2500: number; 5000: number };
  floorConfirm: { floor: number; kept: number; keptFloorSponsored: number } | null;
  podscanCallsForFlags: number;
  backfillScoring: boolean;
  backfillCalls: number;
  backfillCallsMax: number;
  backfillDays: number;
  backfillDaysMax: number;
  probeFloor: number | null;
  emailCoverage: { 1000: Coverage; 2500: Coverage; 5000: Coverage };
  syntax: { pass: number; fail: number };
  syntaxFailureReasons: Record<string, number>;
  keptNoAudience: { 1000: number; 2500: number; 5000: number };
  mx: { pass: number; fail: number; unknown: number };
  topDomains: Array<{ domain: string; count: number }>;
  feedsSkipped: Record<string, number>;
  demographics: "PASS" | "FAIL";
  listenerData: "PASS" | "FAIL";
  sponsorProbe: "PASS" | "FAIL";
  sponsorProbeChecked: number;
  sponsorProbeMismatches: string[];
  rateLimit: {
    limit: number | null;
    remaining: number | null;
    lastLimit: number | null;
    lastRemaining: number | null;
  };
  podscanCalls: number;
  maxPodscanCalls: number;
  writeRun: { 1000: FloorPlan; 2500: FloorPlan; 5000: FloorPlan };
  cappedSlices: CappedSlice[];
  alreadyInShows: { 1000: number | null; 2500: number | null; 5000: number | null };
  query: string;
}

export function daysAtBudget(calls: number, budget: number): number {
  if (calls <= 0) return 0;
  if (budget <= 0) return calls;
  return Math.ceil(calls / budget);
}

export function proofLine(nonNull: number): "PASS" | "FAIL" {
  return nonNull >= 4 ? "PASS" : "FAIL";
}

export function topDomains(domains: readonly string[], limit = 15): Array<{ domain: string; count: number }> {
  const counts = new Map<string, number>();
  for (const domain of domains) {
    if (!domain || domain.includes("@")) continue;
    counts.set(domain, (counts.get(domain) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([domain, count]) => ({ domain, count }));
}

export function syntaxReasonLines(reasons: Record<string, number>): string[] {
  const rows = Object.entries(reasons).filter(
    ([reason, count]) => count > 0 && !reason.includes("@") && !/\s/.test(reason)
  );
  rows.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  if (rows.length === 0) return ["Syntax failure reasons: none"];
  return ["Syntax failure reasons:", ...rows.map(([reason, count]) => `- ${reason} ${count}`)];
}

export function emptyCoverage(): Coverage {
  return { podscanOnly: 0, appleOnly: 0, both: 0, neither: 0 };
}

export function addCoverage(coverage: Coverage, podscan: boolean, apple: boolean): void {
  if (podscan && apple) coverage.both += 1;
  else if (podscan) coverage.podscanOnly += 1;
  else if (apple) coverage.appleOnly += 1;
  else coverage.neither += 1;
}

export function renderReport(report: ImportReport): { json: string; markdown: string } {
  const json = JSON.stringify(report, null, 2);
  const lines = [
    "# Podscan import dry run",
    "",
    `Generated: ${report.generatedAt}`,
    `Sample: ${report.sample ?? "full"}`,
    ...(report.sample != null
      ? ["This sample is not the catalog. Do not treat these counts as the full import."]
      : []),
    "Write-run days assume a fresh checkpoint and the daily call budget.",
    `Language: ${report.language}`,
    `Region: ${report.region ?? "none"}`,
    `Active days: ${report.activeDays}`,
    `Query: ${report.query || SEARCH_QUERY}`,
    "",
    `Candidates sponsored pass: ${report.candidates.sponsored}`,
    `Candidates unsponsored pass: ${report.candidates.unsponsored}`,
    `Sponsored in the last 12 months: ${report.sponsoredLast12m}`,
    `Has sponsors flag but probe is null: ${report.hasSponsorsProbeNull}`,
    `Kept at 1000: ${report.kept[1000]}`,
    `Kept at 2500: ${report.kept[2500]}`,
    `Kept at 5000: ${report.kept[5000]}`,
    `Kept at 1000 with --floor-sponsored: ${report.keptFloorSponsored[1000]}`,
    `Kept at 2500 with --floor-sponsored: ${report.keptFloorSponsored[2500]}`,
    `Kept at 5000 with --floor-sponsored: ${report.keptFloorSponsored[5000]}`,
    ...(report.floorConfirm
      ? [
          `Kept for --floor ${report.floorConfirm.floor}: ${report.floorConfirm.kept}`,
          `Kept for --floor ${report.floorConfirm.floor} with --floor-sponsored: ${report.floorConfirm.keptFloorSponsored}`,
        ]
      : []),
    `Podscan calls for these flags: ${report.podscanCallsForFlags}`,
    ...(report.backfillScoring
      ? [
          `Backfill scoring calls: ${report.backfillCalls} to ${report.backfillCallsMax}`,
          `Backfill scoring days: ${report.backfillDays} to ${report.backfillDaysMax}`,
        ]
      : ["Backfill scoring: off"]),
    ...(report.probeFloor != null
      ? [`Sponsor probe skipped shows under ${report.probeFloor} because --floor-sponsored is on.`]
      : []),
    `Kept with no audience at 1000: ${report.keptNoAudience[1000]}`,
    `Kept with no audience at 2500: ${report.keptNoAudience[2500]}`,
    `Kept with no audience at 5000: ${report.keptNoAudience[5000]}`,
    "",
    coverageBlock(1000, report.emailCoverage[1000]),
    coverageBlock(2500, report.emailCoverage[2500]),
    coverageBlock(5000, report.emailCoverage[5000]),
    "",
    `Syntax pass: ${report.syntax.pass}`,
    `Syntax fail: ${report.syntax.fail}`,
    ...syntaxReasonLines(report.syntaxFailureReasons),
    `MX pass: ${report.mx.pass}`,
    `MX fail: ${report.mx.fail}`,
    `MX unknown: ${report.mx.unknown}`,
    "",
    "Top domains:",
    ...report.topDomains.map((row) => `- ${row.domain} ${row.count}`),
    "",
    "Feeds skipped:",
    ...Object.entries(report.feedsSkipped).map(([reason, count]) => `- ${reason} ${count}`),
    "",
    `DEMOGRAPHICS: ${report.demographics}`,
    `LISTENER DATA: ${report.listenerData}`,
    `SPONSOR PROBE: ${report.sponsorProbe}`,
    `Sponsor probe checked: ${report.sponsorProbeChecked}`,
    `Sponsor probe mismatches: ${report.sponsorProbeMismatches.join(", ") || "none"}`,
    "",
    `Rate limit first limit: ${showNum(report.rateLimit.limit)}`,
    `Rate limit first remaining: ${showNum(report.rateLimit.remaining)}`,
    `Rate limit last limit: ${showNum(report.rateLimit.lastLimit)}`,
    `Rate limit last remaining: ${showNum(report.rateLimit.lastRemaining)}`,
    `Podscan calls used: ${report.podscanCalls}`,
    `Daily budget: ${report.maxPodscanCalls}`,
    "",
    floorPlan(1000, report.writeRun[1000]),
    floorPlan(2500, report.writeRun[2500]),
    floorPlan(5000, report.writeRun[5000]),
    "",
    `Capped slices: ${report.cappedSlices.length}`,
    ...report.cappedSlices.map(
      (slice) =>
        `- ${slice.pass} min=${showNum(slice.minAudience)} max=${showNum(slice.maxAudience)} category=${slice.categoryId ?? "none"} total=${slice.total} sampled=${slice.sampled}`
    ),
    "",
    `Already in shows at 1000: ${showNum(report.alreadyInShows[1000])}`,
    `Already in shows at 2500: ${showNum(report.alreadyInShows[2500])}`,
    `Already in shows at 5000: ${showNum(report.alreadyInShows[5000])}`,
    "",
  ];
  return { json, markdown: lines.join("\n") };
}

function coverageBlock(floor: number, coverage: Coverage): string {
  return `Email at ${floor}: podscan only ${coverage.podscanOnly}, apple only ${coverage.appleOnly}, both ${coverage.both}, neither ${coverage.neither}`;
}

function floorPlan(floor: number, plan: FloorPlan): string {
  return `Write run at ${floor}: calls ${plan.calls}, days ${plan.days}`;
}

function showNum(value: number | null): string {
  return value == null ? "none" : String(value);
}

export function printReport(report: ImportReport, markdown: string): void {
  console.log(markdown);
  console.log(`DEMOGRAPHICS: ${report.demographics}`);
  console.log(`LISTENER DATA: ${report.listenerData}`);
  console.log(`SPONSOR PROBE: ${report.sponsorProbe}`);
}
