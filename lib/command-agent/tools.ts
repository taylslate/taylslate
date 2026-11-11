// Allowlist adapter from the M1 registry to Anthropic tool definitions.
// The model never supplies a brand, user, key, scope, or conversation id.
// Propose calls get a server idempotency key.

import type Anthropic from "@anthropic-ai/sdk";
import type { ApiScope } from "@/lib/api/keys";
import { callTool, listTools, type ToolContext, type ToolResult } from "@/lib/mcp/tools";
import { MCP_TOOL_NAMES } from "@/lib/mcp/args";
import { RESULT_TEXT_LIMIT, STORED_RESULT_LIMIT } from "@/lib/command-agent/limits";

export const AGENT_SCOPES = ["read", "write:campaigns", "write:outreach"] as const satisfies readonly ApiScope[];

const PROPOSE = new Set(["propose_campaign", "propose_outreach"]);
const SECRET_KEY = /secret|token|password|authorization|api_key|key_hash/i;
const TRUNCATED = "truncated";

export function agentToolDefinitions(): Anthropic.Tool[] {
  return listTools(AGENT_SCOPES).map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.inputSchema as Anthropic.Tool.InputSchema,
  }));
}

export function agentToolNames(): string[] {
  return listTools(AGENT_SCOPES).map((tool) => tool.name);
}

export function isAgentToolName(name: string): boolean {
  return (MCP_TOOL_NAMES as readonly string[]).includes(name);
}

export function serverIdempotencyKey(userMessageId: string, n: number): string {
  return `ca:${userMessageId}:${n}`;
}

export function withServerIdempotency(
  name: string,
  args: unknown,
  userMessageId: string,
  n: number
): unknown {
  if (!PROPOSE.has(name) || !isPlain(args)) return args;
  return { ...args, idempotency_key: serverIdempotencyKey(userMessageId, n) };
}

export function wrapToolResultText(raw: string): string {
  let data: unknown = raw;
  try {
    data = JSON.parse(raw) as unknown;
  } catch {
    data = raw;
  }
  return truncateText(JSON.stringify({ data }), RESULT_TEXT_LIMIT);
}

export function sanitizeArgs(value: unknown, depth = 0): unknown {
  if (depth > 6) return null;
  if (typeof value === "string") return value.length > 500 ? value.slice(0, 500) : value;
  if (typeof value === "number" || typeof value === "boolean" || value === null) return value;
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => sanitizeArgs(item, depth + 1));
  if (!isPlain(value)) return null;
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (SECRET_KEY.test(key)) continue;
    out[key] = sanitizeArgs(item, depth + 1);
  }
  return out;
}

export function safeToolName(name: string): string {
  return /^[a-z0-9_]{1,64}$/i.test(name) ? name : "invalid";
}

export interface AgentToolDispatch {
  toolResultText: string;
  isError: boolean;
  actionId: string | null;
  stored: {
    name: string;
    args: unknown;
    status: "ok" | "error";
    result: string;
  };
}

export async function dispatchAgentTool(input: {
  brandId: string;
  name: string;
  args: unknown;
  userMessageId: string;
  proposeOrdinal: number;
}): Promise<AgentToolDispatch> {
  const safeName = safeToolName(input.name);
  if (!isAgentToolName(input.name)) {
    console.info(`[command-agent] tool=${safeName} outcome=unknown`);
    return storedDispatch(safeName, input.args, "Unknown tool.", true, null);
  }
  const args = withServerIdempotency(input.name, input.args, input.userMessageId, input.proposeOrdinal);
  const ctx: ToolContext = {
    brandId: input.brandId,
    keyId: null,
    source: "command_agent",
    scopes: AGENT_SCOPES,
  };
  const started = Date.now();
  const result = await callTool(ctx, input.name, args);
  const text = wrapToolResultText(resultText(result));
  const actionId = actionIdOf(result);
  console.info(
    `[command-agent] tool=${safeName} outcome=${result.isError ? "error" : "ok"} elapsed_ms=${Date.now() - started}`
  );
  return storedDispatch(input.name, args, text, result.isError, actionId);
}

function storedDispatch(
  name: string,
  args: unknown,
  text: string,
  isError: boolean,
  actionId: string | null
): AgentToolDispatch {
  const result = text.length > STORED_RESULT_LIMIT ? text.slice(0, STORED_RESULT_LIMIT) : text;
  return {
    toolResultText: text,
    isError,
    actionId,
    stored: {
      name,
      args: sanitizeArgs(args),
      status: isError ? "error" : "ok",
      result,
    },
  };
}

function resultText(result: ToolResult): string {
  const text = result.content.find((block) => block.type === "text")?.text;
  return typeof text === "string" ? text : "";
}

function actionIdOf(result: ToolResult): string | null {
  if (result.isError || !isPlain(result.structuredContent)) return null;
  const id = result.structuredContent.action_id;
  return typeof id === "string" ? id : null;
}

function truncateText(text: string, limit: number): string {
  if (text.length <= limit) return text;
  const budget = Math.max(0, limit - TRUNCATED.length);
  return text.slice(0, budget) + TRUNCATED;
}

function isPlain(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
