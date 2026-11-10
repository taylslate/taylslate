// Strict argument checks for MCP tools. Unknown keys are rejected.
// Campaign and outreach bodies are checked by the v1 write validators.

import { ApiReadError, ApiWriteError } from "@/lib/api/v1/handler";
import { isUuid } from "@/lib/api/v1/pagination";
import { validateCampaignCreate, validateOutreachDraft } from "@/lib/api/v1/writes";

export const MCP_TOOL_NAMES = [
  "list_shows",
  "get_show",
  "list_campaigns",
  "get_campaign",
  "list_campaign_scores",
  "get_campaign_plan",
  "list_deals",
  "get_deal",
  "list_actions",
  "get_action",
  "propose_campaign",
  "propose_outreach",
] as const;

export type McpToolName = (typeof MCP_TOOL_NAMES)[number];

const LIST_TOOLS = new Set<McpToolName>([
  "list_shows",
  "list_campaigns",
  "list_deals",
  "list_actions",
]);

const ID_TOOLS = new Set<McpToolName>([
  "get_show",
  "get_campaign",
  "get_campaign_plan",
  "get_deal",
  "get_action",
]);

const PAGE_KEYS = ["cursor", "limit"] as const;
const ID_KEYS = ["id"] as const;
const SCORE_KEYS = ["id", "cursor", "limit"] as const;

const CAMPAIGN_KEYS = [
  "product",
  "customer_text",
  "customer_context",
  "goals",
  "goals_context",
  "budget_total",
  "flight",
  "exclusions_text",
  "idempotency_key",
] as const;

const OUTREACH_KEYS = ["show_id", "subject", "body", "idempotency_key"] as const;

const IDEMPOTENCY_KEY = /^[\x21-\x7E]{1,128}$/;

export class UnknownToolError extends Error {
  constructor() {
    super("Unknown tool.");
    this.name = "UnknownToolError";
  }
}

export interface ListArgs {
  kind: "list";
  cursor?: string;
  limit?: number;
}

export interface IdArgs {
  kind: "id";
  id: string;
}

export interface ScoreArgs {
  kind: "scores";
  id: string;
  cursor?: string;
  limit?: number;
}

export interface ProposeArgs {
  kind: "propose";
  idempotencyKey: string;
  body: Record<string, unknown>;
}

export type ValidatedArgs = ListArgs | IdArgs | ScoreArgs | ProposeArgs;

export function isMcpToolName(value: string): value is McpToolName {
  return (MCP_TOOL_NAMES as readonly string[]).includes(value);
}

export function validateToolArguments(name: string, value: unknown): ValidatedArgs {
  if (!isMcpToolName(name)) throw new UnknownToolError();
  const record = asRecord(value);
  if (LIST_TOOLS.has(name)) {
    rejectUnknown(record, PAGE_KEYS);
    return { kind: "list", ...pageFields(record) };
  }
  if (ID_TOOLS.has(name)) {
    rejectUnknown(record, ID_KEYS);
    return { kind: "id", id: readId(record.id) };
  }
  if (name === "list_campaign_scores") {
    rejectUnknown(record, SCORE_KEYS);
    return { kind: "scores", id: readId(record.id), ...pageFields(record) };
  }
  if (name === "propose_campaign") {
    rejectUnknown(record, CAMPAIGN_KEYS);
    const idempotencyKey = readIdempotency(record.idempotency_key);
    const body = without(record, "idempotency_key");
    validateCampaignCreate(body);
    return { kind: "propose", idempotencyKey, body };
  }
  rejectUnknown(record, OUTREACH_KEYS);
  const idempotencyKey = readIdempotency(record.idempotency_key);
  const body = without(record, "idempotency_key");
  validateOutreachDraft(body);
  return { kind: "propose", idempotencyKey, body };
}

function pageFields(record: Record<string, unknown>): { cursor?: string; limit?: number } {
  const out: { cursor?: string; limit?: number } = {};
  const cursor = readCursor(record.cursor);
  const limit = readLimit(record.limit);
  if (cursor) out.cursor = cursor;
  if (limit != null) out.limit = limit;
  return out;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ApiWriteError(422, "Arguments must be an object.");
  }
  return value as Record<string, unknown>;
}

function rejectUnknown(record: Record<string, unknown>, allowed: readonly string[]): void {
  for (const key of Object.keys(record)) {
    if (!allowed.includes(key)) {
      throw new ApiWriteError(422, `Unknown field ${key}.`);
    }
  }
}

function without(record: Record<string, unknown>, drop: string): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (key === drop) continue;
    body[key] = value;
  }
  return body;
}

function readId(value: unknown): string {
  if (typeof value !== "string" || !isUuid(value)) {
    throw new ApiReadError(404, "Not found.");
  }
  return value;
}

function readCursor(value: unknown): string | undefined {
  if (value == null || value === "") return undefined;
  if (typeof value !== "string") throw new ApiReadError(400, "Invalid cursor.");
  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;
  if (trimmed.length > 512) throw new ApiReadError(400, "Invalid cursor.");
  return trimmed;
}

function readLimit(value: unknown): number | undefined {
  if (value == null || value === "") return undefined;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw new ApiReadError(400, "Invalid limit.");
  }
  return value;
}

function readIdempotency(value: unknown): string {
  if (typeof value !== "string") {
    throw new ApiWriteError(400, "Idempotency-Key must be 1 to 128 printable characters.");
  }
  const trimmed = value.trim();
  if (!IDEMPOTENCY_KEY.test(trimmed)) {
    throw new ApiWriteError(400, "Idempotency-Key must be 1 to 128 printable characters.");
  }
  return trimmed;
}
