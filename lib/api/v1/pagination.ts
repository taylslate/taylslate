// Opaque cursor over (created_at, id), newest first.
// limit defaults to 25 and clamps to 100.

import { Buffer } from "node:buffer";

export const DEFAULT_PAGE_LIMIT = 25;
export const MAX_PAGE_LIMIT = 100;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Keep the stored timestamp. Rewriting microseconds would skip or repeat a row.
const CURSOR_TIME =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;

export interface Cursor {
  created_at: string;
  id: string;
}

export type LimitParse = { ok: true; limit: number } | { ok: false };

export type CursorParse =
  | { ok: true; cursor: Cursor | null }
  | { ok: false };

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

export function parseLimit(raw: string | null): LimitParse {
  if (raw == null || raw.trim() === "") {
    return { ok: true, limit: DEFAULT_PAGE_LIMIT };
  }
  const text = raw.trim();
  if (text.length > 6 || !/^[0-9]+$/.test(text)) return { ok: false };
  const value = Number(text);
  if (!Number.isInteger(value) || value < 1) return { ok: false };
  return { ok: true, limit: Math.min(value, MAX_PAGE_LIMIT) };
}

export function encodeCursor(input: { created_at: string; id: string }): string {
  const created = normalizeTimestamp(input.created_at);
  const id = input.id.toLowerCase();
  if (!created || !isUuid(id)) {
    throw new Error("Cursor could not be encoded.");
  }
  const payload = JSON.stringify({ created_at: created, id });
  return Buffer.from(payload, "utf8").toString("base64url");
}

export function decodeCursor(token: string): Cursor | null {
  if (token.length === 0 || token.length > 512) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(token, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return null;
  }
  const record = parsed as Record<string, unknown>;
  const created = record.created_at;
  const id = record.id;
  if (typeof created !== "string" || typeof id !== "string") return null;
  if (!CURSOR_TIME.test(created) || !isUuid(id)) return null;
  return { created_at: created, id: id.toLowerCase() };
}

export function parseCursor(raw: string | null): CursorParse {
  if (raw == null || raw.trim() === "") return { ok: true, cursor: null };
  const cursor = decodeCursor(raw.trim());
  if (!cursor) return { ok: false };
  return { ok: true, cursor };
}

/** PostgREST `or` filter: rows strictly before this cursor in (created_at desc, id desc). */
export function cursorFilter(cursor: Cursor): string {
  const created = quoteFilterValue(cursor.created_at);
  const id = quoteFilterValue(cursor.id);
  return `created_at.lt.${created},and(created_at.eq.${created},id.lt.${id})`;
}

function quoteFilterValue(value: string): string {
  if (/[.,:()]/.test(value)) return `"${value.replace(/"/g, "")}"`;
  return value;
}

function normalizeTimestamp(value: string): string | null {
  if (CURSOR_TIME.test(value)) return value;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return null;
  const iso = new Date(parsed).toISOString();
  return CURSOR_TIME.test(iso) ? iso : null;
}
