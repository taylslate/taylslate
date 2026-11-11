// One command agent turn. The model can read and propose. It cannot
// approve, send, or run discovery. Caps stop the loop with a plain
// assistant message.

import type Anthropic from "@anthropic-ai/sdk";
import { createLLMClient, FALLBACK_MODEL, getLLMModel, loadPrompt } from "@/lib/llm/client";
import { logEvent } from "@/lib/data/events";
import {
  CALL_MAX_RETRIES,
  CALL_TIMEOUT_MS,
  HISTORY_LIMIT,
  MAX_MODEL_CALLS,
  MAX_OUTPUT_TOKENS,
  MAX_TOOL_CALLS,
  TURN_DEADLINE_MS,
} from "@/lib/command-agent/limits";
import { insertMessage, listMessages, type MessageRow } from "@/lib/command-agent/store";
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
      modelCalls += 1;
      const created = await createMessage(client, system, messages, tools, modelCalls < MAX_MODEL_CALLS);
      if (created.usedFallback) modelCalls += 1;
      const response = created.message;
      inputTokens += created.inputTokens;
      outputTokens += created.outputTokens;
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
  allowFallback: boolean
): Promise<{ message: Anthropic.Message; usedFallback: boolean; inputTokens: number; outputTokens: number }> {
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
  let inputTokens = primary.usage?.input_tokens ?? 0;
  let outputTokens = primary.usage?.output_tokens ?? 0;
  if (primary.stop_reason !== "refusal" || model === FALLBACK_MODEL || !allowFallback) {
    return { message: primary, usedFallback: false, inputTokens, outputTokens };
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
  inputTokens += fallback.usage?.input_tokens ?? 0;
  outputTokens += fallback.usage?.output_tokens ?? 0;
  return { message: fallback, usedFallback: true, inputTokens, outputTokens };
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
    const role = message.role === "assistant" ? "assistant" : "user";
    const text = historyText(message);
    const last = out[out.length - 1];
    if (last && last.role === role && typeof last.content === "string") {
      last.content = `${last.content}\n${text}`;
      continue;
    }
    out.push({ role, content: text });
  }
  if (out.length > 0 && out[0].role === "assistant") {
    out.unshift({ role: "user", content: "Continue." });
  }
  return out;
}

function historyText(message: MessageRow): string {
  if (message.role === "user") return textField(message.content.text);
  if (message.role === "assistant") return textField(message.content.text);
  const name = textField(message.content.name) || "tool";
  const status = textField(message.content.status) || "ok";
  const result = textField(message.content.result);
  return `Tool data (${name}, ${status}): ${result}`;
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
