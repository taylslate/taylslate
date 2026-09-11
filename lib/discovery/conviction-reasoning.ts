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
// Failure-cause telemetry: the reasoning events also record WHY a ring
// templated (failure_stage / error_type / error_message / stop_reason) and the
// response's input_tokens / output_tokens (per-run cost and output pressure
// derivable from events) — observability only; fallback behavior unchanged.
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
 *
 * Lowered 25 → 20 (Sep 2026): with sponsor lines in the prompt, per-ring
 * output ran to ~2.9K tokens at 25 shows — 96% of REASONING_MAX_TOKENS and
 * ~60s of generation, straddling REASONING_TIMEOUT_MS. At 20 the expected
 * output is ~2.3K (~77% of cap, ~48s). Measured coverage cost on the SaunaBox
 * rings: every high-band show sat in ranks 1-15; the demoted ranks 21-25 were
 * low-band in 3 of 4 rings.
 */
export const REASONING_TOP_N = 20;

/** Output cap per ring: up to REASONING_TOP_N short reasoning strings + JSON. */
const REASONING_MAX_TOKENS = 3000;

/**
 * Cap on the per-show description line (applied after HTML stripping). Median
 * stored description is ~530 chars and positioning is front-loaded, so 500
 * keeps roughly half of them whole while bounding the worst-case ring prompt
 * at ~REASONING_TOP_N × 500 chars regardless of outliers (max observed 2.7K).
 */
export const DESCRIPTION_MAX_CHARS = 500;

/**
 * Cap on sponsor names in the per-show prompt line. Podscan sponsor history
 * runs up to 50 entries (episode_count desc, so the head is the most
 * recurrent); 10 bounds the worst-case ring prompt while keeping the
 * revealed-preference signal intact.
 */
export const SPONSORS_MAX_ITEMS = 10;

// Bound the discover POST: per-ring calls run concurrently, each capped here.
// 90s — sized to this call, not to the interpret endpoint's 60s (that bound
// exists to respect a lock TTL this path doesn't have). Generation at 25 shows
// with sponsor lines measured ~60s wall clock; at REASONING_TOP_N=20 the
// expectation is ~48s, so 90s is ~1.9x headroom. The discover route exports no
// maxDuration, so Vercel's 300s default applies — ~30s of discovery/scoring
// plus this concurrent fan-out fits comfortably.
// No retry: LLM_MAX_RETRIES stays 0 by standing invariant.
const REASONING_TIMEOUT_MS = 90_000;
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

// ---- Failure-cause telemetry ----

/**
 * Why a ring fell back to templates. Threaded into the domain-event payload so
 * the cause is queryable from domain_events instead of living only in
 * ephemeral console.warn output (the Sep 2026 timeout regression was only
 * diagnosable from Vercel runtime logs). Observability only — every stage
 * still routes to templateReasoning.
 */
interface ReasoningFailure {
  stage:
    | "llm_call_threw"
    | "refusal"
    | "no_text_block"
    | "max_tokens_truncated"
    | "parse_failed"
    | "missing_keys";
  error_type: string | null;
  error_message: string | null;
}

/** What came back from the LLM call, plus the telemetry the event records. */
interface ExtractionResult {
  prose: Record<string, string> | null;
  failure: ReasoningFailure | null;
  stopReason: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
}

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
  // the head templates below; the cause is kept for the event payload.
  let extraction: ExtractionResult;
  try {
    const message = await d.callLLM({
      system: d.loadSystemPrompt(),
      userContent: buildReasoningUserContent(group.ring, customerSummary, head),
      maxTokens: REASONING_MAX_TOKENS,
      timeoutMs: REASONING_TIMEOUT_MS,
      maxRetries: REASONING_MAX_RETRIES,
    });
    extraction = extractReasoningMap(message);
  } catch (err) {
    console.warn(
      `[conviction-reasoning] LLM call threw for ring "${group.ring.label}":`,
      err instanceof Error ? err.message : err
    );
    extraction = {
      prose: null,
      failure: {
        stage: "llm_call_threw",
        error_type: err instanceof Error ? err.constructor.name : "unknown",
        error_message: err instanceof Error ? err.message : String(err),
      },
      stopReason: null,
      inputTokens: null,
      outputTokens: null,
    };
  }

  // Map prose back by show id; any missing / non-usable entry templates.
  const { prose } = extraction;
  let missingKeys = 0;
  for (const entry of head) {
    const fromLLM = prose ? prose[entry.show.id] : undefined;
    if (typeof fromLLM === "string" && fromLLM.trim()) {
      entry.reasoning = fromLLM.trim();
    } else {
      entry.reasoning = templateReasoning(entry);
      if (prose !== null) missingKeys += 1;
    }
  }

  // `generated` = the head we actually called for came back clean for every
  // show; `failed` = we fell back to a template for at least one of them. A
  // long ring whose head succeeded but whose tail templated still counts as
  // generated — the part we called for succeeded.
  const failure: ReasoningFailure | null =
    extraction.failure ??
    (missingKeys > 0
      ? {
          stage: "missing_keys",
          error_type: null,
          error_message: `${missingKeys} of ${head.length} show ids missing or empty in the LLM map`,
        }
      : null);
  const ringSucceeded = failure === null;
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
      failure_stage: failure?.stage ?? null,
      error_type: failure?.error_type ?? null,
      error_message: failure?.error_message ?? null,
      stop_reason: extraction.stopReason,
      input_tokens: extraction.inputTokens,
      output_tokens: extraction.outputTokens,
    },
  });
}

// ============================================================
// LLM response extraction (mirrors interpret/route.ts parsing)
// ============================================================

/**
 * Pull the show_id → reasoning map out of an LLM message, with null prose on
 * any non-usable response — plus the failure cause and usage telemetry the
 * event payload records. A refusal here means callLLMWithFallback already
 * retried with the explicit fallback model and STILL refused (or was already
 * on it) — null → template. No throw on any path.
 */
function extractReasoningMap(message: Anthropic.Message): ExtractionResult {
  const stopReason = message.stop_reason ?? null;
  // Defensive `?.`: injected test doubles build partial Message objects.
  const inputTokens = message.usage?.input_tokens ?? null;
  const outputTokens = message.usage?.output_tokens ?? null;
  const base = { stopReason, inputTokens, outputTokens };

  if (message.stop_reason === "refusal") {
    console.warn("[conviction-reasoning] refusal stop_reason — falling back to template");
    return {
      prose: null,
      failure: { stage: "refusal", error_type: null, error_message: null },
      ...base,
    };
  }
  const textBlock = message.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    console.warn("[conviction-reasoning] no text block in response — falling back to template");
    return {
      prose: null,
      failure: { stage: "no_text_block", error_type: null, error_message: null },
      ...base,
    };
  }
  const prose = parseReasoningJson(textBlock.text);
  if (prose === null) {
    // stop_reason "max_tokens" + unparseable JSON = the output was cut
    // mid-string by the cap. Previously indistinguishable from any other
    // parse failure (and logged nowhere).
    const truncated = message.stop_reason === "max_tokens";
    console.warn(
      truncated
        ? "[conviction-reasoning] output hit max_tokens mid-JSON — falling back to template"
        : "[conviction-reasoning] unparseable response JSON — falling back to template"
    );
    return {
      prose: null,
      failure: {
        stage: truncated ? "max_tokens_truncated" : "parse_failed",
        error_type: null,
        error_message: null,
      },
      ...base,
    };
  }
  // A max_tokens stop with parseable JSON can still be missing trailing shows;
  // the caller's missing-keys pass catches that, and stop_reason is recorded.
  return { prose, failure: null, ...base };
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
  const description = cleanDescription(show.description);

  const topical = score.drivers.topicalRelevance.degraded
    ? "topical relevance UNMEASURED"
    : `topical relevance ${score.topicalRelevance} MEASURED`;
  const pp = score.drivers.purchasePower.degraded
    ? "purchase power UNMEASURED"
    : `purchase power ${score.purchasePower} MEASURED (${ppTierLabel(score.purchasePower)})`;
  const audience = score.drivers.audienceFit.degraded
    ? "audience fit UNMEASURED (no demographic data)"
    : `audience fit ${score.audienceFit} MEASURED`;

  const sponsors = (show.current_sponsors ?? [])
    .filter((s) => typeof s === "string" && s.trim())
    .slice(0, SPONSORS_MAX_ITEMS);

  const lines = [`- id: ${show.id}`, `  name: ${show.name}`];
  // Omitted (not "(none)") when empty so the model never remarks on a gap.
  if (description) lines.push(`  description: ${description}`);
  if (sponsors.length > 0) {
    lines.push(`  sponsors detected: ${sponsors.join(", ")}`);
  }
  lines.push(`  categories: ${catStr}`, `  scores: ${topical}; ${pp}; ${audience}`);
  return lines.join("\n");
}

/**
 * Reduce a stored show description to prompt-safe plain text. RSS-sourced
 * descriptions carry raw HTML (<p>, <br>, entities); regex tag-stripping is
 * prompt hygiene, not sanitization — a malformed tag degrades to stray text
 * in the prompt, nothing worse. Total: any input yields a (possibly empty)
 * string, so a bad description can never break the fail-soft reasoning path.
 * Truncates at a word boundary after stripping, since tags inflate raw
 * character counts.
 */
export function cleanDescription(raw: string | null | undefined): string {
  if (!raw) return "";
  const text = raw
    .replace(/<[^>]*>/g, " ")
    .replace(
      /&(amp|lt|gt|quot|apos|nbsp|#\d+|#x[0-9a-fA-F]+);/g,
      (match, code: string) => {
        switch (code) {
          case "amp":
            return "&";
          case "lt":
            return "<";
          case "gt":
            return ">";
          case "quot":
            return '"';
          case "apos":
            return "'";
          case "nbsp":
            return " ";
          default: {
            const value = code.startsWith("#x")
              ? parseInt(code.slice(2), 16)
              : parseInt(code.slice(1), 10);
            return Number.isInteger(value) && value > 0 && value <= 0x10ffff
              ? String.fromCodePoint(value)
              : match;
          }
        }
      }
    )
    .replace(/\s+/g, " ")
    .trim();
  if (text.length <= DESCRIPTION_MAX_CHARS) return text;
  const cut = text.slice(0, DESCRIPTION_MAX_CHARS);
  const lastSpace = cut.lastIndexOf(" ");
  const atBoundary = lastSpace > 0 ? cut.slice(0, lastSpace) : cut;
  return `${atBoundary.replace(/[\s.,;:—–-]+$/, "")}…`;
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
