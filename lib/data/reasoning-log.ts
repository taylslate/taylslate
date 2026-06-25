// Reasoning persistence for the discovery agent (Wave 14 Phase 1).
//
// This is the discipline that makes the pattern library compound: every
// time the AI reasons (brief interpretation, ring hypothesis, conviction
// score, analog match), we write a structured record. By the time Phase 2
// surfaces the reasoning in UI, we've already accumulated training data.
//
// Same fail-soft contract as event-log.ts and events.ts: NEVER throw,
// NEVER block the main flow. Reasoning rows are valuable but losing one
// is far less bad than failing the user-facing operation.
//
// Phase 1 ships these helpers; Phase 2 wires them into the discovery agent.

import { supabaseAdmin } from "@/lib/supabase/admin";
import type {
  BrandDecision,
  CampaignPatternRow,
  ConvictionScoreRow,
  ConvictionTier,
  CostBasis,
  RingHypothesisRow,
  Show,
} from "@/lib/data/types";

// ============================================================
// campaign_patterns
// ============================================================

export interface RecordCampaignPatternInput {
  campaignId: string | null | undefined;
  customerId: string | null | undefined;
  productAttributes: Record<string, unknown>;
  customerDescription?: string | null;
  aovBucket?: "low" | "mid" | "high" | null;
  scoringWeights?: Record<string, unknown> | null;
}

export async function recordCampaignPattern(
  input: RecordCampaignPatternInput
): Promise<string | null> {
  if (!input.customerId) return null;
  try {
    const { data, error } = await supabaseAdmin
      .from("campaign_patterns")
      .insert({
        campaign_id: input.campaignId ?? null,
        customer_id: input.customerId,
        product_attributes: input.productAttributes,
        customer_description: input.customerDescription ?? null,
        aov_bucket: input.aovBucket ?? null,
        scoring_weights: input.scoringWeights ?? null,
      })
      .select("id")
      .single<{ id: string }>();
    if (error || !data) {
      console.warn(
        "[reasoning-log.recordCampaignPattern] insert failed:",
        error?.message
      );
      return null;
    }
    return data.id;
  } catch (err) {
    console.warn(
      "[reasoning-log.recordCampaignPattern] threw:",
      err instanceof Error ? err.message : err
    );
    return null;
  }
}

// ============================================================
// Atomic interpretation persist (Wave 14 Phase 2A, migration 024)
// ============================================================

export interface PersistInterpretationRing {
  // 'primary' or 'lateral' — see RecordRingHypothesisInput.kind.
  kind: "primary" | "lateral";
  label: string;
  reasoning: string | null;
  confidence: "high" | "medium" | "low" | "speculative";
}

export interface PersistInterpretationAnalog {
  analogName: string;
  reasoning: string | null;
  /** campaign_patterns row the analog was retrieved from (migration 022). */
  analogPatternId: string | null;
}

export interface PersistInterpretationInput {
  campaignId: string | null | undefined;
  customerId: string | null | undefined;
  productAttributes: Record<string, unknown>;
  customerDescription?: string | null;
  aovBucket?: "low" | "mid" | "high" | null;
  scoringWeights?: Record<string, unknown> | null;
  rings: PersistInterpretationRing[];
  analogs: PersistInterpretationAnalog[];
}

export interface PersistInterpretationResult {
  patternId: string;
  /** Ring hypothesis ids keyed by ring label, for response reconstruction. */
  ringIds: Record<string, string>;
}

/**
 * Persist a full brief interpretation — campaign_pattern + every ring +
 * every analog match — in ONE Postgres transaction via the
 * persist_interpretation RPC (migration 024). Either the whole interpretation
 * becomes visible or none of it does, so a concurrent lock-loser reading the
 * pattern row back can never observe a half-written interpretation, and a
 * crash mid-write leaves no orphan pattern row.
 *
 * IMPORTANT: call this only AFTER the LLM has returned. The transaction opens
 * and closes entirely inside this RPC (milliseconds); the model call must
 * never sit inside the transaction boundary.
 *
 * Fail-soft like the rest of this module: returns null on any failure (the
 * caller still returns the interpretation to the brand, just unpersisted).
 */
export async function persistInterpretationAtomic(
  input: PersistInterpretationInput
): Promise<PersistInterpretationResult | null> {
  if (!input.customerId) return null;
  try {
    const { data, error } = await supabaseAdmin.rpc("persist_interpretation", {
      p_campaign_id: input.campaignId ?? null,
      p_customer_id: input.customerId,
      p_product_attributes: input.productAttributes,
      p_customer_description: input.customerDescription ?? null,
      p_aov_bucket: input.aovBucket ?? null,
      p_scoring_weights: input.scoringWeights ?? null,
      p_rings: input.rings.map((r) => ({
        kind: r.kind,
        label: r.label,
        reasoning: r.reasoning,
        confidence: r.confidence,
      })),
      p_analogs: input.analogs.map((a) => ({
        analog_name: a.analogName,
        reasoning: a.reasoning,
        analog_pattern_id: a.analogPatternId,
      })),
    });
    if (error || !data) {
      console.warn(
        "[reasoning-log.persistInterpretationAtomic] rpc failed:",
        error?.message
      );
      return null;
    }
    const result = data as {
      pattern_id?: string;
      ring_ids?: Record<string, string>;
    };
    if (!result.pattern_id) {
      console.warn(
        "[reasoning-log.persistInterpretationAtomic] rpc returned no pattern_id"
      );
      return null;
    }
    return { patternId: result.pattern_id, ringIds: result.ring_ids ?? {} };
  } catch (err) {
    console.warn(
      "[reasoning-log.persistInterpretationAtomic] threw:",
      err instanceof Error ? err.message : err
    );
    return null;
  }
}

// ============================================================
// ring_hypotheses
// ============================================================

export interface RecordRingHypothesisInput {
  campaignPatternId: string;
  // 'confirmed' as a kind is legacy from migration 019. New code uses
  // 'primary' or 'lateral'; brand state lives on brandDecision.
  kind: "primary" | "lateral" | "confirmed";
  label: string;
  reasoning?: string | null;
  confidence: "high" | "medium" | "low" | "speculative";
  confidenceScore?: number | null;
  // Defaults to 'pending' when omitted — matches the column default in
  // migration 021. Phase 2A interpretation writes pending; the confirm
  // step transitions rings to confirmed/rejected/refined/added_by_brand.
  brandDecision?: BrandDecision;
  // Stable display slot (migration 025). Add-ring passes the next available
  // slot; omitted elsewhere (interpretation/refinement set it in the RPC).
  slotPosition?: number | null;
}

export async function recordRingHypothesis(
  input: RecordRingHypothesisInput
): Promise<string | null> {
  try {
    const { data, error } = await supabaseAdmin
      .from("ring_hypotheses")
      .insert({
        campaign_pattern_id: input.campaignPatternId,
        kind: input.kind,
        label: input.label,
        reasoning: input.reasoning ?? null,
        confidence: input.confidence,
        confidence_score: input.confidenceScore ?? null,
        brand_decision: input.brandDecision ?? "pending",
        slot_position: input.slotPosition ?? null,
      })
      .select("id")
      .single<{ id: string }>();
    if (error || !data) {
      console.warn(
        "[reasoning-log.recordRingHypothesis] insert failed:",
        error?.message
      );
      return null;
    }
    return data.id;
  } catch (err) {
    console.warn(
      "[reasoning-log.recordRingHypothesis] threw:",
      err instanceof Error ? err.message : err
    );
    return null;
  }
}

/**
 * Update a single ring's brand_decision (Wave 14 Phase 2A Layer 5).
 * The confirm step writes confirmed/rejected/added_by_brand; the refine step
 * marks a replaced ring 'refined'. Fail-soft like the rest of this module:
 * returns false on any failure (the caller decides whether to surface it).
 */
export async function updateRingDecision(
  ringHypothesisId: string,
  decision: BrandDecision
): Promise<boolean> {
  try {
    const { error } = await supabaseAdmin
      .from("ring_hypotheses")
      .update({ brand_decision: decision })
      .eq("id", ringHypothesisId);
    if (error) {
      console.warn(
        "[reasoning-log.updateRingDecision] update failed:",
        error.message
      );
      return false;
    }
    return true;
  } catch (err) {
    console.warn(
      "[reasoning-log.updateRingDecision] threw:",
      err instanceof Error ? err.message : err
    );
    return false;
  }
}

// ============================================================
// Atomic ring refinement (Wave 14 Phase 2A Layer 5, migration 025)
// ============================================================

export interface PersistRefinementInput {
  oldRingId: string;
  campaignPatternId: string;
  kind: "primary" | "lateral";
  label: string;
  reasoning: string | null;
  confidence: "high" | "medium" | "low" | "speculative";
}

export interface PersistRefinementResult {
  newRingId: string;
  slotPosition: number | null;
}

/**
 * Insert a refined replacement ring AND mark the old ring 'refined' in ONE
 * transaction via the persist_refinement RPC (migration 025). Replaces the
 * old non-atomic insert-then-update sequence: either both land or neither
 * does, so a mid-write failure can never orphan a slot. The replacement
 * inherits the predecessor's slot_position so the page keeps stable ordering.
 *
 * Fail-soft like the rest of this module: returns null on any RPC failure.
 * The route maps null to a 500 (a persistence failure is no longer silently
 * soft-failed to 200).
 */
export async function persistRefinementAtomic(
  input: PersistRefinementInput
): Promise<PersistRefinementResult | null> {
  try {
    const { data, error } = await supabaseAdmin.rpc("persist_refinement", {
      p_old_ring_id: input.oldRingId,
      p_campaign_pattern_id: input.campaignPatternId,
      p_kind: input.kind,
      p_label: input.label,
      p_reasoning: input.reasoning,
      p_confidence: input.confidence,
    });
    if (error || !data) {
      console.warn(
        "[reasoning-log.persistRefinementAtomic] rpc failed:",
        error?.message
      );
      return null;
    }
    const result = data as { new_ring_id?: string; slot_position?: number | null };
    if (!result.new_ring_id) {
      console.warn(
        "[reasoning-log.persistRefinementAtomic] rpc returned no new_ring_id"
      );
      return null;
    }
    return {
      newRingId: result.new_ring_id,
      slotPosition: result.slot_position ?? null,
    };
  } catch (err) {
    console.warn(
      "[reasoning-log.persistRefinementAtomic] threw:",
      err instanceof Error ? err.message : err
    );
    return null;
  }
}

// ============================================================
// Atomic interpretation confirmation (Wave 14 Phase 2A Layer 5, migration 025)
// ============================================================

// Validation failures inside persist_confirmation raise with this SQLSTATE —
// an unknown ring, a refined ring, or an invalid decision. Surfaced by
// PostgREST in error.code; the route maps it to a 400. Any other failure is a
// genuine DB error → 500.
const CONFIRMATION_VALIDATION_SQLSTATE = "PT400";

export type PersistConfirmationResult =
  | { ok: true; confirmed: number; rejected: number }
  | { ok: false; reason: "validation" | "error" };

/**
 * Write every brand decision for a confirmed interpretation in ONE
 * transaction via the persist_confirmation RPC (migration 025). The function
 * validates each {id, decision} inside the transaction — the ring must belong
 * to the pattern AND not be 'refined', and the decision must be one the brand
 * can set — so a bad entry rolls the whole confirm back rather than committing
 * a partial state.
 *
 * Returns a discriminated result: 'validation' for a malformed/stale request
 * (route → 400), 'error' for any genuine DB failure (route → 500). Never
 * throws.
 */
export async function persistConfirmationAtomic(
  campaignPatternId: string,
  decisions: Array<{ id?: string; decision?: string }>
): Promise<PersistConfirmationResult> {
  try {
    const { data, error } = await supabaseAdmin.rpc("persist_confirmation", {
      p_campaign_pattern_id: campaignPatternId,
      p_decisions: decisions,
    });
    if (error) {
      const validation =
        error.code === CONFIRMATION_VALIDATION_SQLSTATE ||
        (error.message ?? "").includes("persist_confirmation:");
      console.warn(
        "[reasoning-log.persistConfirmationAtomic] rpc failed:",
        error.message
      );
      return { ok: false, reason: validation ? "validation" : "error" };
    }
    const result = (data ?? {}) as { confirmed?: number; rejected?: number };
    return {
      ok: true,
      confirmed: result.confirmed ?? 0,
      rejected: result.rejected ?? 0,
    };
  } catch (err) {
    console.warn(
      "[reasoning-log.persistConfirmationAtomic] threw:",
      err instanceof Error ? err.message : err
    );
    return { ok: false, reason: "error" };
  }
}

// ============================================================
// conviction_scores
// ============================================================

export interface RecordConvictionScoreInput {
  campaignPatternId: string;
  showId: string;
  ringHypothesisId?: string | null;
  audienceFitScore?: number | null;
  topicalRelevanceScore?: number | null;
  purchasePowerScore?: number | null;
  compositeScore?: number | null;
  convictionBand?: "high" | "medium" | "low" | "speculative" | null;
  reasoning?: string | null;
  tier?: "test" | "scale" | "dropped" | null;
}

export async function recordConvictionScore(
  input: RecordConvictionScoreInput
): Promise<void> {
  try {
    const { error } = await supabaseAdmin.from("conviction_scores").insert({
      campaign_pattern_id: input.campaignPatternId,
      show_id: input.showId,
      ring_hypothesis_id: input.ringHypothesisId ?? null,
      audience_fit_score: input.audienceFitScore ?? null,
      topical_relevance_score: input.topicalRelevanceScore ?? null,
      purchase_power_score: input.purchasePowerScore ?? null,
      composite_score: input.compositeScore ?? null,
      conviction_band: input.convictionBand ?? null,
      reasoning: input.reasoning ?? null,
      tier: input.tier ?? null,
    });
    if (error) {
      console.warn(
        "[reasoning-log.recordConvictionScore] insert failed:",
        error.message
      );
    }
  } catch (err) {
    console.warn(
      "[reasoning-log.recordConvictionScore] threw:",
      err instanceof Error ? err.message : err
    );
  }
}

// ============================================================
// Wave 14 Phase 2B Layer 3 — orchestrator readers/writers
// ============================================================

/**
 * Confirmed rings for a campaign pattern — the rings Layer 3 scores against.
 * Returns only rows the brand kept: brand_decision IN ('confirmed',
 * 'added_by_brand'). Rejected / refined / pending rings are excluded (a
 * refined ring's replacement carries its own confirmed/pending decision).
 * Ordered by slot_position so callers see primary first, then laterals.
 *
 * Fail-soft like the rest of this module: returns [] on any failure.
 */
export async function getConfirmedRings(
  campaignPatternId: string
): Promise<RingHypothesisRow[]> {
  try {
    const { data, error } = await supabaseAdmin
      .from("ring_hypotheses")
      .select("*")
      .eq("campaign_pattern_id", campaignPatternId)
      .in("brand_decision", ["confirmed", "added_by_brand"])
      .order("slot_position", { ascending: true, nullsFirst: false });
    if (error) {
      console.warn(
        "[reasoning-log.getConfirmedRings] read failed:",
        error.message
      );
      return [];
    }
    return (data ?? []) as RingHypothesisRow[];
  } catch (err) {
    console.warn(
      "[reasoning-log.getConfirmedRings] threw:",
      err instanceof Error ? err.message : err
    );
    return [];
  }
}

/**
 * Delete all conviction scores for a campaign pattern. Layer 3 re-runs use
 * replace semantics (clear, then re-insert) because conviction_scores has no
 * unique constraint on (show, ring) and the surface sorts by composite — an
 * append would double-list a show on re-run. Fail-soft: returns false on
 * failure so a clear miss never blocks a fresh scoring run.
 */
export async function clearConvictionScores(
  campaignPatternId: string
): Promise<boolean> {
  try {
    const { error } = await supabaseAdmin
      .from("conviction_scores")
      .delete()
      .eq("campaign_pattern_id", campaignPatternId);
    if (error) {
      console.warn(
        "[reasoning-log.clearConvictionScores] delete failed:",
        error.message
      );
      return false;
    }
    return true;
  } catch (err) {
    console.warn(
      "[reasoning-log.clearConvictionScores] threw:",
      err instanceof Error ? err.message : err
    );
    return false;
  }
}

// ============================================================
// analog_matches
// ============================================================

export interface RecordAnalogMatchInput {
  campaignPatternId: string;
  analogName: string;
  reasoning?: string | null;
  similarityScore?: number | null;
  /** The campaign_patterns row the analog was retrieved from (migration 022). */
  analogPatternId?: string | null;
}

export async function recordAnalogMatch(
  input: RecordAnalogMatchInput
): Promise<void> {
  try {
    const { error } = await supabaseAdmin.from("analog_matches").insert({
      campaign_pattern_id: input.campaignPatternId,
      analog_name: input.analogName,
      reasoning: input.reasoning ?? null,
      similarity_score: input.similarityScore ?? null,
      analog_pattern_id: input.analogPatternId ?? null,
    });
    if (error) {
      console.warn(
        "[reasoning-log.recordAnalogMatch] insert failed:",
        error.message
      );
    }
  } catch (err) {
    console.warn(
      "[reasoning-log.recordAnalogMatch] threw:",
      err instanceof Error ? err.message : err
    );
  }
}

// ============================================================
// founder_annotations
// ============================================================

export interface RecordFounderAnnotationInput {
  showId: string;
  authorId?: string | null;
  note: string;
  tags?: string[];
}

export async function recordFounderAnnotation(
  input: RecordFounderAnnotationInput
): Promise<void> {
  try {
    const { error } = await supabaseAdmin.from("founder_annotations").insert({
      show_id: input.showId,
      author_id: input.authorId ?? null,
      note: input.note,
      tags: input.tags ?? [],
    });
    if (error) {
      console.warn(
        "[reasoning-log.recordFounderAnnotation] insert failed:",
        error.message
      );
    }
  } catch (err) {
    console.warn(
      "[reasoning-log.recordFounderAnnotation] threw:",
      err instanceof Error ? err.message : err
    );
  }
}

// ============================================================
// Reader helper — returning-brand detection (Wave 14 2A)
// ============================================================

/**
 * Most recent campaign_patterns row for a customer, or null if they have
 * none (first-time brand) or the read fails. Fail-soft like everything
 * else in this module.
 *
 * Layer 4 coordination: the check-in copy wants the AI-derived
 * customer_summary, which has no column yet — Layer 4 decides where it
 * lands. Until then, callers read
 * `product_attributes.customer_summary ?? customer_description`.
 */
export async function getLatestCampaignPatternForCustomer(
  customerId: string
): Promise<CampaignPatternRow | null> {
  try {
    const { data, error } = await supabaseAdmin
      .from("campaign_patterns")
      .select("*")
      .eq("customer_id", customerId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle<CampaignPatternRow>();
    if (error) {
      console.warn(
        "[reasoning-log.getLatestCampaignPatternForCustomer] read failed:",
        error.message
      );
      return null;
    }
    return data ?? null;
  } catch (err) {
    console.warn(
      "[reasoning-log.getLatestCampaignPatternForCustomer] threw:",
      err instanceof Error ? err.message : err
    );
    return null;
  }
}

/**
 * Most recent campaign_patterns row for a campaign, or null. Fail-soft.
 * The interpret endpoint's idempotency guard: a pattern row created after
 * the brief's submitted_at means interpretation already ran for this brief
 * version, so the stored result is replayed instead of re-calling the LLM.
 */
export async function getLatestCampaignPatternForCampaign(
  campaignId: string
): Promise<CampaignPatternRow | null> {
  try {
    const { data, error } = await supabaseAdmin
      .from("campaign_patterns")
      .select("*")
      .eq("campaign_id", campaignId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle<CampaignPatternRow>();
    if (error) {
      console.warn(
        "[reasoning-log.getLatestCampaignPatternForCampaign] read failed:",
        error.message
      );
      return null;
    }
    return data ?? null;
  } catch (err) {
    console.warn(
      "[reasoning-log.getLatestCampaignPatternForCampaign] threw:",
      err instanceof Error ? err.message : err
    );
    return null;
  }
}

/** Single campaign_patterns row by id, or null. Fail-soft. */
export async function getCampaignPatternById(
  id: string
): Promise<CampaignPatternRow | null> {
  try {
    const { data, error } = await supabaseAdmin
      .from("campaign_patterns")
      .select("*")
      .eq("id", id)
      .maybeSingle<CampaignPatternRow>();
    if (error) {
      console.warn(
        "[reasoning-log.getCampaignPatternById] read failed:",
        error.message
      );
      return null;
    }
    return data ?? null;
  } catch (err) {
    console.warn(
      "[reasoning-log.getCampaignPatternById] threw:",
      err instanceof Error ? err.message : err
    );
    return null;
  }
}

// ============================================================
// Reader helper — pull all reasoning for a campaign
// ============================================================

export interface CampaignReasoning {
  pattern: Record<string, unknown> | null;
  rings: Array<Record<string, unknown>>;
  convictionScores: Array<Record<string, unknown>>;
  analogs: Array<Record<string, unknown>>;
}

export async function getCampaignReasoning(
  campaignPatternId: string
): Promise<CampaignReasoning> {
  const empty: CampaignReasoning = {
    pattern: null,
    rings: [],
    convictionScores: [],
    analogs: [],
  };
  try {
    const [patternRes, ringsRes, scoresRes, analogsRes] = await Promise.all([
      supabaseAdmin
        .from("campaign_patterns")
        .select("*")
        .eq("id", campaignPatternId)
        .single(),
      supabaseAdmin
        .from("ring_hypotheses")
        .select("*")
        .eq("campaign_pattern_id", campaignPatternId)
        .order("created_at"),
      supabaseAdmin
        .from("conviction_scores")
        .select("*")
        .eq("campaign_pattern_id", campaignPatternId)
        .order("composite_score", { ascending: false }),
      supabaseAdmin
        .from("analog_matches")
        .select("*")
        .eq("campaign_pattern_id", campaignPatternId)
        .order("similarity_score", { ascending: false }),
    ]);
    return {
      pattern: patternRes.data ?? null,
      rings: ringsRes.data ?? [],
      convictionScores: scoresRes.data ?? [],
      analogs: analogsRes.data ?? [],
    };
  } catch (err) {
    console.warn(
      "[reasoning-log.getCampaignReasoning] threw:",
      err instanceof Error ? err.message : err
    );
    return empty;
  }
}

// ============================================================
// Wave 14 Phase 2B Layer 5 — discovery view read
// ============================================================

/** One scored show within a ring group: the conviction_scores row plus the
 *  embedded shows row (null only if the FK target vanished — ON DELETE CASCADE
 *  makes this effectively unreachable, but the view guards for it anyway). */
export interface ConvictionUniverseShow {
  score: ConvictionScoreRow;
  show: Show | null;
}

/** One ring and the shows that scored medium+ against it, composite desc. */
export interface ConvictionUniverseGroup {
  ring: RingHypothesisRow;
  shows: ConvictionUniverseShow[];
}

/** The full scored universe for a campaign pattern, ready for Layer 5 to
 *  render. `rings` is the confirmed ring order (primary first); `groups`
 *  mirrors it. `hasScores` is the trigger gate: false means discovery has not
 *  run yet for this pattern (confirmed rings exist, no conviction_scores), so
 *  the view auto-fires POST /discover. */
export interface ConvictionUniverse {
  rings: RingHypothesisRow[];
  groups: ConvictionUniverseGroup[];
  hasScores: boolean;
}

// ============================================================
// Wave 14 Phase 2C Layer 2 — tier classifier persistence
// ============================================================

/**
 * All conviction_scores rows for a campaign pattern, typed. Single round trip,
 * fail-soft (returns [] on any failure). The tier pass (lib/discovery/
 * tier-portfolio.ts) reads these to roll up per show and classify; unlike
 * getConvictionUniverse it does NOT filter to confirmed rings or embed shows —
 * the pass must see every row so it can rewrite `tier` on all of them.
 */
export async function getConvictionScoresForPattern(
  campaignPatternId: string
): Promise<ConvictionScoreRow[]> {
  try {
    const { data, error } = await supabaseAdmin
      .from("conviction_scores")
      .select("*")
      .eq("campaign_pattern_id", campaignPatternId)
      .order("composite_score", { ascending: false });
    if (error) {
      console.warn(
        "[reasoning-log.getConvictionScoresForPattern] read failed:",
        error.message
      );
      return [];
    }
    return (data ?? []) as ConvictionScoreRow[];
  } catch (err) {
    console.warn(
      "[reasoning-log.getConvictionScoresForPattern] threw:",
      err instanceof Error ? err.message : err
    );
    return [];
  }
}

/** A conviction_scores row with its embedded shows row (null only if the FK
 *  target vanished). The flat per-(show, ring) shape the tier reader rolls up. */
export type ConvictionScoreWithShow = ConvictionScoreRow & { show: Show | null };

/**
 * All conviction_scores rows for a pattern WITH the embedded show, flat (not
 * grouped/filtered to confirmed rings like getConvictionUniverse). One round
 * trip via the conviction_scores.show_id FK, composite desc, fail-soft ([]).
 * The Phase 2C tiered reader (lib/discovery/tiered-universe) consumes this: it
 * must see every row + the full Show to roll up per show and derive/read cost.
 */
export async function getConvictionScoresWithShowsForPattern(
  campaignPatternId: string
): Promise<ConvictionScoreWithShow[]> {
  try {
    const { data, error } = await supabaseAdmin
      .from("conviction_scores")
      .select("*, shows(*)")
      .eq("campaign_pattern_id", campaignPatternId)
      .order("composite_score", { ascending: false });
    if (error) {
      console.warn(
        "[reasoning-log.getConvictionScoresWithShowsForPattern] read failed:",
        error.message
      );
      return [];
    }
    return ((data ?? []) as Array<ConvictionScoreRow & { shows: Show | null }>).map(
      (row) => {
        const { shows, ...score } = row;
        return { ...(score as ConvictionScoreRow), show: shows ?? null };
      }
    );
  } catch (err) {
    console.warn(
      "[reasoning-log.getConvictionScoresWithShowsForPattern] threw:",
      err instanceof Error ? err.message : err
    );
    return [];
  }
}

/** The campaign id + budget (in DOLLARS) behind a campaign pattern. */
export interface CampaignContextForPattern {
  campaignId: string;
  budgetTotalDollars: number;
}

/**
 * Resolve a campaign pattern to its campaign id + budget. conviction_scores
 * has NO campaign_id — it links via campaign_pattern_id → campaign_patterns
 * .campaign_id → campaigns.budget_total. One round trip via the FK embed.
 * Fail-soft (null on any failure, or when the pattern has no campaign).
 *
 * budget_total is DECIMAL dollars; coerced to a finite number here. The
 * dollars→cents conversion is the caller's single boundary (spot-cost
 * dollarsToCents) — this reader stays in dollars.
 */
export async function getCampaignContextForPattern(
  campaignPatternId: string
): Promise<CampaignContextForPattern | null> {
  try {
    const { data, error } = await supabaseAdmin
      .from("campaign_patterns")
      .select("campaign_id, campaigns(budget_total)")
      .eq("id", campaignPatternId)
      .maybeSingle<{
        campaign_id: string | null;
        campaigns: { budget_total: number | string | null } | null;
      }>();
    if (error) {
      console.warn(
        "[reasoning-log.getCampaignContextForPattern] read failed:",
        error.message
      );
      return null;
    }
    if (!data?.campaign_id) return null;
    const raw = data.campaigns?.budget_total;
    const budget = typeof raw === "string" ? Number(raw) : raw ?? 0;
    return {
      campaignId: data.campaign_id,
      budgetTotalDollars: Number.isFinite(budget) ? Number(budget) : 0,
    };
  } catch (err) {
    console.warn(
      "[reasoning-log.getCampaignContextForPattern] threw:",
      err instanceof Error ? err.message : err
    );
    return null;
  }
}

export interface UpdateConvictionTierCostInput {
  campaignPatternId: string;
  showId: string;
  tier: ConvictionTier;
  perSpotCents: number | null;
  threeSpotCents: number | null;
  cpmUsedCents: number | null;
  costBasis: CostBasis | null;
  costIsEstimate: boolean;
  needsQuote: boolean;
}

/**
 * Write a show's classified tier + derived cost onto EVERY conviction_scores
 * row for that (pattern, show) — the table is per-(show, ring) but tier and
 * cost are per-show, so all of a show's ring rows carry the same values. An
 * UPDATE, not an insert: 2B already wrote these rows with tier null.
 *
 * Fail-soft like the rest of this module — returns false on failure, never
 * throws. Columns are added by migration 028; before that migration runs the
 * UPDATE errors and returns false (swallowed), which is why the pass is not
 * wired into the live flow until 028 is introspected.
 */
export async function updateConvictionTierCost(
  input: UpdateConvictionTierCostInput
): Promise<boolean> {
  try {
    const { error } = await supabaseAdmin
      .from("conviction_scores")
      .update({
        tier: input.tier,
        per_spot_cents: input.perSpotCents,
        three_spot_cents: input.threeSpotCents,
        cpm_used_cents: input.cpmUsedCents,
        cost_basis: input.costBasis,
        cost_is_estimate: input.costIsEstimate,
        needs_quote: input.needsQuote,
      })
      .eq("campaign_pattern_id", input.campaignPatternId)
      .eq("show_id", input.showId);
    if (error) {
      console.warn(
        "[reasoning-log.updateConvictionTierCost] update failed:",
        error.message
      );
      return false;
    }
    return true;
  } catch (err) {
    console.warn(
      "[reasoning-log.updateConvictionTierCost] threw:",
      err instanceof Error ? err.message : err
    );
    return false;
  }
}

/**
 * Assemble the scored universe for a campaign pattern: confirmed rings grouped
 * with their conviction_scores rows and the embedded show. Read-only, fail-soft
 * (returns an empty universe on any failure — the view then shows its empty /
 * not-yet-discovered state rather than crashing).
 *
 * The shows row is embedded via the conviction_scores.show_id FK in one round
 * trip (PostgREST nested select); scores are ordered composite desc by the
 * query and bucketed into the confirmed-ring order from getConfirmedRings.
 * Scores whose ring is not a *confirmed* ring (e.g. a ring later rejected after
 * a re-interpret) are dropped — the view only renders rings the brand kept.
 */
export async function getConvictionUniverse(
  campaignPatternId: string
): Promise<ConvictionUniverse> {
  const empty: ConvictionUniverse = { rings: [], groups: [], hasScores: false };
  try {
    const rings = await getConfirmedRings(campaignPatternId);

    const { data, error } = await supabaseAdmin
      .from("conviction_scores")
      .select("*, shows(*)")
      .eq("campaign_pattern_id", campaignPatternId)
      .order("composite_score", { ascending: false });
    if (error) {
      console.warn(
        "[reasoning-log.getConvictionUniverse] read failed:",
        error.message
      );
      // Rings may still be confirmed even if the scores read failed; return
      // them with hasScores:false so the view can offer a (re-)discovery run.
      return { rings, groups: [], hasScores: false };
    }

    const rows = (data ?? []) as Array<
      ConvictionScoreRow & { shows: Show | null }
    >;

    // Bucket scores by ring id (rows arrive composite desc, so each bucket is
    // already sorted). Split the embedded `shows` off the flat row.
    const byRing = new Map<string, ConvictionUniverseShow[]>();
    for (const row of rows) {
      if (!row.ring_hypothesis_id) continue;
      const { shows, ...score } = row;
      const bucket = byRing.get(row.ring_hypothesis_id) ?? [];
      bucket.push({ score: score as ConvictionScoreRow, show: shows ?? null });
      byRing.set(row.ring_hypothesis_id, bucket);
    }

    const groups: ConvictionUniverseGroup[] = rings.map((ring) => ({
      ring,
      shows: byRing.get(ring.id) ?? [],
    }));

    return { rings, groups, hasScores: rows.length > 0 };
  } catch (err) {
    console.warn(
      "[reasoning-log.getConvictionUniverse] threw:",
      err instanceof Error ? err.message : err
    );
    return empty;
  }
}
