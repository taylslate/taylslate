// Wave 14 Phase 2A Layer 5 — shared ring-proposal helpers.
//
// The refine and add-ring endpoints both ask the LLM to produce ONE ring,
// given the same brief context the original interpretation used. They
// reconstruct that context from the stored campaign_patterns row (which
// already holds the brand-confirmed product derivation, the brief context,
// and the full interpretation blob) rather than re-resolving the raw brief.
//
// parseProposedRing mirrors the single-ring parsing in interpret/route.ts so
// the two paths normalize confidence and analog citations identically.

import type {
  CampaignPatternRow,
  ConvictionBand,
} from "@/lib/data/types";

export interface ProposedRing {
  ring_label: string;
  confidence: ConvictionBand;
  reasoning: string;
  analog_campaigns: string[];
}

export type ParseProposedRingResult =
  | { ring: ProposedRing }
  | { error: "malformed" };

/**
 * Build the brief + existing-rings context block for a single-ring proposal.
 * Pulled entirely from the persisted pattern row so refine/add see the same
 * product, customer read, goals, budget, exclusions, and current rings the
 * interpretation was built from.
 */
export function buildPatternContext(pattern: CampaignPatternRow): string {
  const attrs = pattern.product_attributes ?? {};
  const brief = asRecord(attrs.brief_context) ?? {};
  const lines: string[] = [
    "## Campaign brief",
    "",
    "Product:",
    `- Brand: ${readString(attrs, "brand_name")}`,
    `- Category: ${readString(attrs, "category")}`,
    `- Description: ${readString(attrs, "product_description")}`,
    `- AOV bucket: ${pattern.aov_bucket || readString(attrs, "aov_bucket") || "unknown"}`,
    `- Key attributes: ${readStringArray(attrs.key_attributes).join(", ") || "none provided"}`,
    "",
    "Customer (your read):",
    readString(attrs, "customer_summary") ||
      pattern.customer_description ||
      "(none recorded)",
  ];

  if (pattern.customer_description) {
    lines.push("", "Customer (brand's own words):", pattern.customer_description);
  }

  lines.push(
    "",
    `Goals: ${readStringArray(brief.goals).join(", ") || "none provided"}`
  );
  const goalsContext = readString(brief, "goals_context");
  if (goalsContext) lines.push(`Goals context: ${goalsContext}`);
  const budget = brief.budget_total;
  lines.push(
    `Budget: ${
      typeof budget === "number"
        ? `$${budget.toLocaleString("en-US")}`
        : "not provided"
    }`,
    `Exclusions: ${readString(brief, "exclusions_text") || "none provided"}`
  );

  lines.push("", "## Rings already proposed", "");
  const existing = existingRings(attrs);
  if (existing.length === 0) {
    lines.push("(none yet)");
  } else {
    existing.forEach((ring, i) => {
      lines.push(
        `${i + 1}. [${ring.kind}] ${ring.ring_label} (${ring.confidence}) — ${
          ring.reasoning || "no reasoning recorded"
        }`
      );
    });
  }

  return lines.join("\n");
}

interface ExistingRing {
  kind: "primary" | "lateral";
  ring_label: string;
  confidence: string;
  reasoning: string;
}

function existingRings(attrs: Record<string, unknown>): ExistingRing[] {
  const interp = asRecord(attrs.interpretation);
  if (!interp) return [];
  const out: ExistingRing[] = [];
  const primary = asRecord(interp.primary_ring);
  if (primary) {
    out.push({
      kind: "primary",
      ring_label: readString(primary, "ring_label"),
      confidence: readString(primary, "confidence"),
      reasoning: readString(primary, "reasoning"),
    });
  }
  if (Array.isArray(interp.lateral_rings)) {
    for (const entry of interp.lateral_rings) {
      const ring = asRecord(entry);
      if (!ring) continue;
      out.push({
        kind: "lateral",
        ring_label: readString(ring, "ring_label"),
        confidence: readString(ring, "confidence"),
        reasoning: readString(ring, "reasoning"),
      });
    }
  }
  return out.filter((r) => r.ring_label);
}

/**
 * Parse one ring JSON from raw LLM text. Stricter than a forgiving read: a
 * usable ring MUST carry a non-empty ring_label, an EXPLICIT valid confidence
 * band (no silent default to 'speculative'), and non-empty reasoning. Missing
 * any of those → 'malformed', so the refine/add-ring routes soft-fail and ask
 * the brand to rephrase rather than persisting a hollow ring.
 */
export function parseProposedRing(raw: string): ParseProposedRingResult {
  const unfenced = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");

  let parsed: unknown;
  try {
    parsed = JSON.parse(unfenced);
  } catch {
    return { error: "malformed" };
  }
  const record = asRecord(parsed);
  if (!record) return { error: "malformed" };

  const label = readString(record, "ring_label");
  if (!label.trim()) return { error: "malformed" };

  const confidence = readConfidence(record.confidence);
  if (!confidence) return { error: "malformed" };

  const reasoning = readString(record, "reasoning");
  if (!reasoning.trim()) return { error: "malformed" };

  return {
    ring: {
      ring_label: label,
      confidence,
      reasoning,
      analog_campaigns: readStringArray(record.analog_campaigns),
    },
  };
}

/** A valid confidence band, or null when absent/unrecognized (→ malformed). */
function readConfidence(value: unknown): ConvictionBand | null {
  if (
    value === "high" ||
    value === "medium" ||
    value === "low" ||
    value === "speculative"
  ) {
    return value;
  }
  return null;
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
