// One command agent turn. The model can read and propose. It cannot
// approve, send, or run discovery. Caps stop the loop with a plain
// assistant message.

import type Anthropic from "@anthropic-ai/sdk";
import { createLLMClient, FALLBACK_MODEL, getLLMModel, loadPrompt } from "@/lib/llm/client";
import { logEvent } from "@/lib/data/events";
import {
  CALL_MAX_RETRIES,
  CALL_TIMEOUT_MS,
  DAILY_CAP_MESSAGE,
  DAILY_TOKEN_CAP,
  HISTORY_LIMIT,
  MAX_MODEL_CALLS,
  MAX_OUTPUT_TOKENS,
  MAX_TOOL_CALLS,
  TURN_DEADLINE_MS,
  utcDayStart,
} from "@/lib/command-agent/limits";
import {
  insertMessage,
  listMessages,
  recordModelUsage,
  sumTokensSince,
  type MessageRow,
} from "@/lib/command-agent/store";
import {
  agentToolDefinitions,
  dispatchAgentTool,
  safeToolName,
  type AgentToolDispatch,
} from "@/lib/command-agent/tools";

const PROPOSE = new Set(["propose_campaign", "propose_outreach"]);

const STOP_MODEL = "Tay stopped this turn after the reply limit. Send another message to continue.";
const STOP_TOOLS = "Tay stopped this turn after the tool limit. Send another message to continue.";
const STOP_DEADLINE = "Tay stopped this turn because it ran too long. Send another message to continue.";
const STOP_EMPTY = "Tay could not answer that. Try rephrasing.";
const STOP_ERROR = "Tay could not finish this turn. Try again.";

type ModelMessage = Anthropic.MessageParam;
type ToolResultBlock = {
  type: "tool_result";
  tool_use_id: string;
  content: string;
  is_error: boolean;
};

export async function runAgentTurn(input: {
  brandId: string;
  conversationId: string;
  userMessageId: string;
  client?: Anthropic;
  now?: () => number;
}): Promise<{ ok: true; messages: MessageRow[] } | { ok: false }> {
  const now = input.now ?? Date.now;
  const deadline = now() + TURN_DEADLINE_MS;
  const history = await listMessages(input.brandId, input.conversationId, HISTORY_LIMIT);
  if (!history) return { ok: false };
  const system = loadPrompt("command-agent.md");
  const messages: ModelMessage[] = toModelMessages(history);
  const tools = agentToolDefinitions();
  const client = input.client ?? createLLMClient();
  const stored: MessageRow[] = [];
  const toolNames: string[] = [];
  const actionIds: string[] = [];
  let inputTokens = 0;
  let outputTokens = 0;
  let modelCalls = 0;
  let toolCalls = 0;
  let proposeOrdinal = 0;

  const finish = async (text: string): Promise<{ ok: true; messages: MessageRow[] } | { ok: false }> => {
    const row = await insertMessage({
      brandId: input.brandId,
      conversationId: input.conversationId,
      role: "assistant",
      content: { text },
      actionIds,
      inputTokens,
      outputTokens,
    });
    if (!row) return { ok: false };
    stored.push(row);
    console.info(
      `[command-agent] outcome=turn tools=${toolNames.map(safeToolName).join(",") || "-"} actions=${actionIds.length}`
    );
    await logEvent({
      eventType: "command_agent.turn",
      entityType: "command_agent_conversation",
      entityId: input.conversationId,
      actorId: input.brandId,
      payload: {
        tools: toolNames.map(safeToolName),
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        action_ids: actionIds,
      },
    });
    return { ok: true, messages: stored };
  };

  try {
    while (modelCalls < MAX_MODEL_CALLS) {
      if (now() > deadline) return finish(STOP_DEADLINE);
      const room = await tokenRoom(input.brandId);
      if (room === "error") return finish(STOP_ERROR);
      if (room === "cap") {
        await logCap(input.brandId, input.conversationId);
        return finish(DAILY_CAP_MESSAGE);
      }
      modelCalls += 1;
      const created = await createMessage(
        client,
        system,
        messages,
        tools,
        modelCalls < MAX_MODEL_CALLS,
        input.brandId
      );
      if (created.failed) return finish(STOP_ERROR);
      if (created.usedFallback) modelCalls += 1;
      for (const call of created.calls) {
        inputTokens += call.inputTokens;
        outputTokens += call.outputTokens;
      }
      const response = created.message;
      if (now() > deadline) return finish(STOP_DEADLINE);
      const toolUses = response.content.filter(
        (block): block is Anthropic.ToolUseBlock => block.type === "tool_use"
      );
      if (toolUses.length === 0) {
        const text = textOf(response.content);
        return finish(text.length > 0 ? text : STOP_EMPTY);
      }
      messages.push({ role: "assistant", content: response.content });
      const results: ToolResultBlock[] = [];
      for (const toolUse of toolUses) {
        if (toolCalls >= MAX_TOOL_CALLS) return finish(STOP_TOOLS);
        if (now() > deadline) return finish(STOP_DEADLINE);
        toolCalls += 1;
        const name = toolUse.name;
        toolNames.push(name);
        const ordinal = PROPOSE.has(name) ? (proposeOrdinal += 1) : 0;
        const dispatched = await dispatchAgentTool({
          brandId: input.brandId,
          name,
          args: toolUse.input,
          userMessageId: input.userMessageId,
          proposeOrdinal: ordinal,
        });
        if (dispatched.actionId) actionIds.push(dispatched.actionId);
        const toolRow = await storeTool(input, dispatched);
        if (!toolRow) return finish(STOP_ERROR);
        stored.push(toolRow);
        results.push({
          type: "tool_result",
          tool_use_id: toolUse.id,
          content: dispatched.toolResultText,
          is_error: dispatched.isError,
        });
      }
      messages.push({ role: "user", content: results });
    }
    return finish(STOP_MODEL);
  } catch {
    console.error("[command-agent] outcome=error");
    return finish(STOP_ERROR);
  }
}

async function createMessage(
  client: Anthropic,
  system: string,
  messages: ModelMessage[],
  tools: Anthropic.Tool[],
  allowFallback: boolean,
  brandId: string
): Promise<
  | {
      failed: false;
      message: Anthropic.Message;
      usedFallback: boolean;
      calls: { inputTokens: number; outputTokens: number }[];
    }
  | { failed: true }
> {
  const options = { timeout: CALL_TIMEOUT_MS, maxRetries: CALL_MAX_RETRIES };
  const model = getLLMModel();
  const primary = await client.messages.create(
    {
      model,
      max_tokens: MAX_OUTPUT_TOKENS,
      system,
      messages,
      tools,
    },
    options
  );
  const primaryUsage = usageOf(primary);
  if (!(await recordUsage(brandId, primaryUsage))) return { failed: true };
  if (primary.stop_reason !== "refusal" || model === FALLBACK_MODEL || !allowFallback) {
    return { failed: false, message: primary, usedFallback: false, calls: [primaryUsage] };
  }
  console.info("[command-agent] outcome=refusal");
  const fallback = await client.messages.create(
    {
      model: FALLBACK_MODEL,
      max_tokens: MAX_OUTPUT_TOKENS,
      system,
      messages,
      tools,
    },
    options
  );
  const fallbackUsage = usageOf(fallback);
  if (!(await recordUsage(brandId, fallbackUsage))) return { failed: true };
  return { failed: false, message: fallback, usedFallback: true, calls: [primaryUsage, fallbackUsage] };
}

async function recordUsage(
  brandId: string,
  usage: { inputTokens: number; outputTokens: number }
): Promise<boolean> {
  return recordModelUsage({
    brandId,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
  });
}

async function storeTool(
  input: { brandId: string; conversationId: string },
  dispatched: AgentToolDispatch
): Promise<MessageRow | null> {
  return insertMessage({
    brandId: input.brandId,
    conversationId: input.conversationId,
    role: "tool",
    content: {
      name: dispatched.stored.name,
      args: dispatched.stored.args,
      status: dispatched.stored.status,
      result: dispatched.stored.result,
    },
    actionIds: [],
    inputTokens: 0,
    outputTokens: 0,
  });
}

function toModelMessages(history: MessageRow[]): ModelMessage[] {
  const out: ModelMessage[] = [];
  for (const message of history) {
    if (message.role === "tool") {
      pushTurn(out, "user", toolStatus(message));
      continue;
    }
    const role = message.role === "assistant" ? "assistant" : "user";
    pushTurn(out, role, textField(message.content.text));
  }
  if (out.length > 0 && out[0].role === "assistant") {
    out.unshift({ role: "user", content: "Continue." });
  }
  return out;
}

function pushTurn(out: ModelMessage[], role: "user" | "assistant", content: string): void {
  const last = out[out.length - 1];
  if (last && last.role === role) {
    out.push({ role: role === "user" ? "assistant" : "user", content: "Continue." });
  }
  out.push({ role, content });
}

function toolStatus(message: MessageRow): string {
  const name = textField(message.content.name) || "tool";
  const status = textField(message.content.status) === "error" ? "error" : "ok";
  return JSON.stringify({ tool: name, status });
}

async function tokenRoom(brandId: string): Promise<"ok" | "cap" | "error"> {
  const spent = await sumTokensSince(brandId, utcDayStart());
  if (!spent.ok) return "error";
  return spent.total >= DAILY_TOKEN_CAP ? "cap" : "ok";
}

async function logCap(brandId: string, conversationId: string): Promise<void> {
  console.info("[command-agent] outcome=cap_hit");
  await logEvent({
    eventType: "command_agent.cap_hit",
    entityType: "command_agent_conversation",
    entityId: conversationId,
    actorId: brandId,
    payload: { limit: "daily_tokens" },
  });
}

function usageOf(message: Anthropic.Message): { inputTokens: number; outputTokens: number } {
  return {
    inputTokens: message.usage?.input_tokens ?? 0,
    outputTokens: message.usage?.output_tokens ?? 0,
  };
}

function textOf(content: Anthropic.Message["content"]): string {
  return content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text.trim())
    .filter((text) => text.length > 0)
    .join("\n");
}

function textField(value: unknown): string {
  return typeof value === "string" ? value : "";
}
