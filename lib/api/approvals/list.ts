// Brand-scoped reads of api_write_actions. Every query filters
// brand_id to the session user. The response is an allowlist.
// payload is read only to build the summary and is not returned.
// payload_hash, key_hash, and idempotency_key are never selected
// into the response.

import { supabaseAdmin } from "@/lib/supabase/admin";
import { getAuthenticatedUser } from "@/lib/data/queries";
import { getShow } from "@/lib/api/v1/reads";
import { ApiReadError } from "@/lib/api/v1/handler";
import {
  cursorFilter,
  encodeCursor,
  isUuid,
  parseCursor,
  parseLimit,
  type Cursor,
} from "@/lib/api/v1/pagination";
import type { ActionKind, ActionStatus } from "@/lib/api/v1/writes";

export const PENDING_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

const LIST_STATUSES = ["pending", "approved", "rejected", "expired"] as const;

export type ActionListStatus = (typeof LIST_STATUSES)[number];

const GOAL_LABELS: Record<string, string> = {
  test_channel: "Test the channel",
  scale_winner: "Scale a winner",
  direct_response: "Direct response",
  brand_awareness: "Brand awareness",
  lead_gen: "Lead gen",
};

const FLIGHT_LABELS: Record<string, string> = {
  asap: "ASAP",
  next_30_days: "Next 30 days",
  next_60_days: "Next 60 days",
  next_quarter: "Next quarter",
};

const ACTION_COLUMNS = [
  "id",
  "kind",
  "status",
  "created_at",
  "decided_at",
  "decision_note",
  "executed_at",
  "result_campaign_id",
  "execution_error",
  "api_key_id",
  "source",
  "payload",
].join(", ");

export interface ActionKeySummary {
  name: string | null;
  prefix: string | null;
}

export interface CampaignActionSummary {
  type: "campaign";
  brand_name: string | null;
  budget_total: number | null;
  goals: string | null;
  flight: string | null;
}

export interface OutreachActionSummary {
  type: "outreach";
  show_name: string | null;
  subject: string | null;
  body: string | null;
}

export type ActionSummary = CampaignActionSummary | OutreachActionSummary;

export interface ListedAction {
  id: string;
  kind: ActionKind;
  status: ActionStatus;
  created_at: string;
  decided_at: string | null;
  decision_note: string | null;
  executed_at: string | null;
  result_campaign_id: string | null;
  execution_error: string | null;
  key: ActionKeySummary;
  summary: ActionSummary;
}

export type BrandActor =
  | { ok: true; userId: string }
  | { ok: false; httpStatus: 401 | 403 | 500; error: string };

export type ActionListResult =
  | { ok: true; data: ListedAction[]; nextCursor: string | null }
  | { ok: false; httpStatus: 400 | 500; error: string };

interface RawAction {
  id: string;
  kind: string;
  status: string;
  created_at: string;
  decided_at: string | null;
  decision_note: string | null;
  executed_at: string | null;
  result_campaign_id: string | null;
  execution_error: string | null;
  api_key_id: string | null;
  source: "api_key" | "command_agent";
  payload: unknown;
}

export function pendingCutoff(now = Date.now()): string {
  return new Date(now - PENDING_WINDOW_MS).toISOString();
}

export function isPendingExpired(createdAt: string, now = Date.now()): boolean {
  const created = Date.parse(createdAt);
  if (!Number.isFinite(created)) return false;
  return created < now - PENDING_WINDOW_MS;
}

export function quoteFilterValue(value: string): string {
  if (/[.,:()]/.test(value)) return `"${value.replace(/"/g, "")}"`;
  return value;
}

/** PostgREST `or` for the expired tab, including pending rows past 14 days. */
export function expiredStatusFilter(cutoff: string, cursor: Cursor | null): string {
  const quoted = quoteFilterValue(cutoff);
  const expired = `status.eq.expired,and(status.eq.pending,created_at.lt.${quoted})`;
  if (!cursor) return expired;
  return `and(or(${expired}),or(${cursorFilter(cursor)}))`;
}

export async function requireBrand(): Promise<BrandActor> {
  const user = await getAuthenticatedUser();
  if (!user) return { ok: false, httpStatus: 401, error: "Unauthorized" };
  const role = await readProfileRole(user.id);
  if (role === "error") {
    return { ok: false, httpStatus: 500, error: "Could not load profile." };
  }
  if (role !== "brand") return { ok: false, httpStatus: 403, error: "Forbidden" };
  return { ok: true, userId: user.id };
}

export async function readProfileRole(
  userId: string
): Promise<"brand" | "other" | "error"> {
  try {
    const { data, error } = await supabaseAdmin
      .from("profiles")
      .select("role")
      .eq("id", userId)
      .maybeSingle<{ role?: string | null }>();
    if (error) return "error";
    return data?.role === "brand" ? "brand" : "other";
  } catch {
    return "error";
  }
}

export async function listBrandActions(
  userId: string,
  req: Request,
  now = Date.now()
): Promise<ActionListResult> {
  if (!isUuid(userId)) return { ok: false, httpStatus: 500, error: "Could not load actions." };
  const url = new URL(req.url);
  const status = parseStatus(url.searchParams.get("status"));
  if (!status.ok) return { ok: false, httpStatus: 400, error: "Invalid status." };
  const limit = parseLimit(url.searchParams.get("limit"));
  if (!limit.ok) return { ok: false, httpStatus: 400, error: "Invalid limit." };
  const cursor = parseCursor(url.searchParams.get("cursor"));
  if (!cursor.ok) return { ok: false, httpStatus: 400, error: "Invalid cursor." };

  const cutoff = pendingCutoff(now);
  const rows = await queryActions(userId, status.status, cutoff, cursor.cursor, limit.limit);
  if (!rows.ok) return { ok: false, httpStatus: 500, error: "Could not load actions." };

  const hasMore = rows.rows.length > limit.limit;
  const page = hasMore ? rows.rows.slice(0, limit.limit) : rows.rows;
  const keys = await loadKeys(userId, keyIdsToLoad(page));
  const shows = await loadShowNames(userId, page);
  const data = page.map((row) =>
    toListed(row, row.api_key_id ? keys.get(row.api_key_id) ?? null : null, shows, now)
  );
  let nextCursor: string | null = null;
  if (hasMore && page.length > 0) {
    const last = page[page.length - 1];
    nextCursor = encodeCursor({ created_at: last.created_at, id: last.id });
  }
  return { ok: true, data, nextCursor };
}

export async function getBrandAction(
  userId: string,
  actionId: string,
  now = Date.now()
): Promise<ListedAction | null> {
  if (!isUuid(userId) || !isUuid(actionId)) return null;
  const { data, error } = await supabaseAdmin
    .from("api_write_actions")
    .select(ACTION_COLUMNS)
    .eq("brand_id", userId)
    .eq("id", actionId)
    .maybeSingle();
  if (error || !data) return null;
  const row = asRaw(data as unknown as Record<string, unknown>);
  if (!row) return null;
  const keys = await loadKeys(userId, keyIdsToLoad([row]));
  const shows = await loadShowNames(userId, [row]);
  return toListed(row, row.api_key_id ? keys.get(row.api_key_id) ?? null : null, shows, now);
}

function parseStatus(
  raw: string | null
): { ok: true; status: ActionListStatus } | { ok: false } {
  if (raw == null || raw.trim() === "") return { ok: true, status: "pending" };
  const status = raw.trim();
  if (!LIST_STATUSES.includes(status as ActionListStatus)) return { ok: false };
  return { ok: true, status: status as ActionListStatus };
}

async function queryActions(
  userId: string,
  status: ActionListStatus,
  cutoff: string,
  cursor: Cursor | null,
  limit: number
): Promise<{ ok: true; rows: RawAction[] } | { ok: false }> {
  let query = supabaseAdmin
    .from("api_write_actions")
    .select(ACTION_COLUMNS)
    .eq("brand_id", userId);

  if (status === "pending") {
    query = query.eq("status", "pending").gte("created_at", cutoff);
    if (cursor) query = query.or(cursorFilter(cursor));
  } else if (status === "approved" || status === "rejected") {
    query = query.eq("status", status);
    if (cursor) query = query.or(cursorFilter(cursor));
  } else {
    query = query.or(expiredStatusFilter(cutoff, cursor));
  }

  const { data, error } = await query
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(limit + 1);
  if (error) {
    console.error("[approvals.list]", error.code ?? "read failed");
    return { ok: false };
  }
  const rows: RawAction[] = [];
  for (const item of data ?? []) {
    const row = asRaw(item as unknown as Record<string, unknown>);
    if (row) rows.push(row);
  }
  return { ok: true, rows };
}

async function loadKeys(
  userId: string,
  keyIds: string[]
): Promise<Map<string, ActionKeySummary>> {
  const ids = [...new Set(keyIds.filter((id) => isUuid(id)))];
  const out = new Map<string, ActionKeySummary>();
  if (ids.length === 0) return out;
  const { data, error } = await supabaseAdmin
    .from("api_keys")
    .select("id, name, prefix, brand_id")
    .eq("brand_id", userId)
    .in("id", ids);
  if (error || !data) return out;
  for (const item of data) {
    const row = item as unknown as Record<string, unknown>;
    if (row.brand_id !== userId || typeof row.id !== "string") continue;
    out.set(row.id, {
      name: typeof row.name === "string" && row.name.trim() ? row.name : null,
      prefix: typeof row.prefix === "string" ? row.prefix : null,
    });
  }
  return out;
}

async function loadShowNames(
  userId: string,
  rows: RawAction[]
): Promise<Map<string, string | null>> {
  const names = new Map<string, string | null>();
  const ids: string[] = [];
  for (const row of rows) {
    if (row.kind !== "outreach.draft") continue;
    const showId = showIdOf(row.payload);
    if (showId && !ids.includes(showId)) ids.push(showId);
  }
  await Promise.all(
    ids.map(async (showId) => {
      try {
        const show = await getShow(userId, showId);
        names.set(showId, typeof show.name === "string" && show.name.trim() ? show.name : null);
      } catch (err) {
        if (!(err instanceof ApiReadError)) {
          console.error("[approvals.list] show read failed");
        }
        names.set(showId, null);
      }
    })
  );
  return names;
}

function keyIdsToLoad(rows: RawAction[]): string[] {
  const ids: string[] = [];
  for (const row of rows) {
    if (row.source === "command_agent") continue;
    if (row.api_key_id && isUuid(row.api_key_id) && !ids.includes(row.api_key_id)) {
      ids.push(row.api_key_id);
    }
  }
  return ids;
}

function toListed(
  row: RawAction,
  key: ActionKeySummary | null,
  shows: Map<string, string | null>,
  now: number
): ListedAction {
  const kind: ActionKind = row.kind === "outreach.draft" ? "outreach.draft" : "campaign.create";
  const stored = isStatus(row.status) ? row.status : "pending";
  const status: ActionStatus =
    stored === "pending" && isPendingExpired(row.created_at, now) ? "expired" : stored;
  return {
    id: row.id,
    kind,
    status,
    created_at: row.created_at,
    decided_at: row.decided_at,
    decision_note: row.decision_note,
    executed_at: row.executed_at,
    result_campaign_id: row.result_campaign_id,
    execution_error: row.execution_error,
    key: row.source === "command_agent" ? { name: "Tay", prefix: null } : (key ?? { name: null, prefix: null }),
    summary: summaryOf(kind, row.payload, shows),
  };
}

function summaryOf(
  kind: ActionKind,
  payload: unknown,
  shows: Map<string, string | null>
): ActionSummary {
  const record = isRecord(payload) ? payload : {};
  if (kind === "outreach.draft") {
    const showId = showIdOf(payload);
    return {
      type: "outreach",
      show_name: showId ? shows.get(showId) ?? null : null,
      subject: textOf(record.subject, 500),
      body: textOf(record.body, 5000),
    };
  }
  const product = isRecord(record.product) ? record.product : null;
  return {
    type: "campaign",
    brand_name: textOf(product?.brand_name, 200),
    budget_total: typeof record.budget_total === "number" && Number.isFinite(record.budget_total)
      ? record.budget_total
      : null,
    goals: goalLine(record.goals),
    flight: flightLine(record.flight),
  };
}

function goalLine(value: unknown): string | null {
  if (!Array.isArray(value)) return null;
  const labels = value
    .filter((item): item is string => typeof item === "string")
    .slice(0, 8)
    .map((item) => GOAL_LABELS[item] ?? item.trim().slice(0, 80))
    .filter((item) => item.length > 0);
  return labels.length > 0 ? labels.join(", ") : null;
}

function flightLine(value: unknown): string | null {
  if (!isRecord(value)) return null;
  if (value.mode === "preset" && typeof value.preset === "string") {
    return FLIGHT_LABELS[value.preset] ?? value.preset.trim().slice(0, 80);
  }
  if (value.mode === "dates") {
    const start = textOf(value.start_date, 40) ?? "";
    const end = textOf(value.end_date, 40) ?? "";
    if (!start && !end) return null;
    return `${start} to ${end}`;
  }
  return null;
}

function showIdOf(payload: unknown): string | null {
  if (!isRecord(payload) || typeof payload.show_id !== "string") return null;
  return isUuid(payload.show_id) ? payload.show_id.toLowerCase() : null;
}

function asRaw(row: Record<string, unknown>): RawAction | null {
  if (typeof row.id !== "string" || !isUuid(row.id)) return null;
  const apiKeyId = row.api_key_id == null ? null : row.api_key_id;
  if (apiKeyId !== null && typeof apiKeyId !== "string") return null;
  return {
    id: row.id,
    kind: typeof row.kind === "string" ? row.kind : "",
    status: typeof row.status === "string" ? row.status : "",
    created_at: timestampOf(row.created_at),
    decided_at: row.decided_at == null ? null : timestampOf(row.decided_at),
    decision_note: typeof row.decision_note === "string" ? row.decision_note : null,
    executed_at: row.executed_at == null ? null : timestampOf(row.executed_at),
    result_campaign_id:
      typeof row.result_campaign_id === "string" && isUuid(row.result_campaign_id)
        ? row.result_campaign_id
        : null,
    execution_error: typeof row.execution_error === "string" ? row.execution_error : null,
    api_key_id: apiKeyId,
    source: row.source === "command_agent" ? "command_agent" : "api_key",
    payload: row.payload ?? null,
  };
}

function timestampOf(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string" && value.length > 0) return value;
  return new Date(0).toISOString();
}

function textOf(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStatus(value: string): value is ActionStatus {
  return value === "pending" || value === "approved" || value === "rejected" || value === "expired";
}
