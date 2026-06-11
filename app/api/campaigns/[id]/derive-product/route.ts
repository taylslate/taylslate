// Wave 14 Phase 2A Layer 2 — URL derivation endpoint.
//
// POST { url } (or { paragraph } for the paste-a-paragraph fallback) →
// fetches the page server-side, asks the LLM for a structured product
// derivation, and returns it for the brief intake read-back card.
// No persistence — the brand-confirmed version is saved at brief submit.
//
// Soft-error contract (200 status, error field) so the intake form can
// switch to the paragraph fallback without an error boundary:
//   { error: "url_unreachable", fallback_required: true }  — fetch failed
//   { error: "derivation_failed" }                          — LLM failed

import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser, getCampaignById } from "@/lib/data/queries";
import { logEvent } from "@/lib/data/events";
import { stripHtml } from "@/lib/utils/strip-html";
import { callLLMWithFallback, createLLMClient, loadPrompt } from "@/lib/llm/client";
import type Anthropic from "@anthropic-ai/sdk";
import type { AovBucket, ProductDerivation } from "@/lib/data/types";

const FETCH_TIMEOUT_MS = 10_000;
// Bound what we hand the LLM. Stripped page text beyond this rarely adds
// derivation signal and inflates cost.
const MAX_CONTENT_CHARS = 15_000;
const MAX_LLM_TOKENS = 2048;

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

  let body: { url?: string; paragraph?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const url = body.url?.trim();
  const paragraph = body.paragraph?.trim();
  if (!url && !paragraph) {
    return NextResponse.json(
      { error: "Provide a url or a paragraph" },
      { status: 400 }
    );
  }

  let pageContent: string;
  if (url) {
    const fetched = await fetchPageText(url);
    if (fetched === null) {
      await logEvent({
        eventType: "brief.url_derivation_failed",
        entityType: "campaign",
        entityId: id,
        actorId: user.id,
        payload: { url, reason: "url_unreachable" },
      });
      return NextResponse.json({
        error: "url_unreachable",
        fallback_required: true,
      });
    }
    pageContent = fetched;
  } else {
    pageContent = paragraph as string;
  }

  let client: Anthropic;
  try {
    client = createLLMClient();
  } catch {
    return NextResponse.json(
      {
        error: "AI derivation is not configured. Please add an ANTHROPIC_API_KEY environment variable.",
        code: "NO_API_KEY",
      },
      { status: 503 }
    );
  }

  let message: Anthropic.Message;
  try {
    message = await callLLMWithFallback({
      client,
      system: loadPrompt("derive-product.md"),
      userContent: pageContent.slice(0, MAX_CONTENT_CHARS),
      maxTokens: MAX_LLM_TOKENS,
    });
  } catch (err) {
    console.error(
      "[derive-product] LLM call threw:",
      err instanceof Error ? err.message : err
    );
    return derivationFailed(id, user.id, "llm_error");
  }

  if (message.stop_reason === "refusal") {
    return derivationFailed(id, user.id, "refusal");
  }

  const textBlock = message.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    return derivationFailed(id, user.id, "no_text_block");
  }

  const derivation = parseDerivation(textBlock.text);
  if (!derivation) {
    return derivationFailed(id, user.id, "malformed_json");
  }

  await logEvent({
    eventType: "brief.url_derived",
    entityType: "campaign",
    entityId: id,
    actorId: user.id,
    payload: { url: url ?? null, source: url ? "url" : "paragraph", derivation },
  });

  return NextResponse.json(derivation);
}

/** Fetch the URL and return stripped page text, or null on any failure. */
async function fetchPageText(url: string): Promise<string | null> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return null;
  }

  try {
    const res = await fetch(parsed.toString(), {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: {
        // Some product pages block default fetch UAs; present as a browser.
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml",
      },
    });
    if (!res.ok) return null;
    const html = await res.text();
    const text = stripHtml(html);
    return text.length > 0 ? text : null;
  } catch {
    // Timeout, DNS failure, TLS error — all collapse to url_unreachable.
    return null;
  }
}

/** Parse and normalize the LLM's JSON. Returns null if unparseable. */
function parseDerivation(raw: string): ProductDerivation | null {
  // Models occasionally wrap JSON in markdown fences despite instructions.
  const unfenced = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");

  let parsed: Record<string, unknown>;
  try {
    const value = JSON.parse(unfenced);
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return null;
    }
    parsed = value as Record<string, unknown>;
  } catch {
    return null;
  }

  return {
    brand_name: readString(parsed, "brand_name"),
    category: readString(parsed, "category"),
    product_description: readString(parsed, "product_description"),
    aov_bucket: readAovBucket(parsed),
    aov_reasoning: readString(parsed, "aov_reasoning"),
    key_attributes: readStringArray(parsed, "key_attributes"),
  };
}

function readString(obj: Record<string, unknown>, key: string): string {
  const value = obj[key];
  if (typeof value === "string") return value;
  console.warn(`[derive-product] LLM response missing field: ${key}`);
  return "";
}

function readStringArray(obj: Record<string, unknown>, key: string): string[] {
  const value = obj[key];
  if (Array.isArray(value)) {
    return value.filter((v): v is string => typeof v === "string");
  }
  console.warn(`[derive-product] LLM response missing field: ${key}`);
  return [];
}

function readAovBucket(obj: Record<string, unknown>): AovBucket {
  const value = obj.aov_bucket;
  // The shipped AovBucket enum is "mid" (migration 019 / Layer 1's
  // BriefInput); normalize "medium" in case the model emits the spec's
  // original wording.
  if (value === "medium") return "mid";
  if (value === "low" || value === "mid" || value === "high") return value;
  console.warn("[derive-product] LLM response missing/invalid aov_bucket:", value);
  return "mid";
}

async function derivationFailed(
  campaignId: string,
  actorId: string,
  reason: string
) {
  await logEvent({
    eventType: "brief.url_derivation_failed",
    entityType: "campaign",
    entityId: campaignId,
    actorId,
    payload: { reason },
  });
  return NextResponse.json({ error: "derivation_failed" });
}
