// Wave 14 Phase 2A Layer 5 — "add a ring I missed" endpoint.
//
// POST { framing_text } → the brand thinks the interpretation missed a ring.
// Turn their framing into a structured ring and persist it as a new lateral
// row with brand_decision='added_by_brand' (provenance preserved through
// confirm). Returns the ring for the page to append without a reload.
//
// Soft-error contract (200, error field): { error: "add_ring_failed",
// reason }. No existing rows are touched, so a failure leaves state intact.

import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser, getCampaignById } from "@/lib/data/queries";
import { logEvent } from "@/lib/data/events";
import {
  getCampaignReasoning,
  getLatestCampaignPatternForCampaign,
  recordRingHypothesis,
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
import type { InterpretedRing } from "@/lib/data/types";

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

  let body: { framing_text?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const framingText = body.framing_text?.trim();
  if (!framingText) {
    return NextResponse.json(
      { error: "framing_text is required" },
      { status: 400 }
    );
  }

  const pattern = await getLatestCampaignPatternForCampaign(id);
  if (!pattern) {
    return NextResponse.json(
      { error: "No interpretation to add to", code: "no_interpretation" },
      { status: 400 }
    );
  }

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
    "## Ring the brand wants added",
    "",
    "The brand thinks you missed a ring. Their framing (their own words):",
    `"${framingText}"`,
    "",
    "Turn this into a single structured ring.",
  ].join("\n");

  let message: Anthropic.Message;
  try {
    message = await callLLMWithFallback({
      client,
      system: loadPrompt("add-ring.md"),
      userContent,
      maxTokens: MAX_LLM_TOKENS,
      timeoutMs: LLM_TIMEOUT_MS,
      maxRetries: LLM_MAX_RETRIES,
    });
  } catch (err) {
    console.error(
      "[interpret/add-ring] LLM call threw:",
      err instanceof Error ? err.message : err
    );
    return addRingFailed(id, user.id, "llm_error");
  }

  if (message.stop_reason === "refusal") {
    return addRingFailed(id, user.id, "refusal");
  }
  const textBlock = message.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    return addRingFailed(id, user.id, "no_text_block");
  }

  const parsed = parseProposedRing(textBlock.text);
  if ("error" in parsed) {
    return addRingFailed(id, user.id, "malformed_json");
  }
  const ring = parsed.ring;

  // Append at the next slot so the brand-added ring lands after the existing
  // rings and stays there on reload (migration 025 slot_position). Computed
  // over ALL rings (including refined) so a refined ring's freed slot isn't
  // reused. Single-brand, sequential UI — a benign tie falls back to
  // created_at in reconstruction.
  const reasoning = await getCampaignReasoning(pattern.id);
  const nextSlot =
    reasoning.rings.reduce((max, r) => {
      const slot = typeof r.slot_position === "number" ? r.slot_position : -1;
      return slot > max ? slot : max;
    }, -1) + 1;

  const newId = await recordRingHypothesis({
    campaignPatternId: pattern.id,
    kind: "lateral",
    label: ring.ring_label,
    reasoning: ring.reasoning || null,
    confidence: ring.confidence,
    brandDecision: "added_by_brand",
    slotPosition: nextSlot,
  });
  if (!newId) {
    return addRingFailed(id, user.id, "persist_failed");
  }

  await logEvent({
    eventType: "brief.refinement_submitted",
    entityType: "campaign",
    entityId: id,
    actorId: user.id,
    payload: { mode: "add", new_ring_hypothesis_id: newId },
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
        "AI ring generation is not configured. Please add an ANTHROPIC_API_KEY environment variable.",
      code: "NO_API_KEY",
    },
    { status: 503 }
  );
}

async function addRingFailed(
  campaignId: string,
  actorId: string,
  reason: string
) {
  await logEvent({
    eventType: "brief.refinement_failed",
    entityType: "campaign",
    entityId: campaignId,
    actorId,
    payload: { mode: "add", reason },
  });
  return NextResponse.json({ error: "add_ring_failed", reason });
}
