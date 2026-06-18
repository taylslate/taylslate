// Wave 14 Phase 2A Layer 5 — durable interpretation reconstruction.
//
// The interpretation page must survive a reload: a brand who refines two
// rings, adds one, and comes back 20 minutes later has to see exactly that
// state, not a replay of the original LLM output. Refinements and additions
// are persisted to ring_hypotheses, so the page reconstructs the CURRENT
// ring state from those rows on mount rather than replaying the stored
// interpretation blob.
//
// This is a READ path. It is deliberately independent of Layer 4's
// write-atomic replay (interpret/route.ts): that endpoint's atomicity
// guarantee is about how an interpretation is committed, not about how the
// page later reads it back. The page can use whatever query produces the
// right UX.
//
// Rows with brand_decision='refined' have been superseded by newer rows and
// are filtered out of the view — they stay in the DB as training data.

import type {
  BrandDecision,
  BriefInterpretation,
  CampaignPatternRow,
  ConvictionBand,
  InterpretedRing,
  RingHypothesisRow,
} from "@/lib/data/types";

export interface ReconstructedInterpretation {
  interpretation: BriefInterpretation;
  /** ring_hypothesis_id → persisted brand_decision, for UI default state. */
  decisions: Record<string, BrandDecision>;
}

/**
 * Rebuild the page's interpretation state from the latest pattern row and its
 * ring_hypotheses. Returns null when no non-refined primary ring exists (a
 * pattern with no usable rings — defensive; the page then runs a fresh
 * interpretation instead).
 */
export function reconstructInterpretation(
  pattern: CampaignPatternRow,
  rings: RingHypothesisRow[]
): ReconstructedInterpretation | null {
  const live = rings.filter((r) => r.brand_decision !== "refined");

  // Stable order by slot_position (migration 025), NOT created_at: a refined
  // ring's replacement inherits its predecessor's slot, so it keeps the same
  // visual position even though it was created later. created_at is only a
  // tie-break (and a fallback for rows the backfill hasn't reached / collisions
  // among brand-added rings).
  const bySlot = (a: RingHypothesisRow, b: RingHypothesisRow) => {
    const sa = a.slot_position ?? Number.MAX_SAFE_INTEGER;
    const sb = b.slot_position ?? Number.MAX_SAFE_INTEGER;
    if (sa !== sb) return sa - sb;
    return Date.parse(a.created_at) - Date.parse(b.created_at);
  };

  const primaryRow = live
    .filter((r) => r.kind === "primary")
    .sort(bySlot)[0];
  if (!primaryRow) return null;

  const lateralRows = live
    .filter((r) => r.kind === "lateral")
    .sort(bySlot);

  const analogsByLabel = analogMap(pattern);
  const toRing = (row: RingHypothesisRow): InterpretedRing => ({
    ring_hypothesis_id: row.id,
    ring_label: row.label,
    confidence: row.confidence,
    reasoning: row.reasoning ?? "",
    analog_campaigns: analogsByLabel.get(row.label) ?? [],
  });

  const decisions: Record<string, BrandDecision> = {};
  for (const row of live) decisions[row.id] = row.brand_decision;

  const attrs = pattern.product_attributes ?? {};

  return {
    interpretation: {
      campaign_pattern_id: pattern.id,
      campaign_pattern: {
        customer_summary: readString(attrs, "customer_summary"),
        interpretation_confidence: readConfidence(
          attrs.interpretation_confidence
        ),
        exclusions_parsed: readExclusionsParsed(attrs),
      },
      primary_ring: toRing(primaryRow),
      lateral_rings: lateralRows.map(toRing),
    },
    decisions,
  };
}

/**
 * Best-effort analog citations by ring label, pulled from the stored
 * interpretation blob (product_attributes.interpretation). Original rings
 * recover their analogs; refined/added rings have none persisted (analogs
 * aren't a ring_hypotheses column) and simply show empty.
 */
function analogMap(pattern: CampaignPatternRow): Map<string, string[]> {
  const map = new Map<string, string[]>();
  const interp = asRecord(pattern.product_attributes?.interpretation);
  if (!interp) return map;

  const add = (value: unknown) => {
    const ring = asRecord(value);
    if (!ring) return;
    const label = readString(ring, "ring_label");
    if (!label) return;
    map.set(label, readStringArray(ring.analog_campaigns));
  };

  add(interp.primary_ring);
  if (Array.isArray(interp.lateral_rings)) {
    for (const entry of interp.lateral_rings) add(entry);
  }
  return map;
}

function readExclusionsParsed(attrs: Record<string, unknown>): string[] {
  const interp = asRecord(attrs.interpretation);
  const fromBlob = asRecord(interp?.campaign_pattern);
  if (fromBlob && Array.isArray(fromBlob.exclusions_parsed)) {
    return readStringArray(fromBlob.exclusions_parsed);
  }
  const briefContext = asRecord(attrs.brief_context);
  if (briefContext && Array.isArray(briefContext.exclusions_parsed)) {
    return readStringArray(briefContext.exclusions_parsed);
  }
  return [];
}

function readConfidence(value: unknown): ConvictionBand {
  return value === "high" ||
    value === "medium" ||
    value === "low" ||
    value === "speculative"
    ? value
    : "speculative";
}

function readString(obj: Record<string, unknown>, key: string): string {
  const value = obj[key];
  return typeof value === "string" ? value : "";
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((v): v is string => typeof v === "string")
    : [];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}
