// Wave 14 Phase 2A Layer 4 — brief interpretation endpoint.
//
// POST (no body) → loads the submitted brief, retrieves analog campaigns
// from the pattern library, asks the LLM for 1 primary + 2-4 lateral ring
// hypotheses, persists the reasoning via lib/data/reasoning-log.ts, and
// returns the interpretation for the Layer 5 page to render.
//
// Soft-error contract (200 status, error field), matching derive-product:
//   { error: "interpretation_failed", reason } — LLM failed; the page shows
//   "We hit an issue interpreting your brief. Refresh to try again."
//
// Pattern library writes are fail-soft per Phase 1's contract — a failed
// recordCampaignPattern() never blocks the interpretation from returning.
//
// Idempotency: a campaign_patterns row newer than brief.submitted_at means
// interpretation already ran for this brief version (double-fired page
// effect, refresh after success); the stored result is replayed instead of
// re-calling the LLM and polluting analog retrieval with duplicate rows.
// Resubmitting the brief updates submitted_at, so edits re-interpret.
// The replay check alone is read-then-act and racy — an interpretation_locks
// sentinel row (migration 022) makes it atomic: exactly one concurrent POST
// claims the (campaign, brief version) key; losers wait and replay the
// winner's stored result.

import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser, getCampaignById } from "@/lib/data/queries";
import { logEvent } from "@/lib/data/events";
import {
  getCampaignPatternById,
  getCampaignReasoning,
  getLatestCampaignPatternForCampaign,
  recordAnalogMatch,
  recordCampaignPattern,
  recordRingHypothesis,
} from "@/lib/data/reasoning-log";
import {
  claimInterpretation,
  releaseInterpretation,
} from "@/lib/data/interpretation-lock";
import { parseExclusions } from "@/lib/utils/parse-exclusions";
import { retrieveAnalogCampaigns } from "@/lib/discovery/pattern-library-retrieval";
import {
  callLLMWithFallback,
  createLLMClient,
  loadPrompt,
} from "@/lib/llm/client";
import { getEffectiveWeights } from "@/lib/scoring/weights";
import { isBriefV2 } from "@/lib/data/types";
import type Anthropic from "@anthropic-ai/sdk";
import type {
  AovBucket,
  BriefInterpretation,
  CampaignBriefV2,
  CampaignPatternRow,
  ConvictionBand,
  InterpretedRing,
  ProductDerivation,
} from "@/lib/data/types";

const MAX_LLM_TOKENS = 4096;
// The prompt asks for 2-4 laterals, 6 max. More than 6 persists anyway —
// let the data show what the model wanted to do — but gets a warning.
const LATERAL_SOFT_CAP = 6;
// Lock-loser wait: poll for the winner's persisted result. 20 × 2s covers
// a slow LLM pass; on timeout the loser returns a soft "in_progress" and
// the page's refresh path replays the winner's stored row.
const LOCK_WAIT_INTERVAL_MS = 2000;
const LOCK_WAIT_MAX_ATTEMPTS = 20;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(_request: NextRequest, context: RouteContext) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await context.params;
  const campaign = await getCampaignById(id);
  if (!campaign || campaign.user_id !== user.id) {
    return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
  }

  const brief = campaign.brief;
  if (!brief || !isBriefV2(brief) || !brief.submitted_at) {
    return NextResponse.json(
      { error: "Brief has not been submitted", code: "brief_not_submitted" },
      { status: 400 }
    );
  }

  const submittedAt = brief.submitted_at;
  // NaN guard: a malformed submitted_at can't be ordered against row
  // timestamps — skip replay entirely (fresh run) rather than risking a
  // wrong replay. The sentinel below is keyed on the raw string, so the
  // claim still works.
  const submittedMs = Date.parse(submittedAt);
  if (Number.isNaN(submittedMs)) {
    console.warn(
      "[interpret] brief.submitted_at is not a parseable timestamp:",
      submittedAt
    );
  }

  // Idempotency guard — replay a stored interpretation for this brief
  // version instead of running a second one.
  const existing = await getLatestCampaignPatternForCampaign(id);
  if (existing && !Number.isNaN(submittedMs)) {
    // Date-parse both sides: Supabase emits +00:00-suffixed timestamps,
    // submitted_at is Z-suffixed — string comparison would misorder.
    const createdMs = Date.parse(existing.created_at);
    if (!Number.isNaN(createdMs) && createdMs >= submittedMs) {
      const replayed = await replayInterpretation(existing);
      if (replayed) return NextResponse.json(replayed);
      // A newer row without a stored interpretation wasn't written by this
      // endpoint — fall through to a fresh run.
    }
  }

  // Atomic claim on (campaign, brief version) — closes the race where two
  // concurrent POSTs both pass the replay check above.
  if ((await claimInterpretation(id, submittedAt)) === "exists") {
    const waited = await waitForWinner(id, submittedAt, submittedMs);
    if (waited === "timeout") {
      return interpretationFailed(id, user.id, "in_progress");
    }
    if (waited !== "run_fresh") return NextResponse.json(waited);
    // Winner failed and released — we now hold the lock; run fresh.
  }

  // Every early return below this point must release the sentinel: a
  // failure leaves no replayable row, and a kept lock would turn the
  // page's "refresh to try again" into a dead end.
  const failAndRelease = async (
    reason: Parameters<typeof interpretationFailed>[2]
  ) => {
    await releaseInterpretation(id, submittedAt);
    return interpretationFailed(id, user.id, reason);
  };

  const resolved = await resolveBrief(brief, campaign.budget_total ?? null, user.id);
  if ("error" in resolved) {
    if (resolved.error === "forbidden") {
      return failAndRelease("reused_pattern_forbidden");
    }
    await releaseInterpretation(id, submittedAt);
    return NextResponse.json(
      { error: "Reused campaign pattern not found" },
      { status: 400 }
    );
  }

  // Defensive normalization — earlier layers should only ship low/mid/high,
  // but the bucket drives retrieval, weight tilt, and a CHECK-constrained
  // column, so unnormalized values must not get this far.
  resolved.aovBucket = normalizeAovBucket(resolved.aovBucket);
  resolved.derivation.aov_bucket =
    normalizeAovBucket(resolved.derivation.aov_bucket) ?? "mid";

  // Layer 1 wiring: analogs retrieved by category + AOV bucket from the
  // brand-confirmed derivations, injected into the prompt's pattern
  // library context. Empty library is a valid result. The campaign's own
  // prior pattern rows are excluded — a re-interpretation must not cite
  // its own stale interpretation as an analog.
  const analogs =
    resolved.aovBucket && resolved.category
      ? await retrieveAnalogCampaigns({
          aovBucket: resolved.aovBucket,
          category: resolved.category,
          excludeCampaignId: id,
        })
      : [];

  if (!process.env.ANTHROPIC_API_KEY) {
    await releaseInterpretation(id, submittedAt);
    return noApiKeyResponse();
  }

  let client: Anthropic;
  try {
    client = createLLMClient();
  } catch {
    await releaseInterpretation(id, submittedAt);
    return noApiKeyResponse();
  }

  let message: Anthropic.Message;
  try {
    message = await callLLMWithFallback({
      client,
      system: loadPrompt("interpret-brief.md"),
      userContent: buildUserContent(resolved, analogs),
      maxTokens: MAX_LLM_TOKENS,
    });
  } catch (err) {
    console.error(
      "[interpret] LLM call threw:",
      err instanceof Error ? err.message : err
    );
    return failAndRelease("llm_error");
  }

  if (message.stop_reason === "refusal") {
    return failAndRelease("refusal");
  }

  const textBlock = message.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    return failAndRelease("no_text_block");
  }

  // Parse fully before persisting anything — malformed output must leave
  // zero partial rows.
  const parsed = parseInterpretation(textBlock.text);
  if ("failure" in parsed) {
    return failAndRelease(parsed.failure);
  }
  const output = parsed.output;

  if (output.lateral_rings.length > LATERAL_SOFT_CAP) {
    console.warn(
      `[interpret] LLM returned ${output.lateral_rings.length} lateral rings (soft cap ${LATERAL_SOFT_CAP}); persisting all`
    );
  }

  const response = await persistInterpretation(
    id,
    user.id,
    resolved,
    output,
    analogs
  );

  if (!response.campaign_pattern_id) {
    // Fail-soft persistence left no replayable row — release so a refresh
    // can re-run instead of waiting on a lock that will never resolve.
    await releaseInterpretation(id, submittedAt);
  }

  await logEvent({
    eventType: "brief.interpretation_completed",
    entityType: "campaign",
    entityId: id,
    actorId: user.id,
    payload: {
      campaign_pattern_id: response.campaign_pattern_id,
      primary_ring_label: response.primary_ring.ring_label,
      lateral_ring_count: response.lateral_rings.length,
      analogs_retrieved: analogs.length,
      interpretation_confidence:
        response.campaign_pattern.interpretation_confidence,
    },
  });

  return NextResponse.json(response);
}

function noApiKeyResponse() {
  return NextResponse.json(
    {
      error:
        "AI interpretation is not configured. Please add an ANTHROPIC_API_KEY environment variable.",
      code: "NO_API_KEY",
    },
    { status: 503 }
  );
}

/**
 * Lock-loser path: another request owns this brief version (usually the
 * page effect double-firing). Poll until the winner's pattern row lands and
 * replay it, take over the lock if the winner failed and released, or time
 * out to a soft "in_progress".
 */
async function waitForWinner(
  campaignId: string,
  briefSubmittedAt: string,
  submittedMs: number
): Promise<BriefInterpretation | "run_fresh" | "timeout"> {
  for (let attempt = 0; attempt < LOCK_WAIT_MAX_ATTEMPTS; attempt++) {
    await sleep(LOCK_WAIT_INTERVAL_MS);
    const row = await getLatestCampaignPatternForCampaign(campaignId);
    if (row) {
      const createdMs = Date.parse(row.created_at);
      // With an unparseable submitted_at, any row with a stored
      // interpretation was written under this same lock key — replay it.
      const matchesBriefVersion = Number.isNaN(submittedMs)
        ? true
        : !Number.isNaN(createdMs) && createdMs >= submittedMs;
      if (matchesBriefVersion) {
        const replayed = await replayInterpretation(row);
        if (replayed) return replayed;
      }
    }
    if ((await claimInterpretation(campaignId, briefSubmittedAt)) === "acquired") {
      return "run_fresh";
    }
  }
  return "timeout";
}

// ============================================================
// Brief resolution — fresh vs returning brand
// ============================================================

interface ResolvedBrief {
  /** Brand-confirmed product derivation (fresh brief or prior pattern). */
  derivation: ProductDerivation;
  category: string;
  aovBucket: AovBucket | null;
  /** Canonical customer truth — new top-level value when present. */
  customerText: string;
  /** Canonical exclusions — new top-level value when present. */
  exclusionsText: string;
  goals: string[];
  goalsContext: string;
  budgetTotal: number | null;
  flight: CampaignBriefV2["flight"];
  returning: {
    previousSummary: string;
    deltaText: string | null;
    changedFields: NonNullable<
      NonNullable<CampaignBriefV2["customer_context"]>["changed_fields"]
    >;
    newProductUrl: string | null;
  } | null;
}

type ResolveBriefFailure = { error: "not_found" | "forbidden" };

/**
 * Resolve the interpretation inputs from the brief. Returning-brand briefs
 * (customer_context.reused_from_pattern_id) take product attributes from
 * the prior pattern row — unless the brand changed product URL and
 * confirmed a re-derivation, stored at customer_context.product_attributes,
 * which is canonical over the prior pattern — while new full values at the
 * brief top level (customer_text, exclusions_text) are canonical. The
 * changed_fields record is audit context for the prompt, not a source of
 * values. Fails when a reused pattern row can't be loaded or belongs to a
 * different user.
 */
async function resolveBrief(
  brief: CampaignBriefV2,
  budgetTotal: number | null,
  userId: string
): Promise<ResolvedBrief | ResolveBriefFailure> {
  const reusedPatternId = brief.customer_context?.reused_from_pattern_id;

  const common = {
    goals: brief.goals ?? [],
    goalsContext: brief.goals_context ?? "",
    budgetTotal,
    flight: brief.flight,
  };

  if (reusedPatternId) {
    const prior = await getCampaignPatternById(reusedPatternId);
    if (!prior) return { error: "not_found" };
    // Layer 3 validates ownership at submit; re-check here because the
    // reused id feeds another customer's data into this brand's prompt and
    // pattern row if it ever slips through.
    if (prior.customer_id !== userId) {
      console.warn(
        `[interpret] SECURITY: user ${userId} attempted to interpret with reused pattern ${reusedPatternId} owned by ${prior.customer_id}`
      );
      return { error: "forbidden" };
    }

    // Brand-confirmed re-derivation (product changed) overrides the prior
    // pattern for category, AOV bucket, and analog retrieval.
    const overrideAttrs = brief.customer_context?.product_attributes;
    const derivation = overrideAttrs
      ? extractDerivation(overrideAttrs as unknown as Record<string, unknown>)
      : extractDerivation(prior.product_attributes);
    const attrs = prior.product_attributes ?? {};
    const previousSummary =
      readStringAttr(attrs, "customer_summary") ||
      prior.customer_description ||
      "";

    return {
      ...common,
      derivation,
      category: derivation.category,
      aovBucket: overrideAttrs
        ? derivation.aov_bucket
        : (prior.aov_bucket ?? derivation.aov_bucket ?? null),
      customerText: brief.customer_text ?? prior.customer_description ?? "",
      exclusionsText: brief.exclusions_text ?? "",
      returning: {
        previousSummary,
        deltaText: brief.customer_context?.delta_text ?? null,
        changedFields: brief.customer_context?.changed_fields ?? {},
        newProductUrl: brief.customer_context?.product_url ?? null,
      },
    };
  }

  // Fresh brief — submit validation guarantees product + customer_text.
  const product = brief.product;
  const derivation: ProductDerivation = {
    brand_name: product?.brand_name ?? "",
    category: product?.category ?? "",
    product_description: product?.product_description ?? "",
    aov_bucket: product?.aov_bucket ?? "mid",
    aov_reasoning: product?.aov_reasoning ?? "",
    key_attributes: product?.key_attributes ?? [],
  };

  return {
    ...common,
    derivation,
    category: derivation.category,
    aovBucket: product?.aov_bucket ?? null,
    customerText: brief.customer_text ?? "",
    exclusionsText: brief.exclusions_text ?? "",
    returning: null,
  };
}

/**
 * Pull just the derivation fields out of a prior pattern's
 * product_attributes. Pattern rows written by this endpoint also carry
 * customer_summary / brief_context / interpretation — those belong to the
 * prior campaign and must not be copied into the new pattern.
 */
function extractDerivation(
  attrs: Record<string, unknown> | null | undefined
): ProductDerivation {
  const a = attrs ?? {};
  const bucket = a.aov_bucket;
  return {
    brand_name: readStringAttr(a, "brand_name"),
    category: readStringAttr(a, "category"),
    product_description: readStringAttr(a, "product_description"),
    aov_bucket:
      bucket === "low" || bucket === "mid" || bucket === "high"
        ? bucket
        : "mid",
    aov_reasoning: readStringAttr(a, "aov_reasoning"),
    key_attributes: Array.isArray(a.key_attributes)
      ? a.key_attributes.filter((v): v is string => typeof v === "string")
      : [],
  };
}

function readStringAttr(obj: Record<string, unknown>, key: string): string {
  const value = obj[key];
  return typeof value === "string" ? value : "";
}

/** Defensive: trim/lowercase and map to a valid bucket, else null. */
function normalizeAovBucket(value: unknown): AovBucket | null {
  if (typeof value !== "string") return null;
  const bucket = value.trim().toLowerCase();
  return bucket === "low" || bucket === "mid" || bucket === "high"
    ? bucket
    : null;
}

// ============================================================
// Prompt context construction
// ============================================================

function buildUserContent(
  resolved: ResolvedBrief,
  analogs: CampaignPatternRow[]
): string {
  const d = resolved.derivation;
  const lines: string[] = [
    "## Campaign brief",
    "",
    "Product:",
    `- Brand: ${d.brand_name}`,
    `- Category: ${d.category}`,
    `- Description: ${d.product_description}`,
    `- AOV bucket: ${d.aov_bucket}${d.aov_reasoning ? ` (${d.aov_reasoning})` : ""}`,
    `- Key attributes: ${d.key_attributes.join(", ") || "none provided"}`,
    "",
    "Customer (brand's own words):",
    resolved.customerText || "(none provided)",
    "",
    `Goals: ${resolved.goals.join(", ") || "none provided"}`,
  ];
  if (resolved.goalsContext) {
    lines.push(`Goals context: ${resolved.goalsContext}`);
  }
  lines.push(
    `Budget: ${
      resolved.budgetTotal !== null
        ? `$${resolved.budgetTotal.toLocaleString("en-US")}`
        : "not provided"
    }`,
    `Flight window: ${formatFlight(resolved.flight)}`,
    `Exclusions (raw): ${resolved.exclusionsText || "none provided"}`
  );

  lines.push("", "## Pattern library context", "");
  if (analogs.length === 0) {
    lines.push(
      "Pattern library is empty — reason from first principles. Label all confidence speculative or low."
    );
  } else {
    lines.push("Relevant prior campaigns from your library:", "");
    analogs.forEach((row, i) => {
      const attrs = row.product_attributes ?? {};
      const summary =
        readStringAttr(attrs, "customer_summary") ||
        row.customer_description ||
        "no customer summary recorded";
      lines.push(
        `${i + 1}. Brand: ${readStringAttr(attrs, "brand_name") || "unknown"} | Category: ${
          readStringAttr(attrs, "category") || "unknown"
        } | AOV bucket: ${row.aov_bucket ?? "unknown"} | Ran: ${
          row.created_at.slice(0, 10)
        }`,
        `   Customer: ${summary}`
      );
    });
  }

  if (resolved.returning) {
    const r = resolved.returning;
    lines.push(
      "",
      "## Returning-brand context",
      "",
      `This brand has run prior campaigns. Previous customer summary: ${
        r.previousSummary || "none recorded"
      }`
    );
    const changedEntries = Object.entries(r.changedFields);
    if (changedEntries.length > 0) {
      lines.push("Changed since last campaign (audit record — the new full values above are canonical):");
      for (const [field, change] of changedEntries) {
        lines.push(
          `- ${field}: before "${change?.before ?? ""}" → after "${change?.after ?? ""}"`
        );
      }
    } else if (r.deltaText) {
      lines.push(`Delta since last campaign: ${r.deltaText}`);
    } else {
      lines.push("Delta since last campaign: no changes reported.");
    }
    if (r.newProductUrl) {
      lines.push(`New product URL this campaign: ${r.newProductUrl}`);
    }
    lines.push("Previous ring outcomes: none recorded yet.");
  }

  return lines.join("\n");
}

function formatFlight(flight: CampaignBriefV2["flight"]): string {
  if (!flight) return "not provided";
  if (flight.mode === "preset") return flight.preset ?? "not provided";
  return `${flight.start_date ?? "?"} → ${flight.end_date ?? "?"}`;
}

// ============================================================
// LLM output parsing
// ============================================================

interface ParsedRing {
  ring_label: string;
  confidence: ConvictionBand;
  reasoning: string;
  analog_campaigns: string[];
}

interface ParsedInterpretation {
  customer_summary: string;
  interpretation_confidence: ConvictionBand;
  primary_ring: ParsedRing;
  lateral_rings: ParsedRing[];
}

type ParseResult =
  | { output: ParsedInterpretation }
  | { failure: "malformed_json" };

function parseInterpretation(raw: string): ParseResult {
  // Models occasionally wrap JSON in markdown fences despite instructions.
  const unfenced = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");

  let parsed: Record<string, unknown>;
  try {
    const value = JSON.parse(unfenced);
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return { failure: "malformed_json" };
    }
    parsed = value as Record<string, unknown>;
  } catch {
    return { failure: "malformed_json" };
  }

  const pattern = asRecord(parsed.campaign_pattern);
  const primaryRaw = asRecord(parsed.primary_ring);
  const customerSummary = pattern ? readStringAttr(pattern, "customer_summary") : "";
  const primary = primaryRaw ? parseRing(primaryRaw) : null;
  if (!customerSummary.trim() || !primary) {
    return { failure: "malformed_json" };
  }

  const lateralsRaw = Array.isArray(parsed.lateral_rings)
    ? parsed.lateral_rings
    : [];
  const laterals: ParsedRing[] = [];
  for (const entry of lateralsRaw) {
    const record = asRecord(entry);
    const ring = record ? parseRing(record) : null;
    if (ring) {
      laterals.push(ring);
    } else {
      console.warn("[interpret] dropping lateral ring without a label:", entry);
    }
  }

  // The prompt asks for at least 2 laterals; zero is accepted (the primary
  // read alone is still an interpretation) but warned — Layer 5 must
  // render the lateral section gracefully when empty.
  if (laterals.length === 0) {
    console.warn(
      "[interpret] LLM returned zero lateral rings — accepting with primary only"
    );
  }

  return {
    output: {
      customer_summary: customerSummary,
      interpretation_confidence: readConfidence(
        pattern?.interpretation_confidence
      ),
      primary_ring: primary,
      lateral_rings: laterals,
    },
  };
}

function parseRing(record: Record<string, unknown>): ParsedRing | null {
  const label = readStringAttr(record, "ring_label");
  if (!label.trim()) return null;
  return {
    ring_label: label,
    confidence: readConfidence(record.confidence),
    reasoning: readStringAttr(record, "reasoning"),
    analog_campaigns: Array.isArray(record.analog_campaigns)
      ? record.analog_campaigns.filter(
          (v): v is string => typeof v === "string"
        )
      : [],
  };
}

function readConfidence(value: unknown): ConvictionBand {
  if (
    value === "high" ||
    value === "medium" ||
    value === "low" ||
    value === "speculative"
  ) {
    return value;
  }
  console.warn(
    "[interpret] invalid confidence from LLM, defaulting to speculative:",
    value
  );
  return "speculative";
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

// ============================================================
// Persistence — fail-soft, never blocks the response
// ============================================================

/**
 * Effective scoring weights for the pattern record. getEffectiveWeights()
 * keeps a backwards-compat fast path when no Phase 2 dimension is non-zero,
 * so high-AOV briefs must opt in for the tilt to apply (purchasePower 0.20,
 * reach 0.05). Low/mid buckets stay on the legacy 4-dimension defaults.
 */
function effectiveWeightsForBucket(aovBucket: AovBucket | null) {
  return getEffectiveWeights(
    undefined,
    aovBucket === "high" ? { purchasePower: 0.2 } : undefined,
    aovBucket ? { aovBucket } : undefined
  );
}

async function persistInterpretation(
  campaignId: string,
  userId: string,
  resolved: ResolvedBrief,
  output: ParsedInterpretation,
  analogs: CampaignPatternRow[]
): Promise<BriefInterpretation> {
  const weights = effectiveWeightsForBucket(resolved.aovBucket);
  // Server-side parse of the raw exclusions text — a deterministic split,
  // not something the LLM output schema is trusted with.
  const exclusionsParsed = parseExclusions(resolved.exclusionsText);

  const interpretationBlob = {
    campaign_pattern: {
      customer_summary: output.customer_summary,
      interpretation_confidence: output.interpretation_confidence,
      exclusions_parsed: exclusionsParsed,
    },
    primary_ring: output.primary_ring,
    lateral_rings: output.lateral_rings,
  };

  const patternId = await recordCampaignPattern({
    campaignId,
    customerId: userId,
    productAttributes: {
      ...resolved.derivation,
      customer_summary: output.customer_summary,
      interpretation_confidence: output.interpretation_confidence,
      brief_context: {
        goals: resolved.goals,
        goals_context: resolved.goalsContext,
        budget_total: resolved.budgetTotal,
        flight: resolved.flight ?? null,
        exclusions_text: resolved.exclusionsText,
        exclusions_parsed: exclusionsParsed,
      },
      // Full parsed LLM response — training data, and the replay source
      // for the idempotency guard.
      interpretation: interpretationBlob,
    },
    customerDescription: resolved.customerText || null,
    aovBucket: resolved.aovBucket,
    scoringWeights: weights as unknown as Record<string, unknown>,
  });

  if (!patternId) {
    // Fail-soft: the brand still gets their interpretation; ring/analog
    // rows are skipped because they need the pattern foreign key.
    console.error(
      "[interpret] recordCampaignPattern failed — returning interpretation without persistence"
    );
    return toResponse(null, output, new Map(), exclusionsParsed);
  }

  const ringIds = new Map<string, string | null>();
  ringIds.set(
    output.primary_ring.ring_label,
    await recordRingHypothesis({
      campaignPatternId: patternId,
      kind: "primary",
      label: output.primary_ring.ring_label,
      reasoning: output.primary_ring.reasoning || null,
      confidence: output.primary_ring.confidence,
    })
  );
  for (const ring of output.lateral_rings) {
    ringIds.set(
      ring.ring_label,
      await recordRingHypothesis({
        campaignPatternId: patternId,
        kind: "lateral",
        label: ring.ring_label,
        reasoning: ring.reasoning || null,
        confidence: ring.confidence,
      })
    );
  }

  await recordAnalogCitations(patternId, output, analogs);

  return toResponse(patternId, output, ringIds, exclusionsParsed);
}

/**
 * One analog_matches row per unique cited analog that matches a campaign
 * in the retrieved library context (case-insensitive brand name). A cited
 * name with no library match is never fabricated into a row — warn and
 * skip; the interpretation_confidence label already captures the
 * speculative state.
 */
async function recordAnalogCitations(
  patternId: string,
  output: ParsedInterpretation,
  analogs: CampaignPatternRow[]
): Promise<void> {
  const library = new Map<string, { canonical: string; patternId: string }>();
  for (const row of analogs) {
    const name = readStringAttr(row.product_attributes ?? {}, "brand_name");
    if (name.trim()) {
      library.set(name.trim().toLowerCase(), {
        canonical: name.trim(),
        patternId: row.id,
      });
    }
  }

  const citedBy = new Map<
    string,
    { analogPatternId: string; ringLabels: string[] }
  >();
  const allRings = [output.primary_ring, ...output.lateral_rings];
  for (const ring of allRings) {
    for (const cited of ring.analog_campaigns) {
      const key = cited.trim().toLowerCase();
      if (!key) continue;
      const match = library.get(key);
      if (!match) {
        console.warn(
          `[interpret] LLM cited analog "${cited}" not in the pattern library context — skipping analog_matches row`
        );
        continue;
      }
      const entry = citedBy.get(match.canonical) ?? {
        analogPatternId: match.patternId,
        ringLabels: [],
      };
      entry.ringLabels.push(ring.ring_label);
      citedBy.set(match.canonical, entry);
    }
  }

  for (const [analogName, { analogPatternId, ringLabels }] of citedBy) {
    await recordAnalogMatch({
      campaignPatternId: patternId,
      analogName,
      reasoning: `Cited by ring(s): ${ringLabels.join(", ")}`,
      analogPatternId,
    });
  }
}

function toResponse(
  patternId: string | null,
  output: ParsedInterpretation,
  ringIds: Map<string, string | null>,
  exclusionsParsed: string[]
): BriefInterpretation {
  const toRing = (ring: ParsedRing): InterpretedRing => ({
    ring_hypothesis_id: ringIds.get(ring.ring_label) ?? null,
    ring_label: ring.ring_label,
    confidence: ring.confidence,
    reasoning: ring.reasoning,
    analog_campaigns: ring.analog_campaigns,
  });
  return {
    campaign_pattern_id: patternId,
    campaign_pattern: {
      customer_summary: output.customer_summary,
      interpretation_confidence: output.interpretation_confidence,
      exclusions_parsed: exclusionsParsed,
    },
    primary_ring: toRing(output.primary_ring),
    lateral_rings: output.lateral_rings.map(toRing),
  };
}

// ============================================================
// Idempotent replay
// ============================================================

/**
 * Rebuild the response from a pattern row this endpoint wrote earlier:
 * the full parsed LLM output stored at product_attributes.interpretation,
 * with ring hypothesis ids re-attached by label from ring_hypotheses.
 * Returns null when the row carries no stored interpretation (it wasn't
 * written by this endpoint), letting the caller run a fresh pass.
 */
async function replayInterpretation(
  pattern: CampaignPatternRow
): Promise<BriefInterpretation | null> {
  const stored = asRecord(pattern.product_attributes?.interpretation);
  if (!stored) return null;

  const patternData = asRecord(stored.campaign_pattern);
  const primaryRaw = asRecord(stored.primary_ring);
  const primary = primaryRaw ? parseRing(primaryRaw) : null;
  if (!patternData || !primary) return null;

  const laterals: ParsedRing[] = [];
  if (Array.isArray(stored.lateral_rings)) {
    for (const entry of stored.lateral_rings) {
      const record = asRecord(entry);
      const ring = record ? parseRing(record) : null;
      if (ring) laterals.push(ring);
    }
  }

  const reasoning = await getCampaignReasoning(pattern.id);
  const ringIds = new Map<string, string | null>();
  for (const row of reasoning.rings) {
    const label = typeof row.label === "string" ? row.label : "";
    const id = typeof row.id === "string" ? row.id : null;
    if (label && !ringIds.has(label)) ringIds.set(label, id);
  }

  // Stored blob carries exclusions_parsed: server-parsed on new rows,
  // LLM-parsed on rows written before the Layer 4 amendment. Both replay.
  const exclusionsParsed = Array.isArray(patternData.exclusions_parsed)
    ? patternData.exclusions_parsed.filter(
        (v): v is string => typeof v === "string"
      )
    : [];

  return toResponse(
    pattern.id,
    {
      customer_summary: readStringAttr(patternData, "customer_summary"),
      interpretation_confidence: readConfidence(
        patternData.interpretation_confidence
      ),
      primary_ring: primary,
      lateral_rings: laterals,
    },
    ringIds,
    exclusionsParsed
  );
}

// ============================================================
// Failure path
// ============================================================

async function interpretationFailed(
  campaignId: string,
  actorId: string,
  reason:
    | "llm_error"
    | "refusal"
    | "no_text_block"
    | "malformed_json"
    | "in_progress"
    | "reused_pattern_forbidden"
) {
  await logEvent({
    eventType: "brief.interpretation_failed",
    entityType: "campaign",
    entityId: campaignId,
    actorId,
    payload: { reason },
  });
  return NextResponse.json({ error: "interpretation_failed", reason });
}
