// Conversation and message reads and writes. Every query filters
// brand_id to the session user. service_role only.

import { supabaseAdmin } from "@/lib/supabase/admin";
import { isUuid } from "@/lib/api/v1/pagination";
import { TURN_LOCK_MS } from "@/lib/command-agent/limits";

export type MessageRole = "user" | "assistant" | "tool";

export interface ConversationRow {
  id: string;
  brand_id: string;
  title: string | null;
  created_at: string;
  updated_at: string;
  turn_started_at: string | null;
}

export interface MessageRow {
  id: string;
  conversation_id: string;
  brand_id: string;
  role: MessageRole;
  content: Record<string, unknown>;
  action_ids: string[];
  input_tokens: number;
  output_tokens: number;
  created_at: string;
}

const CONVERSATION_COLUMNS =
  "id, brand_id, title, created_at, updated_at, turn_started_at";

const MESSAGE_COLUMNS =
  "id, conversation_id, brand_id, role, content, action_ids, input_tokens, output_tokens, created_at";

const CONTENT_OCTET_MAX = 65536;

export async function listConversations(brandId: string): Promise<ConversationRow[] | null> {
  if (!isUuid(brandId)) return null;
  const { data, error } = await supabaseAdmin
    .from("command_agent_conversations")
    .select(CONVERSATION_COLUMNS)
    .eq("brand_id", brandId)
    .order("updated_at", { ascending: false });
  if (error) {
    console.error("[command-agent] outcome=list_failed");
    return null;
  }
  return (data ?? []).map((row) => asConversation(row as Record<string, unknown>)).filter(isConversation);
}

export async function createConversation(
  brandId: string,
  title: string | null
): Promise<ConversationRow | null> {
  if (!isUuid(brandId)) return null;
  const { data, error } = await supabaseAdmin
    .from("command_agent_conversations")
    .insert({ brand_id: brandId, title })
    .select(CONVERSATION_COLUMNS)
    .single();
  if (error || !data) {
    console.error("[command-agent] outcome=create_failed");
    return null;
  }
  const row = asConversation(data as Record<string, unknown>);
  return row ?? null;
}

export async function getConversation(
  brandId: string,
  conversationId: string
): Promise<{ ok: true; row: ConversationRow | null } | { ok: false }> {
  if (!isUuid(brandId) || !isUuid(conversationId)) return { ok: true, row: null };
  const { data, error } = await supabaseAdmin
    .from("command_agent_conversations")
    .select(CONVERSATION_COLUMNS)
    .eq("id", conversationId)
    .eq("brand_id", brandId)
    .maybeSingle();
  if (error) {
    console.error("[command-agent] outcome=read_failed");
    return { ok: false };
  }
  if (!data) return { ok: true, row: null };
  const row = asConversation(data as Record<string, unknown>);
  return { ok: true, row };
}

export async function deleteConversation(
  brandId: string,
  conversationId: string
): Promise<"deleted" | "missing" | "error"> {
  if (!isUuid(brandId) || !isUuid(conversationId)) return "missing";
  const { data, error } = await supabaseAdmin
    .from("command_agent_conversations")
    .delete()
    .eq("id", conversationId)
    .eq("brand_id", brandId)
    .select("id");
  if (error) {
    console.error("[command-agent] outcome=delete_failed");
    return "error";
  }
  return data && data.length > 0 ? "deleted" : "missing";
}

export function turnIsFresh(value: string | null, now = Date.now()): boolean {
  if (!value) return false;
  const started = Date.parse(value);
  if (!Number.isFinite(started)) return false;
  return now - started < TURN_LOCK_MS;
}

export async function claimTurn(
  brandId: string,
  conversationId: string,
  now = new Date()
): Promise<"claimed" | "busy" | "missing" | "error"> {
  if (!isUuid(brandId) || !isUuid(conversationId)) return "missing";
  const stale = new Date(now.getTime() - TURN_LOCK_MS).toISOString();
  const cleared = await supabaseAdmin
    .from("command_agent_conversations")
    .update({ turn_started_at: null })
    .eq("brand_id", brandId)
    .or(`turn_started_at.lt.${quoteFilter(stale)}`);
  if (cleared.error) {
    console.error("[command-agent] outcome=claim_failed");
    return "error";
  }
  const fresh = await freshTurns(brandId, stale);
  if (!fresh.ok) return "error";
  if (fresh.rows.length > 0) return "busy";
  const { data, error } = await supabaseAdmin
    .from("command_agent_conversations")
    .update({ turn_started_at: now.toISOString() })
    .eq("id", conversationId)
    .eq("brand_id", brandId)
    .is("turn_started_at", null)
    .select("id");
  if (error) {
    if (error.code === "23505") return "busy";
    console.error("[command-agent] outcome=claim_failed");
    return "error";
  }
  if (!data || data.length === 0) {
    const existing = await getConversation(brandId, conversationId);
    if (!existing.ok) return "error";
    return existing.row ? "busy" : "missing";
  }
  const after = await freshTurns(brandId, stale);
  if (!after.ok) {
    await releaseTurn(brandId, conversationId, now);
    return "error";
  }
  if (earliestTurn(after.rows) !== conversationId) {
    await releaseTurn(brandId, conversationId, now);
    return "busy";
  }
  return "claimed";
}

export async function releaseTurn(
  brandId: string,
  conversationId: string,
  now = new Date()
): Promise<void> {
  if (!isUuid(brandId) || !isUuid(conversationId)) return;
  const { error } = await supabaseAdmin
    .from("command_agent_conversations")
    .update({ turn_started_at: null, updated_at: now.toISOString() })
    .eq("id", conversationId)
    .eq("brand_id", brandId);
  if (error) console.error("[command-agent] outcome=release_failed");
}

export async function setTitleIfEmpty(
  brandId: string,
  conversationId: string,
  title: string
): Promise<void> {
  if (!isUuid(brandId) || !isUuid(conversationId)) return;
  const { error } = await supabaseAdmin
    .from("command_agent_conversations")
    .update({ title, updated_at: new Date().toISOString() })
    .eq("id", conversationId)
    .eq("brand_id", brandId)
    .is("title", null);
  if (error) console.error("[command-agent] outcome=title_failed");
}

export async function insertMessage(input: {
  brandId: string;
  conversationId: string;
  role: MessageRole;
  content: Record<string, unknown>;
  actionIds?: string[];
  inputTokens?: number;
  outputTokens?: number;
}): Promise<MessageRow | null> {
  if (!isUuid(input.brandId) || !isUuid(input.conversationId)) return null;
  const content = fitContent(input.content);
  const { data, error } = await supabaseAdmin
    .from("command_agent_messages")
    .insert({
      conversation_id: input.conversationId,
      brand_id: input.brandId,
      role: input.role,
      content,
      action_ids: input.actionIds ?? [],
      input_tokens: Math.max(0, input.inputTokens ?? 0),
      output_tokens: Math.max(0, input.outputTokens ?? 0),
    })
    .select(MESSAGE_COLUMNS)
    .single();
  if (error || !data) {
    console.error("[command-agent] outcome=message_failed");
    return null;
  }
  return asMessage(data as Record<string, unknown>);
}

export async function listMessages(
  brandId: string,
  conversationId: string,
  limit?: number
): Promise<MessageRow[] | null> {
  if (!isUuid(brandId) || !isUuid(conversationId)) return null;
  let query = supabaseAdmin
    .from("command_agent_messages")
    .select(MESSAGE_COLUMNS)
    .eq("conversation_id", conversationId)
    .eq("brand_id", brandId)
    .order("created_at", { ascending: limit != null ? false : true });
  if (limit != null) query = query.limit(limit);
  const { data, error } = await query;
  if (error) {
    console.error("[command-agent] outcome=messages_failed");
    return null;
  }
  const rows = (data ?? [])
    .map((row) => asMessage(row as Record<string, unknown>))
    .filter((row): row is MessageRow => row !== null);
  return limit != null ? rows.reverse() : rows;
}

export async function recordModelUsage(input: {
  brandId: string;
  inputTokens: number;
  outputTokens: number;
}): Promise<boolean> {
  if (!isUuid(input.brandId)) return false;
  const { error } = await supabaseAdmin.from("command_agent_usage").insert({
    brand_id: input.brandId,
    input_tokens: nonNegative(input.inputTokens),
    output_tokens: nonNegative(input.outputTokens),
  });
  if (error) {
    console.error("[command-agent] outcome=usage_failed");
    return false;
  }
  return true;
}

export async function sumTokensSince(
  brandId: string,
  sinceIso: string
): Promise<{ ok: true; total: number } | { ok: false }> {
  if (!isUuid(brandId)) return { ok: false };
  const { data, error } = await supabaseAdmin
    .from("command_agent_usage")
    .select("input_tokens, output_tokens")
    .eq("brand_id", brandId)
    .gte("created_at", sinceIso);
  if (error) {
    console.error("[command-agent] outcome=cap_read_failed");
    return { ok: false };
  }
  let total = 0;
  for (const row of data ?? []) {
    const record = row as Record<string, unknown>;
    total += numberOf(record.input_tokens) + numberOf(record.output_tokens);
  }
  return { ok: true, total };
}

async function freshTurns(
  brandId: string,
  staleIso: string
): Promise<{ ok: true; rows: { id: string; turn_started_at: string }[] } | { ok: false }> {
  const { data, error } = await supabaseAdmin
    .from("command_agent_conversations")
    .select("id, turn_started_at")
    .eq("brand_id", brandId)
    .gte("turn_started_at", staleIso);
  if (error) {
    console.error("[command-agent] outcome=claim_failed");
    return { ok: false };
  }
  const rows: { id: string; turn_started_at: string }[] = [];
  for (const item of data ?? []) {
    const row = item as Record<string, unknown>;
    if (typeof row.id !== "string" || row.turn_started_at == null) continue;
    rows.push({ id: row.id, turn_started_at: timestampOf(row.turn_started_at) });
  }
  return { ok: true, rows };
}

function earliestTurn(rows: { id: string; turn_started_at: string }[]): string {
  return [...rows].sort((left, right) => {
    if (left.turn_started_at !== right.turn_started_at) {
      return left.turn_started_at < right.turn_started_at ? -1 : 1;
    }
    return left.id < right.id ? -1 : 1;
  })[0]?.id ?? "";
}

function quoteFilter(value: string): string {
  return `"${value.replace(/"/g, "")}"`;
}

function fitContent(content: Record<string, unknown>): Record<string, unknown> {
  let next = content;
  let encoded = JSON.stringify(next);
  if (Buffer.byteLength(encoded, "utf8") <= CONTENT_OCTET_MAX) return next;
  if (typeof next.result === "string") {
    next = { ...next, result: next.result.slice(0, 1000) };
    encoded = JSON.stringify(next);
  }
  if (Buffer.byteLength(encoded, "utf8") <= CONTENT_OCTET_MAX) return next;
  return { text: "Stored text was too long." };
}

function asConversation(row: Record<string, unknown>): ConversationRow | null {
  if (typeof row.id !== "string" || typeof row.brand_id !== "string") return null;
  return {
    id: row.id,
    brand_id: row.brand_id,
    title: typeof row.title === "string" ? row.title : null,
    created_at: timestampOf(row.created_at),
    updated_at: timestampOf(row.updated_at),
    turn_started_at: row.turn_started_at == null ? null : timestampOf(row.turn_started_at),
  };
}

function isConversation(row: ConversationRow | null): row is ConversationRow {
  return row !== null;
}

function asMessage(row: Record<string, unknown>): MessageRow | null {
  if (typeof row.id !== "string") return null;
  if (row.role !== "user" && row.role !== "assistant" && row.role !== "tool") return null;
  const content =
    row.content && typeof row.content === "object" && !Array.isArray(row.content)
      ? (row.content as Record<string, unknown>)
      : {};
  const actionIds = Array.isArray(row.action_ids)
    ? row.action_ids.filter((item): item is string => typeof item === "string")
    : [];
  return {
    id: row.id,
    conversation_id: typeof row.conversation_id === "string" ? row.conversation_id : "",
    brand_id: typeof row.brand_id === "string" ? row.brand_id : "",
    role: row.role,
    content,
    action_ids: actionIds,
    input_tokens: numberOf(row.input_tokens),
    output_tokens: numberOf(row.output_tokens),
    created_at: timestampOf(row.created_at),
  };
}

function numberOf(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function nonNegative(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.round(value);
}

function timestampOf(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string" && value.length > 0) return value;
  return new Date(0).toISOString();
}
