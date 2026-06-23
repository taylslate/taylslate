// ============================================================
// BATCHED CONVICTION REASONING (Wave 14 Phase 2B — Layer 4)
//
// Generates the per-show reasoning prose that hangs off each conviction_scores
// row. ONE LLM call per RING (not per show); the per-ring calls fan out
// CONCURRENTLY. It operates on the in-memory ScoredRingGroup[] the orchestrator
// just produced — so it has the Layer 2 `drivers` diagnostics and the full Show
// objects, which are NOT persisted and would otherwise be lost to a separate
// pass over the rows.
//
// FAIL-SOFT, total. EVERY failure mode routes to a TEMPLATED sentence built
// from the (non-degraded) score components — LLM throw, refusal stop_reason, no
// text block, malformed JSON, a missing or non-string key, and any show beyond
// the per-ring top-N. Reasoning is best-effort; the scores always render.
// Nothing here throws to the orchestrator.
//
// Honest-degrade at launch: discovered shows have empty demographics and rings
// carry no structured target, so audience fit scores a neutral 50 flagged
// `degraded`. The prompt is told which dimensions are UNMEASURED so it never
// fabricates an audience claim, and the template path likewise speaks ONLY to
// dimensions that carried real signal — it never names audience.
// ============================================================

import Anthropic from "@anthropic-ai/sdk";
import type {
  CampaignPatternRow,
  ConvictionBand,
  RingHypothesisRow,
} from "@/lib/data/types";
import {
  callLLMWithFallback,
  loadPrompt,
  type CallLLMInput,
} from "@/lib/llm/client";
import { logEvent, type LogEventInput } from "@/lib/data/events";
// Type-only import — erased at compile time, so there is no runtime circular
// dependency with conviction-discovery (which imports this module's function).
import type { ScoredRingGroup, ScoredShowEntry } from "./conviction-discovery";

// ---- Tunables ----

/**
 * Shows per ring sent to the LLM (groups arrive sorted by composite desc).
 * Shows beyond this in a ring get the templated sentence — bounds token cost
 * and keeps the model focused on the shows the brand looks at first.
 */
export const REASONING_TOP_N = 25;

/** Output cap per ring: up to REASONING_TOP_N short reasoning strings + JSON. */
const REASONING_MAX_TOKENS = 3000;

// Bound the discover POST: per-ring calls run concurrently, each capped here.
// Mirrors the interpret endpoint (60s, no retry) so the worst case stays
// predictable even though there is no lock TTL to respect here.
const REASONING_TIMEOUT_MS = 60_000;
const REASONING_MAX_RETRIES = 0;

// ---- Injected dependencies (default to the real implementations) ----

export interface ReasoningDeps {
  callLLM: (input: CallLLMInput) => Promise<Anthropic.Message>;
  loadSystemPrompt: () => string;
  emit: (input: LogEventInput) => Promise<unknown>;
  topN: number;
}

const defaultDeps: ReasoningDeps = {
  callLLM: callLLMWithFallback,
  loadSystemPrompt: () => loadPrompt("conviction-reasoning.md"),
  emit: logEvent,
  topN: REASONING_TOP_N,
};

// ============================================================
// Public entry — mutates ScoredShowEntry.reasoning in place
// ============================================================

/**
 * Attach reasoning prose to every ScoredShowEntry across all ring groups, in
 * place (consistent with fillPurchasePower's mutate-in-place contract — the
 * entries are freshly scored, throwaway objects the orchestrator owns).
 *
 * One LLM call per non-empty ring, fanned out concurrently. Per-ring failure
 * falls that whole ring back to templated sentences; one ring's failure never
 * touches another's. Never throws.
 */
export async function generateGroupReasoning(
  campaignId: string,
  groups: ScoredRingGroup[],
  pattern: CampaignPatternRow,
  deps: Partial<ReasoningDeps> = {}
): Promise<void> {
  const d: ReasoningDeps = { ...defaultDeps, ...deps };
  const customerSummary = readCustomerSummary(pattern);

  // allSettled is belt-and-suspenders: generateRingReasoning is itself fully
  // guarded and never rejects, but this guarantees one ring can't abort the set.
  await Promise.allSettled(
    groups.map((group) =>
      generateRingReasoning(campaignId, group, customerSummary, d)
    )
  );
}

// ============================================================
// Per-ring generation (never throws)
// ============================================================

async function generateRingReasoning(
  campaignId: string,
  group: ScoredRingGroup,
  customerSummary: string,
  d: ReasoningDeps
): Promise<void> {
  const entries = group.shows;
  if (entries.length === 0) return; // empty ring → no call, no event

  const head = entries.slice(0, d.topN);
  const tail = entries.slice(d.topN);
  // The tail always templates — it is never sent to the model.
  for (const entry of tail) {
    entry.reasoning = templateReasoning(entry);
  }

  // Call the model for the head. Any throw is swallowed → prose stays null →
  // the head templates below.
  let prose: Record<string, string> | null = null;
  try {
    const message = await d.callLLM({
      system: d.loadSystemPrompt(),
      userContent: buildReasoningUserContent(group.ring, customerSummary, head),
      maxTokens: REASONING_MAX_TOKENS,
      timeoutMs: REASONING_TIMEOUT_MS,
      maxRetries: REASONING_MAX_RETRIES,
    });
    prose = extractReasoningMap(message);
  } catch (err) {
    console.warn(
      `[conviction-reasoning] LLM call threw for ring "${group.ring.label}":`,
      err instanceof Error ? err.message : err
    );
    prose = null;
  }

  // Map prose back by show id; any missing / non-usable entry templates.
  let usedTemplate = false;
  for (const entry of head) {
    const fromLLM = prose ? prose[entry.show.id] : undefined;
    if (typeof fromLLM === "string" && fromLLM.trim()) {
      entry.reasoning = fromLLM.trim();
    } else {
      entry.reasoning = templateReasoning(entry);
      usedTemplate = true;
    }
  }

  // `generated` = the head we actually called for came back clean for every
  // show; `failed` = we fell back to a template for at least one of them. A
  // long ring whose head succeeded but whose tail templated still counts as
  // generated — the part we called for succeeded.
  const ringSucceeded = prose !== null && !usedTemplate;
  await safeEmit(d, {
    eventType: ringSucceeded
      ? "conviction.reasoning_generated"
      : "conviction.reasoning_failed",
    entityType: "campaign",
    entityId: campaignId,
    payload: {
      campaign_pattern_id: group.ring.campaign_pattern_id,
      ring_hypothesis_id: group.ring.id,
      ring_label: group.ring.label,
      shows_in_ring: entries.length,
      shows_called: head.length,
      used_template: !ringSucceeded,
    },
  });
}

// ============================================================
// LLM response extraction (mirrors interpret/route.ts parsing)
// ============================================================

/**
 * Pull the show_id → reasoning map out of an LLM message, or null on any
 * non-usable response. A refusal here means callLLMWithFallback already
 * retried with the explicit fallback model and STILL refused (or was already
 * on it) — null → template. No throw on any path.
 */
function extractReasoningMap(
  message: Anthropic.Message
): Record<string, string> | null {
  if (message.stop_reason === "refusal") {
    console.warn("[conviction-reasoning] refusal stop_reason — falling back to template");
    return null;
  }
  const textBlock = message.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") return null;
  return parseReasoningJson(textBlock.text);
}

function parseReasoningJson(raw: string): Record<string, string> | null {
  // Models occasionally wrap JSON in markdown fences despite instructions.
  const unfenced = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  try {
    const value = JSON.parse(unfenced);
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return null;
    }
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (typeof v === "string") out[k] = v;
    }
    return out;
  } catch {
    return null;
  }
}

// ============================================================
// Prompt user-content builder
// ============================================================

export function buildReasoningUserContent(
  ring: RingHypothesisRow,
  customerSummary: string,
  entries: ScoredShowEntry[]
): string {
  const lines: string[] = [`RING: ${ring.label}`];
  if (ring.reasoning && ring.reasoning.trim()) {
    lines.push(`Framing: ${ring.reasoning.trim()}`);
  }
  if (customerSummary.trim()) {
    lines.push(`Customer: ${customerSummary.trim()}`);
  }
  lines.push("", "SHOWS:");
  for (const entry of entries) {
    lines.push(formatShowForPrompt(entry));
  }
  return lines.join("\n");
}

function formatShowForPrompt(entry: ScoredShowEntry): string {
  const { show, score } = entry;
  const cats = uniqueNonEmpty([
    ...(show.categories ?? []),
    ...(show.audience_interests ?? []),
  ]);
  const catStr = cats.length > 0 ? cats.join(", ") : "(uncategorized)";

  const topical = score.drivers.topicalRelevance.degraded
    ? "topical relevance UNMEASURED"
    : `topical relevance ${score.topicalRelevance} MEASURED`;
  const pp = score.drivers.purchasePower.degraded
    ? "purchase power UNMEASURED"
    : `purchase power ${score.purchasePower} MEASURED (${ppTierLabel(score.purchasePower)})`;
  const audience = score.drivers.audienceFit.degraded
    ? "audience fit UNMEASURED (no demographic data)"
    : `audience fit ${score.audienceFit} MEASURED`;

  return [
    `- id: ${show.id}`,
    `  name: ${show.name}`,
    `  categories: ${catStr}`,
    `  scores: ${topical}; ${pp}; ${audience}`,
  ].join("\n");
}

// ============================================================
// Templated fallback (deterministic; never throws, never names audience)
// ============================================================

const BAND_LEAD: Record<ConvictionBand, string> = {
  high: "High-conviction fit",
  medium: "Probable fit",
  low: "Worth a test slot",
  speculative: "Speculative",
};

/**
 * Build a reasoning sentence from the score components when the LLM is
 * unavailable. Speaks ONLY to dimensions that carried real signal: audience is
 * never mentioned, because at launch it is an unmeasured neutral score and
 * naming it would fabricate a demographic claim the data does not support.
 *
 * The ring is referenced GENERICALLY ("this ring") and the raw ring label is
 * deliberately NOT interpolated here — a 2A label can carry demographic words
 * ("affluent women 35-44 …"), and surfacing that on the fallback path would
 * read as an audience claim. The label stays on the LLM/happy path, where the
 * prompt forbids fabricating audience. Layer 5 renders this under the ring's
 * own heading, so "this ring" loses no clarity. Net: no demographic vocabulary
 * can reach this path regardless of ring label.
 *
 * Always returns a non-empty string; never throws (drivers is guarded so a
 * malformed score degrades to the no-signal line rather than dereferencing
 * undefined).
 */
export function templateReasoning(entry: ScoredShowEntry): string {
  const { score } = entry;
  // Defensive: scoreShowConviction always populates drivers, but templateReasoning
  // is exported and the fail-soft contract is "never throws" — a missing drivers
  // object degrades every dimension rather than throwing.
  const drivers = score?.drivers ?? {
    audienceFit: { degraded: true, coverage: 0 },
    topicalRelevance: { degraded: true },
    purchasePower: { degraded: true, source: "absent" as const },
  };
  const clauses: string[] = [];

  if (!drivers.topicalRelevance.degraded) {
    const strength =
      score.topicalRelevance >= 80
        ? "strong"
        : score.topicalRelevance >= 50
          ? "moderate"
          : "loose";
    clauses.push(`${strength} topical overlap with this ring`);
  }
  if (!drivers.purchasePower.degraded) {
    clauses.push(`${ppTierLabel(score.purchasePower)} purchase power for this price point`);
  }

  const lead = BAND_LEAD[score?.band] ?? "Match";
  if (clauses.length === 0) {
    return `${lead} — limited signal to score this show on the available data.`;
  }
  return `${lead} — ${clauses.join(", ")}.`;
}

/** Human label for a purchase-power sub-score. Deliberately avoids demographic
 *  words so the template path can never read as an audience claim. */
function ppTierLabel(score: number): "high" | "moderate" | "lower" {
  if (score >= 70) return "high";
  if (score >= 40) return "moderate";
  return "lower";
}

// ============================================================
// Helpers
// ============================================================

function readCustomerSummary(pattern: CampaignPatternRow): string {
  const attrs = (pattern.product_attributes ?? {}) as Record<string, unknown>;
  const cs = attrs.customer_summary;
  if (typeof cs === "string" && cs.trim()) return cs;
  return pattern.customer_description ?? "";
}

async function safeEmit(d: ReasoningDeps, input: LogEventInput): Promise<void> {
  try {
    await d.emit(input);
  } catch (err) {
    console.warn(
      "[conviction-reasoning] emit threw:",
      err instanceof Error ? err.message : err
    );
  }
}

function uniqueNonEmpty(items: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    const v = (item ?? "").trim();
    if (!v || seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}
