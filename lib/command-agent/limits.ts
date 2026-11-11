// Caps for the command agent. Buckets live here. lib/security/rate-limit.ts
// is not edited. The daily token cap is a sum of stored token counts.

import type { RateLimitRule } from "@/lib/security/rate-limit";

export const COMMAND_AGENT_HOUR_BUCKET = "command_agent_user_hour";
export const COMMAND_AGENT_HOUR_MAX = 20;
export const COMMAND_AGENT_HOUR_WINDOW_SEC = 60 * 60;

export const COMMAND_AGENT_DAY_BUCKET = "command_agent_user_day";
export const COMMAND_AGENT_DAY_MAX = 60;
export const COMMAND_AGENT_DAY_WINDOW_SEC = 24 * 60 * 60;

export const DAILY_TOKEN_CAP = 300_000;
export const DAILY_CAP_MESSAGE = "Daily assistant limit reached. Try again tomorrow.";

export const MAX_MODEL_CALLS = 6;
export const MAX_TOOL_CALLS = 8;
export const MAX_OUTPUT_TOKENS = 1500;
export const CALL_TIMEOUT_MS = 25_000;
export const CALL_MAX_RETRIES = 1;
export const TURN_DEADLINE_MS = 90_000;
export const TURN_LOCK_MS = 120_000;
export const HISTORY_LIMIT = 20;

export const BODY_MAX_BYTES = 16 * 1024;
export const MESSAGE_MAX_CHARS = 4000;
export const TITLE_MAX_CHARS = 120;
export const RESULT_TEXT_LIMIT = 16_000;
export const STORED_RESULT_LIMIT = 4_000;

const PRINTABLE = /[\u0000-\u001F\u007F]/;

export function commandAgentRules(userId: string): RateLimitRule[] {
  return [
    {
      bucket: COMMAND_AGENT_HOUR_BUCKET,
      key: userId,
      max: COMMAND_AGENT_HOUR_MAX,
      windowSeconds: COMMAND_AGENT_HOUR_WINDOW_SEC,
    },
    {
      bucket: COMMAND_AGENT_DAY_BUCKET,
      key: userId,
      max: COMMAND_AGENT_DAY_MAX,
      windowSeconds: COMMAND_AGENT_DAY_WINDOW_SEC,
    },
  ];
}

export function utcDayStart(now = new Date()): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
}

export function parseTitle(value: unknown): { ok: true; title: string | null } | { ok: false; error: string } {
  if (value == null) return { ok: true, title: null };
  if (typeof value !== "string") return { ok: false, error: "title must be text." };
  const title = value.trim();
  if (title.length < 1 || title.length > TITLE_MAX_CHARS) {
    return { ok: false, error: "title must be 1 to 120 characters." };
  }
  if (PRINTABLE.test(title)) return { ok: false, error: "title must be printable text." };
  return { ok: true, title };
}

export function parseMessageText(value: unknown): { ok: true; message: string } | { ok: false; error: string } {
  if (typeof value !== "string") return { ok: false, error: "message must be text." };
  const message = value.trim();
  if (message.length < 1 || message.length > MESSAGE_MAX_CHARS) {
    return { ok: false, error: "message must be 1 to 4000 characters." };
  }
  if (PRINTABLE.test(message)) return { ok: false, error: "message must be printable text." };
  return { ok: true, message };
}

export async function readLimitedJson(
  request: Request
): Promise<{ ok: true; value: unknown } | { ok: false; status: 413 | 415 | 422; error: string }> {
  const declared = request.headers.get("content-length");
  if (declared != null && declared !== "") {
    if (!/^\d+$/.test(declared) || Number(declared) > BODY_MAX_BYTES) {
      return { ok: false, status: 413, error: "Request body is too large." };
    }
  }
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.byteLength > BODY_MAX_BYTES) {
    return { ok: false, status: 413, error: "Request body is too large." };
  }
  const mime = request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() ?? "";
  if (mime !== "application/json") {
    return { ok: false, status: 415, error: "Request body must be JSON." };
  }
  const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { ok: false, status: 415, error: "Request body must be JSON." };
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { ok: false, status: 422, error: "Request body must be an object." };
  }
  return { ok: true, value };
}

export function parseCreateBody(
  value: unknown
): { ok: true; title: string | null } | { ok: false; error: string } {
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (key !== "title") return { ok: false, error: `Unknown field ${key}.` };
  }
  return parseTitle(record.title);
}

export function parseMessageBody(
  value: unknown
): { ok: true; message: string } | { ok: false; error: string } {
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (key !== "message") return { ok: false, error: `Unknown field ${key}.` };
  }
  return parseMessageText(record.message);
}
