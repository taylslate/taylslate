// Wave 14 Phase 2A Layer 5 — ring refinement endpoint.
//
// POST { ring_hypothesis_id, refinement_text } → the brand says one ring is
// off. Ask the LLM for a replacement ring shaped by the correction, then
// persist the new 'pending' row AND mark the old ring 'refined' atomically
// (migration 025 persist_refinement RPC). The old ring stays in the DB as
// training data; the page filters refined rows out of the view.
//
// Two failure contracts, by cause:
//   * LLM-level (refusal / malformed / no text / call threw): soft 200
//     { error: "refinement_failed", reason } — the page keeps the old ring
//     and shows an inline retry. Nothing is written, so retry is safe.
//   * Persistence-level (the atomic RPC failed): hard 500. The brand can't
//     fix a DB failure by rephrasing, so it is surfaced, not swallowed.
//   * A ring already 'refined' (stale request): 400 { code: "ring_refined" }.

import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser, getCampaignById } from "@/lib/data/queries";
import { logEvent } from "@/lib/data/events";
import {
  getCampaignReasoning,
  getLatestCampaignPatternForCampaign,
  persistRefinementAtomic,
} from "@/lib/data/reasoning-log";
import {
  buildPatternContext,
  parseProposedRing,
} from "@/lib/discovery/ring-proposal";
import {
  callLLMWithFallback,
  createLLMClient,
  loadPrompt,
} from "@/lib/llm/client";
import type Anthropic from "@anthropic-ai/sdk";
import type { InterpretedRing, RingHypothesisKind } from "@/lib/data/types";

const MAX_LLM_TOKENS = 1024;
const LLM_TIMEOUT_MS = 60_000;
const LLM_MAX_RETRIES = 0;

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(request: NextRequest, context: RouteContext) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await context.params;
  const campaign = await getCampaignById(id);
  if (!campaign || campaign.user_id !== user.id) {
    return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
  }

  let body: { ring_hypothesis_id?: string; refinement_text?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const ringId = body.ring_hypothesis_id?.trim();
  const refinementText = body.refinement_text?.trim();
  if (!ringId || !refinementText) {
    return NextResponse.json(
      { error: "ring_hypothesis_id and refinement_text are required" },
      { status: 400 }
    );
  }

  const pattern = await getLatestCampaignPatternForCampaign(id);
  if (!pattern) {
    return NextResponse.json(
      { error: "No interpretation to refine", code: "no_interpretation" },
      { status: 400 }
    );
  }

  // The ring must belong to this campaign's pattern.
  const reasoning = await getCampaignReasoning(pattern.id);
  const ringRow = reasoning.rings.find((r) => r.id === ringId);
  if (!ringRow) {
    return NextResponse.json({ error: "Ring not found" }, { status: 404 });
  }
  // A ring already superseded by a refinement can't be refined again — the
  // page never offers it, so this only fires on a stale/malformed request.
  if (ringRow.brand_decision === "refined") {
    return NextResponse.json(
      { error: "Ring already refined", code: "ring_refined" },
      { status: 400 }
    );
  }
  const kind: Exclude<RingHypothesisKind, "confirmed"> =
    ringRow.kind === "primary" ? "primary" : "lateral";

  if (!process.env.ANTHROPIC_API_KEY) return noApiKeyResponse();
  let client: Anthropic;
  try {
    client = createLLMClient();
  } catch {
    return noApiKeyResponse();
  }

  const userContent = [
    buildPatternContext(pattern),
    "",
    "## Ring to refine",
    "",
    "You proposed this ring:",
    `- Label: ${String(ringRow.label ?? "")}`,
    `- Confidence: ${String(ringRow.confidence ?? "")}`,
    `- Reasoning: ${String(ringRow.reasoning ?? "")}`,
    "",
    "The brand says this is not quite right. Their correction (their own words):",
    `"${refinementText}"`,
    "",
    "Produce the single replacement ring.",
  ].join("\n");

  let message: Anthropic.Message;
  try {
    message = await callLLMWithFallback({
      client,
      system: loadPrompt("refine-ring.md"),
      userContent,
      maxTokens: MAX_LLM_TOKENS,
      timeoutMs: LLM_TIMEOUT_MS,
      maxRetries: LLM_MAX_RETRIES,
    });
  } catch (err) {
    console.error(
      "[interpret/refine] LLM call threw:",
      err instanceof Error ? err.message : err
    );
    return refinementFailed(id, user.id, "llm_error");
  }

  if (message.stop_reason === "refusal") {
    return refinementFailed(id, user.id, "refusal");
  }
  const textBlock = message.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    return refinementFailed(id, user.id, "no_text_block");
  }

  const parsed = parseProposedRing(textBlock.text);
  if ("error" in parsed) {
    return refinementFailed(id, user.id, "malformed_json");
  }
  const ring = parsed.ring;

  // Atomic persist (migration 025): insert the replacement ring AND mark the
  // old ring 'refined' in one transaction. Either both land or neither does —
  // no orphaned slot. A persistence failure is a hard 500 now (not a soft
  // 200), because unlike an LLM hiccup the brand can't fix it by rephrasing.
  const persisted = await persistRefinementAtomic({
    oldRingId: ringId,
    campaignPatternId: pattern.id,
    kind,
    label: ring.ring_label,
    reasoning: ring.reasoning || null,
    confidence: ring.confidence,
  });
  if (!persisted) {
    await logEvent({
      eventType: "brief.refinement_failed",
      entityType: "campaign",
      entityId: id,
      actorId: user.id,
      payload: { mode: "refine", reason: "persist_failed" },
    });
    return NextResponse.json(
      { error: "Failed to save refinement", code: "persist_failed" },
      { status: 500 }
    );
  }
  const newId = persisted.newRingId;

  await logEvent({
    eventType: "brief.refinement_submitted",
    entityType: "campaign",
    entityId: id,
    actorId: user.id,
    payload: {
      mode: "refine",
      kind,
      old_ring_hypothesis_id: ringId,
      new_ring_hypothesis_id: newId,
    },
  });

  const result: InterpretedRing = {
    ring_hypothesis_id: newId,
    ring_label: ring.ring_label,
    confidence: ring.confidence,
    reasoning: ring.reasoning,
    analog_campaigns: ring.analog_campaigns,
  };
  return NextResponse.json({ ring: result });
}

function noApiKeyResponse() {
  return NextResponse.json(
    {
      error:
        "AI refinement is not configured. Please add an ANTHROPIC_API_KEY environment variable.",
      code: "NO_API_KEY",
    },
    { status: 503 }
  );
}

async function refinementFailed(
  campaignId: string,
  actorId: string,
  reason: string
) {
  await logEvent({
    eventType: "brief.refinement_failed",
    entityType: "campaign",
    entityId: campaignId,
    actorId,
    payload: { mode: "refine", reason },
  });
  return NextResponse.json({ error: "refinement_failed", reason });
}
