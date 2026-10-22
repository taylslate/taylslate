// Pure learning review. No I/O.
//
// Answers six questions from deals that actually aired, aircheck
// decisions, brand-reported conversion counts, promo/UTM fields, the
// scale tier, and brand/rep notes.
//
// A missing count stays "not enough data". Zero is a report. Notes guide
// and never erase a measured row or a show.

import { applyPostAirLift } from "@/lib/scoring/post-air-lift";
import { styleLabel } from "./styles";

export const NOT_ENOUGH_DATA = "not enough data";

export type OverrideStance =
  | "renew"
  | "test_next"
  | "overweight"
  | "avoid"
  | "note";

export type OverrideTargetKind = "show" | "ring" | "style";
export type OverrideAuthorRole = "brand" | "rep";

export interface LearningSection<T> {
  items: T[];
  /** Set when the section cannot be answered from the rows we have. */
  missing: typeof NOT_ENOUGH_DATA | null;
  /** A measured empty result. Not a stand-in for a missing count. */
  measuredEmpty: string | null;
  /** Extra gap that sits beside a real answer. */
  caveat: string | null;
}

export interface RingFinding {
  ringId: string;
  label: string;
  reportedConversions: number;
  showCount: number;
}

export interface RenewShow {
  showId: string;
  showName: string;
  reportedConversions: number | null;
  partial: boolean;
  composite: number | null;
  adjusted: number | null;
  reasoningLine: string | null;
  overrideNote: string | null;
}

export interface StyleFinding {
  key: string;
  label: string;
  dimension: "reader" | "placement";
  reportedConversions: number | null;
  partial: boolean;
  dealCount: number;
}

export interface ScaleNextShow {
  showId: string;
  showName: string;
  ringLabel: string | null;
  composite: number | null;
  sameRingAsWinner: boolean;
  overrideNote: string | null;
}

export interface WrongAssumption {
  ringId: string;
  label: string;
  reportedConversions: number;
  showCount: number;
}

export interface WeightCall {
  direction: "overweight" | "avoid";
  label: string;
  reason: string;
  source: "measured" | "override";
}

export interface DealLearningRow {
  dealId: string;
  showId: string;
  showName: string;
  status: string;
  inFlight: boolean;
  promoCode: string | null;
  trackingLink: string | null;
  /** Null when no aircheck judged the code or URL. */
  codeOnAir: "found" | "missing" | null;
  aircheckDecision: "confirmed" | "rejected" | null;
  reportedConversions: number | null;
  readerLabel: string | null;
  placementLabel: string | null;
  ringLabel: string | null;
}

export interface LearningOverrideView {
  id: string;
  authorRole: OverrideAuthorRole;
  targetKind: OverrideTargetKind;
  targetKey: string;
  targetLabel: string;
  stance: OverrideStance;
  note: string;
}

export interface LearningDeal {
  dealId: string;
  showId: string;
  showName: string;
  status: string;
  promoCode: string | null;
  trackingLink: string | null;
  ringId: string | null;
  ringLabel: string | null;
  composite: number | null;
  readerTypes: string[];
  placements: string[];
  aired: boolean;
  codeOnAir: "found" | "missing" | null;
  aircheckDecision: "confirmed" | "rejected" | null;
  reportedConversions: number | null;
}

export interface LearningRing {
  id: string;
  label: string;
  /** Brand kept this ring (confirmed or added). */
  kept: boolean;
}

export interface LearningScaleCandidate {
  showId: string;
  showName: string;
  ringId: string | null;
  ringLabel: string | null;
  composite: number | null;
}

export interface LearningOverrideInput {
  id: string;
  authorRole: OverrideAuthorRole;
  targetKind: OverrideTargetKind;
  targetKey: string;
  stance: OverrideStance;
  note: string;
}

/** Confirmed import rows for this brand. Prior history, not a verified flight. */
export interface ImportedHistoryInput {
  showId: string;
  showName: string;
  records: number;
  conversions: number | null;
  spend: number | null;
  downloads: number | null;
  source: "imported";
}

export interface ImportedHistoryItem {
  showId: string;
  showName: string;
  records: number;
  conversions: number | null;
  spend: number | null;
  downloads: number | null;
  source: "imported";
  label: "From your past campaigns";
}

export interface LearningReviewInput {
  campaignStatus: string;
  deals: LearningDeal[];
  rings: LearningRing[];
  scaleShows: LearningScaleCandidate[];
  overrides: LearningOverrideInput[];
  showNames: Record<string, string>;
  /** Absent or empty means this brand has no confirmed imports. */
  imported?: ImportedHistoryInput[];
}

export interface LearningReview {
  ready: boolean;
  bestRing: LearningSection<RingFinding>;
  renew: LearningSection<RenewShow>;
  styles: LearningSection<StyleFinding>;
  scaleNext: LearningSection<ScaleNextShow>;
  wrongAssumptions: LearningSection<WrongAssumption>;
  weight: LearningSection<WeightCall>;
  deals: DealLearningRow[];
  overrides: LearningOverrideView[];
  /** This brand's confirmed imports. Not merged into reported conversions. */
  importedHistory: ImportedHistoryItem[];
}

interface RingBucket {
  ringId: string;
  label: string;
  reported: number[];
  missingReports: number;
  showIds: Set<string>;
}

interface ShowBucket {
  showId: string;
  showName: string;
  reported: number[];
  missingReports: number;
  composite: number | null;
  outcomeDeals: number;
}

export function buildLearningReview(input: LearningReviewInput): LearningReview {
  const overrides = input.overrides.map((override) =>
    presentOverride(override, input)
  );
  const importedHistory = presentImported(input);
  const ready = isReady(input);
  if (!ready) {
    return {
      ready: false,
      bestRing: missing(),
      renew: missing(),
      styles: missing(),
      scaleNext: missing(),
      wrongAssumptions: missing(),
      weight: missing(),
      deals: [],
      overrides,
      importedHistory,
    };
  }

  const active = input.deals.filter((deal) => deal.status !== "cancelled");
  // Aired (confirmed aircheck, verified line, or a completed deal) or a
  // brand-reported count. A missing count on a deal that has not aired
  // stays out of the math.
  const outcome = active.filter(
    (deal) => deal.aired || deal.reportedConversions != null
  );
  const ringBuckets = bucketRings(outcome);
  const best = bestRingSection(ringBuckets);
  const winnerIds = new Set(best.items.map((item) => item.ringId));
  const shows = bucketShows(outcome);
  const renew = renewSection(shows, overrides);
  const styles = styleSection(outcome);
  const scaleNext = scaleSection(input, outcome, winnerIds, overrides);
  const wrong = wrongSection(input.rings, ringBuckets);
  const weight = weightSection(best, renew, styles, wrong, overrides);

  return {
    ready: true,
    bestRing: best,
    renew,
    styles,
    scaleNext,
    wrongAssumptions: wrong,
    weight,
    deals: active.map(presentDeal),
    overrides,
    importedHistory,
  };
}

export function isReady(input: Pick<LearningReviewInput, "campaignStatus" | "deals">): boolean {
  if (input.campaignStatus === "completed" || input.campaignStatus === "archived") {
    return true;
  }
  return input.deals.some(
    (deal) =>
      deal.status !== "cancelled" &&
      (deal.status === "completed" || deal.aired || deal.reportedConversions != null)
  );
}

function missing<T>(): LearningSection<T> {
  return { items: [], missing: NOT_ENOUGH_DATA, measuredEmpty: null, caveat: null };
}

function answered<T>(items: T[], caveat: string | null = null): LearningSection<T> {
  return { items, missing: null, measuredEmpty: null, caveat };
}

function measuredEmpty<T>(message: string): LearningSection<T> {
  return { items: [], missing: null, measuredEmpty: message, caveat: null };
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function bucketRings(outcome: LearningDeal[]): Map<string, RingBucket> {
  const buckets = new Map<string, RingBucket>();
  for (const deal of outcome) {
    if (!deal.ringId) continue;
    const bucket = buckets.get(deal.ringId) ?? {
      ringId: deal.ringId,
      label: deal.ringLabel ?? "Ring",
      reported: [],
      missingReports: 0,
      showIds: new Set<string>(),
    };
    bucket.showIds.add(deal.showId);
    if (deal.reportedConversions == null) bucket.missingReports += 1;
    else bucket.reported.push(deal.reportedConversions);
    buckets.set(deal.ringId, bucket);
  }
  return buckets;
}

function bestRingSection(buckets: Map<string, RingBucket>): LearningSection<RingFinding> {
  const all = [...buckets.values()];
  if (all.length === 0) return missing();

  const complete = all.filter(
    (bucket) => bucket.missingReports === 0 && bucket.reported.length > 0
  );
  const incomplete = all.filter((bucket) => bucket.missingReports > 0);
  const caveat =
    incomplete.length > 0
      ? "Rings still missing a conversion report: not enough data."
      : null;

  if (complete.length === 0) return missing();

  const totals = complete.map((bucket) => ({ bucket, total: sum(bucket.reported) }));
  const max = Math.max(...totals.map((row) => row.total));
  if (max <= 0) {
    return {
      items: [],
      missing: null,
      measuredEmpty: "Every ring with a full report converted 0 times.",
      caveat,
    };
  }

  const winners = totals.filter((row) => row.total === max);
  return answered(
    winners.map((row) => ({
      ringId: row.bucket.ringId,
      label: row.bucket.label,
      reportedConversions: row.total,
      showCount: row.bucket.showIds.size,
    })),
    caveat
  );
}

function bucketShows(outcome: LearningDeal[]): Map<string, ShowBucket> {
  const buckets = new Map<string, ShowBucket>();
  for (const deal of outcome) {
    const bucket = buckets.get(deal.showId) ?? {
      showId: deal.showId,
      showName: deal.showName,
      reported: [],
      missingReports: 0,
      composite: null,
      outcomeDeals: 0,
    };
    bucket.outcomeDeals += 1;
    if (deal.reportedConversions == null) bucket.missingReports += 1;
    else bucket.reported.push(deal.reportedConversions);
    if (deal.composite != null) {
      bucket.composite =
        bucket.composite == null
          ? deal.composite
          : Math.max(bucket.composite, deal.composite);
    }
    buckets.set(deal.showId, bucket);
  }
  return buckets;
}

function renewSection(
  shows: Map<string, ShowBucket>,
  overrides: LearningOverrideView[]
): LearningSection<RenewShow> {
  const notes = new Map<string, { note: string; label: string }>();
  for (const override of overrides) {
    if (override.stance === "renew" && override.targetKind === "show") {
      notes.set(override.targetKey, { note: override.note, label: override.targetLabel });
    }
  }

  const items: RenewShow[] = [];
  const seen = new Set<string>();
  for (const bucket of shows.values()) {
    const total = sum(bucket.reported);
    if (total <= 0 && !notes.has(bucket.showId)) continue;
    seen.add(bucket.showId);
    items.push(renewRow(bucket, notes.get(bucket.showId)?.note ?? null, total));
  }

  for (const [showId, note] of notes) {
    if (seen.has(showId)) continue;
    const bucket = shows.get(showId);
    items.push(
      renewRow(
        bucket ?? {
          showId,
          showName: note.label,
          reported: [],
          missingReports: 0,
          composite: null,
          outcomeDeals: 0,
        },
        note.note,
        bucket ? sum(bucket.reported) : 0
      )
    );
  }

  if (items.length > 0) return answered(items);

  const anyReport = [...shows.values()].some((bucket) => bucket.reported.length > 0);
  if (anyReport) return measuredEmpty("No show has reported conversions.");
  return missing();
}

function renewRow(bucket: ShowBucket, note: string | null, total: number): RenewShow {
  const partial = bucket.missingReports > 0 && bucket.reported.length > 0;
  const reported =
    bucket.reported.length === 0 ? null : total;
  const lift = applyPostAirLift(
    bucket.composite,
    reported != null && reported > 0 ? reported : null
  );
  return {
    showId: bucket.showId,
    showName: bucket.showName,
    reportedConversions: reported,
    partial,
    composite: bucket.composite,
    adjusted: lift.adjusted,
    reasoningLine: lift.reasoningLine,
    overrideNote: note,
  };
}

function styleSection(outcome: LearningDeal[]): LearningSection<StyleFinding> {
  const readers = styleFindings(outcome, "reader", (deal) => single(deal.readerTypes));
  const placements = styleFindings(
    outcome,
    "placement",
    (deal) => single(deal.placements)
  );
  const items = [...readers, ...placements];
  if (items.length === 0) return missing();
  if (items.every((item) => item.reportedConversions == null)) return missing();
  return answered(items);
}

function styleFindings(
  outcome: LearningDeal[],
  dimension: "reader" | "placement",
  pick: (deal: LearningDeal) => string | null
): StyleFinding[] {
  const groups = new Map<string, { reported: number[]; missing: number }>();
  for (const deal of outcome) {
    const key = pick(deal);
    if (!key) continue;
    const group = groups.get(key) ?? { reported: [], missing: 0 };
    if (deal.reportedConversions == null) group.missing += 1;
    else group.reported.push(deal.reportedConversions);
    groups.set(key, group);
  }

  return [...groups.entries()].map(([key, group]) => {
    const dealCount = group.reported.length + group.missing;
    const partial = group.missing > 0 && group.reported.length > 0;
    const reportedConversions =
      group.reported.length === 0 ? null : sum(group.reported);
    return {
      key,
      label: styleLabel(key),
      dimension,
      reportedConversions,
      partial,
      dealCount,
    };
  });
}

function single(values: string[]): string | null {
  const unique = [...new Set(values)];
  return unique.length === 1 ? unique[0] : null;
}

function scaleSection(
  input: LearningReviewInput,
  outcome: LearningDeal[],
  winnerIds: Set<string>,
  overrides: LearningOverrideView[]
): LearningSection<ScaleNextShow> {
  const aired = new Set(outcome.map((deal) => deal.showId));
  const notes = new Map<string, string>();
  for (const override of overrides) {
    if (override.stance === "test_next" && override.targetKind === "show") {
      notes.set(override.targetKey, override.note);
    }
  }

  const items: ScaleNextShow[] = input.scaleShows
    .filter((show) => !aired.has(show.showId))
    .map((show) => ({
      showId: show.showId,
      showName: show.showName,
      ringLabel: show.ringLabel,
      composite: show.composite,
      sameRingAsWinner: show.ringId != null && winnerIds.has(show.ringId),
      overrideNote: notes.get(show.showId) ?? null,
    }));

  const listed = new Set(items.map((item) => item.showId));
  for (const [showId, note] of notes) {
    if (listed.has(showId) || aired.has(showId)) continue;
    const known = input.scaleShows.find((show) => show.showId === showId);
    items.push({
      showId,
      showName: input.showNames[showId] ?? known?.showName ?? "Show",
      ringLabel: known?.ringLabel ?? null,
      composite: known?.composite ?? null,
      sameRingAsWinner: known?.ringId != null && winnerIds.has(known.ringId),
      overrideNote: note,
    });
  }

  items.sort((a, b) => {
    if (a.sameRingAsWinner !== b.sameRingAsWinner) return a.sameRingAsWinner ? -1 : 1;
    if (a.overrideNote && !b.overrideNote) return -1;
    if (b.overrideNote && !a.overrideNote) return 1;
    return (b.composite ?? -1) - (a.composite ?? -1);
  });

  if (items.length === 0) return missing();
  return answered(items);
}

function wrongSection(
  rings: LearningRing[],
  buckets: Map<string, RingBucket>
): LearningSection<WrongAssumption> {
  const kept = rings.filter((ring) => ring.kept);
  const airedKept = kept.filter((ring) => buckets.has(ring.id));
  if (airedKept.length === 0) return missing();

  const wrong: WrongAssumption[] = [];
  let anyIncomplete = false;
  for (const ring of airedKept) {
    const bucket = buckets.get(ring.id);
    if (!bucket) continue;
    if (bucket.missingReports > 0 || bucket.reported.length === 0) {
      anyIncomplete = true;
      continue;
    }
    const total = sum(bucket.reported);
    if (total === 0) {
      wrong.push({
        ringId: ring.id,
        label: bucket.label || ring.label,
        reportedConversions: 0,
        showCount: bucket.showIds.size,
      });
    }
  }

  if (wrong.length > 0) return answered(wrong);
  if (anyIncomplete) return missing();
  return measuredEmpty("No confirmed ring was contradicted by the reported results.");
}

function weightSection(
  best: LearningSection<RingFinding>,
  renew: LearningSection<RenewShow>,
  styles: LearningSection<StyleFinding>,
  wrong: LearningSection<WrongAssumption>,
  overrides: LearningOverrideView[]
): LearningSection<WeightCall> {
  const items: WeightCall[] = [];

  for (const ring of best.items) {
    if (ring.reportedConversions <= 0) continue;
    items.push({
      direction: "overweight",
      label: ring.label,
      reason: `${ring.reportedConversions} reported conversions on this ring.`,
      source: "measured",
    });
  }

  for (const show of renew.items) {
    if (show.reportedConversions == null || show.reportedConversions <= 0) continue;
    items.push({
      direction: "overweight",
      label: show.showName,
      reason: `${show.reportedConversions} reported conversions.`,
      source: "measured",
    });
  }

  for (const style of styles.items) {
    if (style.reportedConversions == null) continue;
    if (style.reportedConversions > 0) {
      items.push({
        direction: "overweight",
        label: style.label,
        reason: `${style.reportedConversions} reported conversions on ${style.label.toLowerCase()} reads.`,
        source: "measured",
      });
    } else if (!style.partial) {
      items.push({
        direction: "avoid",
        label: style.label,
        reason: `${style.label} aired and reported 0 conversions.`,
        source: "measured",
      });
    }
  }

  for (const ring of wrong.items) {
    items.push({
      direction: "avoid",
      label: ring.label,
      reason: `${ring.label} aired and reported 0 conversions.`,
      source: "measured",
    });
  }

  for (const override of overrides) {
    if (override.stance !== "overweight" && override.stance !== "avoid") continue;
    items.push({
      direction: override.stance,
      label: override.targetLabel,
      reason: override.note,
      source: "override",
    });
  }

  if (items.length === 0) return missing();
  return answered(items);
}

const IMPORTED_LABEL = "From your past campaigns" as const;

function presentImported(input: LearningReviewInput): ImportedHistoryItem[] {
  const items: ImportedHistoryItem[] = [];
  for (const row of input.imported ?? []) {
    if (row.source !== "imported") continue;
    const showId = row.showId?.trim();
    const showName = row.showName?.trim();
    if (!showId || !showName) continue;
    items.push({
      showId,
      showName,
      records: finiteWhole(row.records) ?? 0,
      conversions: finiteWhole(row.conversions),
      spend: finiteAmount(row.spend),
      downloads: finiteWhole(row.downloads),
      source: "imported",
      label: IMPORTED_LABEL,
    });
  }
  return items;
}

function finiteWhole(value: number | null): number | null {
  if (value == null || !Number.isFinite(value) || value < 0) return null;
  return Math.trunc(value);
}

function finiteAmount(value: number | null): number | null {
  if (value == null || !Number.isFinite(value) || value < 0) return null;
  return value;
}

function presentDeal(deal: LearningDeal): DealLearningRow {
  const reader = single(deal.readerTypes);
  const placement = single(deal.placements);
  return {
    dealId: deal.dealId,
    showId: deal.showId,
    showName: deal.showName,
    status: deal.status,
    inFlight: !deal.aired,
    promoCode: deal.promoCode,
    trackingLink: deal.trackingLink,
    codeOnAir: deal.codeOnAir,
    aircheckDecision: deal.aircheckDecision,
    reportedConversions: deal.reportedConversions,
    readerLabel: reader ? styleLabel(reader) : null,
    placementLabel: placement ? styleLabel(placement) : null,
    ringLabel: deal.ringLabel,
  };
}

function presentOverride(
  override: LearningOverrideInput,
  input: LearningReviewInput
): LearningOverrideView {
  return {
    ...override,
    targetLabel: targetLabel(override, input),
  };
}

function targetLabel(
  override: LearningOverrideInput,
  input: LearningReviewInput
): string {
  if (override.targetKind === "show") {
    return (
      input.showNames[override.targetKey] ??
      input.deals.find((deal) => deal.showId === override.targetKey)?.showName ??
      "Show"
    );
  }
  if (override.targetKind === "ring") {
    return input.rings.find((ring) => ring.id === override.targetKey)?.label ?? "Ring";
  }
  return styleLabel(override.targetKey);
}
