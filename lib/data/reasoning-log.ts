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
// ring_hypotheses
// ============================================================

export interface RecordRingHypothesisInput {
  campaignPatternId: string;
  kind: "primary" | "lateral" | "confirmed";
  label: string;
  reasoning?: string | null;
  confidence: "high" | "medium" | "low" | "speculative";
  confidenceScore?: number | null;
  brandConfirmed?: boolean | null;
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
        brand_confirmed: input.brandConfirmed ?? null,
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
// analog_matches
// ============================================================

export interface RecordAnalogMatchInput {
  campaignPatternId: string;
  analogName: string;
  reasoning?: string | null;
  similarityScore?: number | null;
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
