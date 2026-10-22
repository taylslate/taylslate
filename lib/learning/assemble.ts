// Turn deal, aircheck, conversion, and score rows into the pure review
// input. Show identity is deals.show_id joined to shows.id. This module
// does not read show_profiles.

import { buildTrackingLink } from "@/lib/io/tracking-link";
import { normalizePlacement, normalizeReader } from "./styles";
import type {
  ImportedHistoryInput,
  LearningDeal,
  LearningOverrideInput,
  LearningReviewInput,
  LearningRing,
  LearningScaleCandidate,
  OverrideAuthorRole,
  OverrideStance,
  OverrideTargetKind,
} from "./review";

export interface RawDeal {
  id: string;
  show_id: string | null;
  campaign_id?: string | null;
  outreach_id?: string | null;
  status: string | null;
  promo_code?: string | null;
  reader_type?: string | null;
  placement?: string | null;
  agreed_placement?: string | null;
}

export interface RawLine {
  id: string;
  io_id: string;
  placement?: string | null;
  reader_type?: string | null;
  spot_format?: string | null;
  verified?: boolean | null;
}

export interface RawAircheck {
  io_line_item_id: string;
  review_decision?: string | null;
  match_evidence?: unknown;
}

export interface RawIo {
  id: string;
  deal_id: string;
}

export interface RawShowName {
  id: string;
  name: string | null;
}

export interface RawScore {
  show_id: string | null;
  ring_hypothesis_id: string | null;
  composite_score: number | null;
  tier: string | null;
}

export interface RawRing {
  id: string;
  label: string | null;
  brand_decision: string | null;
}

export interface RawReport {
  deal_id: string;
  reported_conversions: number | null;
}

export interface RawOverride {
  id: string;
  author_role: string | null;
  target_kind: string | null;
  target_key: string | null;
  stance: string | null;
  note: string | null;
}

export interface RawOutreach {
  id: string;
  show_name?: string | null;
}

export interface RawImportedRecord {
  id: string;
  show_name: string | null;
  matched_show_id: string | null;
  placement: string | null;
  price_type: string | null;
  spend: number | null;
  conversions: number | null;
  downloads: number | null;
}

export interface AssembleLearningInput {
  campaignStatus: string;
  brandWebsite: string | null;
  deals: RawDeal[];
  outreaches: RawOutreach[];
  shows: RawShowName[];
  ios: RawIo[];
  lines: RawLine[];
  airchecks: RawAircheck[];
  scores: RawScore[];
  rings: RawRing[];
  reports: RawReport[];
  overrides: RawOverride[];
  /** Confirmed imports for this brand. Omitted means none. */
  imported?: RawImportedRecord[];
}

const AUTHOR_ROLES = new Set<OverrideAuthorRole>(["brand", "rep"]);
const TARGET_KINDS = new Set<OverrideTargetKind>(["show", "ring", "style"]);
const STANCES = new Set<OverrideStance>([
  "renew",
  "test_next",
  "overweight",
  "avoid",
  "note",
]);

export function assembleLearningInput(raw: AssembleLearningInput): LearningReviewInput {
  const showNames = new Map<string, string>();
  for (const show of raw.shows) {
    const name = show.name?.trim();
    if (show.id && name) showNames.set(show.id, name);
  }
  const outreachNames = new Map<string, string>();
  for (const outreach of raw.outreaches) {
    const name = outreach.show_name?.trim();
    if (outreach.id && name) outreachNames.set(outreach.id, name);
  }

  const rings = raw.rings.map(presentRing);
  const ringById = new Map(rings.map((ring) => [ring.id, ring]));
  const keptIds = new Set(rings.filter((ring) => ring.kept).map((ring) => ring.id));

  const scoresByShow = new Map<string, RawScore[]>();
  for (const score of raw.scores) {
    if (!score.show_id) continue;
    const list = scoresByShow.get(score.show_id) ?? [];
    list.push(score);
    scoresByShow.set(score.show_id, list);
  }

  const linesByIo = new Map<string, RawLine[]>();
  for (const line of raw.lines) {
    const list = linesByIo.get(line.io_id) ?? [];
    list.push(line);
    linesByIo.set(line.io_id, list);
  }
  const iosByDeal = new Map<string, RawIo[]>();
  for (const io of raw.ios) {
    const list = iosByDeal.get(io.deal_id) ?? [];
    list.push(io);
    iosByDeal.set(io.deal_id, list);
  }
  const airByLine = new Map<string, RawAircheck>();
  for (const aircheck of raw.airchecks) {
    airByLine.set(aircheck.io_line_item_id, aircheck);
  }
  const reportByDeal = new Map<string, number>();
  for (const report of raw.reports) {
    const count = finiteNonNegative(report.reported_conversions);
    if (count == null) continue;
    reportByDeal.set(report.deal_id, count);
  }

  const deals: LearningDeal[] = [];
  for (const deal of raw.deals) {
    if (!deal.id || !deal.show_id) continue;
    const showName =
      showNames.get(deal.show_id) ??
      (deal.outreach_id ? outreachNames.get(deal.outreach_id) : undefined) ??
      "Show unavailable";
    if (!showNames.has(deal.show_id)) showNames.set(deal.show_id, showName);

    const lines = (iosByDeal.get(deal.id) ?? []).flatMap(
      (io) => linesByIo.get(io.id) ?? []
    );
    const airchecks = lines
      .map((line) => airByLine.get(line.id))
      .filter((row): row is RawAircheck => !!row);
    const decision = airDecision(airchecks);
    const verified = lines.some((line) => line.verified === true);
    const status = deal.status ?? "";
    const ring = pickRing(scoresByShow.get(deal.show_id) ?? [], keptIds, ringById);

    deals.push({
      dealId: deal.id,
      showId: deal.show_id,
      showName,
      status,
      promoCode: blankToNull(deal.promo_code),
      trackingLink: buildTrackingLink({
        brandWebsite: raw.brandWebsite,
        dealId: deal.id,
        showName,
      }),
      ringId: ring?.id ?? null,
      ringLabel: ring?.label ?? null,
      composite: maxComposite(scoresByShow.get(deal.show_id) ?? []),
      readerTypes: readerTypes(lines, deal.reader_type),
      placements: placements(lines, deal.agreed_placement ?? deal.placement),
      aired: decision === "confirmed" || verified || status === "completed",
      codeOnAir: codeOnAir(airchecks),
      aircheckDecision: decision,
      reportedConversions: reportByDeal.has(deal.id)
        ? reportByDeal.get(deal.id)!
        : null,
    });
  }

  const scaleShows = scaleCandidates(raw.scores, showNames, ringById);

  const names: Record<string, string> = {};
  for (const [id, name] of showNames) names[id] = name;
  for (const show of scaleShows) names[show.showId] = show.showName;

  const imported = groupImported(raw.imported, showNames);
  for (const row of imported) {
    if (!names[row.showId]) names[row.showId] = row.showName;
  }

  return {
    campaignStatus: raw.campaignStatus,
    deals,
    rings,
    scaleShows,
    overrides: raw.overrides.flatMap(presentOverride),
    showNames: names,
    imported,
  };
}

function groupImported(
  records: RawImportedRecord[] | undefined,
  showNames: Map<string, string>
): ImportedHistoryInput[] {
  const groups = new Map<string, ImportedHistoryInput>();
  for (const record of records ?? []) {
    const matched = record.matched_show_id?.trim() || null;
    const recordedName = record.show_name?.trim() || "";
    const showName =
      (matched ? showNames.get(matched) : undefined) ||
      recordedName ||
      (matched ? "Show unavailable" : "");
    if (!showName) continue;
    const showId = matched ?? `name:${showName.toLowerCase()}`;
    const current = groups.get(showId) ?? {
      showId,
      showName,
      records: 0,
      conversions: null,
      spend: null,
      downloads: null,
      source: "imported" as const,
    };
    current.records += 1;
    current.conversions = addAmount(current.conversions, record.conversions);
    current.spend = addAmount(current.spend, record.spend);
    current.downloads = addAmount(current.downloads, record.downloads);
    groups.set(showId, current);
  }
  return [...groups.values()].sort(
    (a, b) => a.showName.localeCompare(b.showName) || a.showId.localeCompare(b.showId)
  );
}

function addAmount(current: number | null, value: number | null): number | null {
  if (value == null || !Number.isFinite(value) || value < 0) return current;
  return (current ?? 0) + value;
}

function presentRing(ring: RawRing): LearningRing {
  return {
    id: ring.id,
    label: ring.label?.trim() || "Ring",
    kept: ring.brand_decision === "confirmed" || ring.brand_decision === "added_by_brand",
  };
}

function pickRing(
  scores: RawScore[],
  keptIds: Set<string>,
  ringById: Map<string, LearningRing>
): LearningRing | null {
  const ranked = [...scores].sort(
    (a, b) => (b.composite_score ?? -1) - (a.composite_score ?? -1)
  );
  const kept = ranked.find(
    (score) => score.ring_hypothesis_id && keptIds.has(score.ring_hypothesis_id)
  );
  const chosen = kept ?? ranked.find((score) => score.ring_hypothesis_id);
  if (!chosen?.ring_hypothesis_id) return null;
  return (
    ringById.get(chosen.ring_hypothesis_id) ?? {
      id: chosen.ring_hypothesis_id,
      label: "Ring",
      kept: false,
    }
  );
}

function maxComposite(scores: RawScore[]): number | null {
  let best: number | null = null;
  for (const score of scores) {
    if (score.composite_score == null || !Number.isFinite(score.composite_score)) continue;
    best = best == null ? score.composite_score : Math.max(best, score.composite_score);
  }
  return best;
}

function scaleCandidates(
  scores: RawScore[],
  showNames: Map<string, string>,
  ringById: Map<string, LearningRing>
): LearningScaleCandidate[] {
  const best = new Map<string, RawScore>();
  for (const score of scores) {
    if (score.tier !== "scale" || !score.show_id) continue;
    const existing = best.get(score.show_id);
    if (!existing || (score.composite_score ?? -1) > (existing.composite_score ?? -1)) {
      best.set(score.show_id, score);
    }
  }
  return [...best.entries()].map(([showId, score]) => {
    const ring = score.ring_hypothesis_id
      ? ringById.get(score.ring_hypothesis_id)
      : undefined;
    return {
      showId,
      showName: showNames.get(showId) ?? "Show unavailable",
      ringId: score.ring_hypothesis_id,
      ringLabel: ring?.label ?? null,
      composite:
        score.composite_score != null && Number.isFinite(score.composite_score)
          ? score.composite_score
          : null,
    };
  });
}

function readerTypes(lines: RawLine[], fallback: string | null | undefined): string[] {
  const fromLines = unique(
    lines.map((line) => normalizeReader(line.spot_format) ?? normalizeReader(line.reader_type))
  );
  if (fromLines.length > 0) return fromLines;
  const dealLevel = normalizeReader(fallback);
  return dealLevel ? [dealLevel] : [];
}

function placements(lines: RawLine[], fallback: string | null | undefined): string[] {
  const fromLines = unique(lines.map((line) => normalizePlacement(line.placement)));
  if (fromLines.length > 0) return fromLines;
  const dealLevel = normalizePlacement(fallback);
  return dealLevel ? [dealLevel] : [];
}

function unique(values: Array<string | null>): string[] {
  return [...new Set(values.filter((value): value is string => !!value))];
}

function airDecision(
  airchecks: RawAircheck[]
): "confirmed" | "rejected" | null {
  if (airchecks.some((row) => row.review_decision === "confirmed")) return "confirmed";
  if (airchecks.some((row) => row.review_decision === "rejected")) return "rejected";
  return null;
}

function codeOnAir(airchecks: RawAircheck[]): "found" | "missing" | null {
  const checks = airchecks.map((row) => readCode(row.match_evidence));
  if (checks.includes("found")) return "found";
  if (checks.includes("missing")) return "missing";
  return null;
}

function readCode(evidence: unknown): "found" | "missing" | null {
  let value = evidence;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (!value || typeof value !== "object") return null;
  const code = (value as { code_or_url?: unknown }).code_or_url;
  if (code === "found" || code === "missing") return code;
  return null;
}

function presentOverride(row: RawOverride): LearningOverrideInput[] {
  if (!row.id || !row.note?.trim() || !row.target_key?.trim()) return [];
  if (!AUTHOR_ROLES.has(row.author_role as OverrideAuthorRole)) return [];
  if (!TARGET_KINDS.has(row.target_kind as OverrideTargetKind)) return [];
  if (!STANCES.has(row.stance as OverrideStance)) return [];
  return [
    {
      id: row.id,
      authorRole: row.author_role as OverrideAuthorRole,
      targetKind: row.target_kind as OverrideTargetKind,
      targetKey: row.target_key.trim(),
      stance: row.stance as OverrideStance,
      note: row.note.trim(),
    },
  ];
}

function finiteNonNegative(value: number | null): number | null {
  if (value == null || !Number.isFinite(value) || value < 0) return null;
  return Math.trunc(value);
}

function blankToNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}
