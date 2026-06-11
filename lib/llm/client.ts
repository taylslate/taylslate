// Centralized LLM access for Wave 14 Phase 2A AI surfaces (URL derivation,
// brief interpretation). All Phase 2A prompts route through this module so
// model selection and refusal handling live in one place.
//
// Model selection: LLM_MODEL env var, defaulting to claude-opus-4-8.
// Refusal handling: if the configured model returns stop_reason "refusal",
// retry once with explicit claude-opus-4-8 (cheap insurance — brief content
// should never trip the refusal classifier). Callers must still check
// stop_reason on the returned message before reading content.

import Anthropic from "@anthropic-ai/sdk";
import fs from "fs";
import path from "path";

export const FALLBACK_MODEL = "claude-opus-4-8";

export function getLLMModel(): string {
  return process.env.LLM_MODEL || FALLBACK_MODEL;
}

export function createLLMClient(): Anthropic {
  // SDK reads ANTHROPIC_API_KEY from the environment; throws if missing.
  return new Anthropic();
}

export interface CallLLMInput {
  system: string;
  userContent: string;
  maxTokens: number;
  client?: Anthropic;
}

export async function callLLMWithFallback(
  input: CallLLMInput
): Promise<Anthropic.Message> {
  const client = input.client ?? createLLMClient();
  const model = getLLMModel();

  const primary = await client.messages.create({
    model,
    max_tokens: input.maxTokens,
    system: input.system,
    messages: [{ role: "user", content: input.userContent }],
  });

  if (primary.stop_reason !== "refusal" || model === FALLBACK_MODEL) {
    return primary;
  }

  console.warn("[llm.callLLMWithFallback] refusal from", model, {
    stop_details: (primary as { stop_details?: unknown }).stop_details,
  });

  return client.messages.create({
    model: FALLBACK_MODEL,
    max_tokens: input.maxTokens,
    system: input.system,
    messages: [{ role: "user", content: input.userContent }],
  });
}

const promptCache = new Map<string, string>();

/**
 * Read a markdown prompt file from lib/prompts/, cached per process.
 * Markdown prompts (vs the older .ts exports) are the Phase 2A convention —
 * easier to diff-review and iterate post-ship.
 */
export function loadPrompt(filename: string): string {
  const cached = promptCache.get(filename);
  if (cached) return cached;
  const text = fs.readFileSync(
    path.join(process.cwd(), "lib", "prompts", filename),
    "utf-8"
  );
  promptCache.set(filename, text);
  return text;
}
