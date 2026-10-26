// Pending v1 writes. Validation and the api_write_actions insert live
// here. Nothing in this module inserts or updates campaigns, deals,
// outreach, shows, or agent_show_relationships, and nothing is sent
// or charged. A show is visible on the same rule as getShow: discoverable,
// or owned by this brand through a deal.

import { createHash } from "node:crypto";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { ApiReadError, ApiWriteError, type ApiWriteContext } from "@/lib/api/v1/handler";
import {
  cursorFilter,
  encodeCursor,
  isUuid,
  parseCursor,
  parseLimit,
  type Cursor,
} from "@/lib/api/v1/pagination";
import type { ApiPage } from "@/lib/api/v1/reads";
import { validateFlightDates } from "@/lib/validation/flight-dates";
import type {
  AovBucket,
  BriefChangedFieldKey,
  BriefFlight,
  BriefFlightPreset,
  BriefGoal,
  BriefProduct,
} from "@/lib/data/types";

const MIN_BUDGET = 5000;
const MAX_GOALS = 3;
const SUBJECT_MAX = 200;
const BODY_MIN = 30;
const BODY_MAX = 5000;

const GOALS: readonly BriefGoal[] = [
  "test_channel",
  "scale_winner",
  "direct_response",
  "brand_awareness",
  "lead_gen",
];

const PRESETS: readonly BriefFlightPreset[] = [
  "asap",
  "next_30_days",
  "next_60_days",
  "next_quarter",
];

const AOV: readonly AovBucket[] = ["low", "mid", "high"];

const CHANGED_FIELDS: readonly BriefChangedFieldKey[] = [
  "product_url",
  "customer_description",
  "exclusions",
];

const CAMPAIGN_KEYS = [
  "product",
  "customer_text",
  "customer_context",
  "goals",
  "goals_context",
  "budget_total",
  "flight",
  "exclusions_text",
] as const;

const PRODUCT_KEYS = [
  "brand_name",
  "category",
  "product_description",
  "aov_bucket",
  "aov_reasoning",
  "key_attributes",
  "source",
  "url",
] as const;

const DERIVATION_KEYS = [
  "brand_name",
  "category",
  "product_description",
  "aov_bucket",
  "aov_reasoning",
  "key_attributes",
] as const;

const CONTEXT_KEYS = [
  "reused_from_pattern_id",
  "delta_text",
  "product_url",
  "changed_fields",
  "product_attributes",
] as const;

const FLIGHT_KEYS = ["mode", "preset", "start_date", "end_date"] as const;
const OUTREACH_KEYS = ["show_id", "subject", "body"] as const;

const ACTION_COLUMNS = [
  "id",
  "kind",
  "status",
  "idempotency_key",
  "payload",
  "created_at",
  "decided_at",
  "decided_by",
].join(", ");

const ACTION_KINDS = ["campaign.create", "outreach.draft"] as const;
const ACTION_STATUSES = ["pending", "approved", "rejected", "expired"] as const;

export type ActionKind = (typeof ACTION_KINDS)[number];
export type ActionStatus = (typeof ACTION_STATUSES)[number];

export interface CampaignCreatePayload {
  product?: BriefProduct;
  customer_text?: string;
  customer_context?: CustomerContextPayload;
  goals: BriefGoal[];
  goals_context?: string;
  budget_total: number;
  flight: BriefFlight;
  exclusions_text?: string;
}

export interface CustomerContextPayload {
  reused_from_pattern_id: string;
  delta_text?: string;
  product_url?: string | null;
  changed_fields?: Partial<
    Record<BriefChangedFieldKey, { before: string | null; after: string | null }>
  >;
  product_attributes?: {
    brand_name: string;
    category: string;
    product_description?: string;
    aov_bucket: AovBucket;
    aov_reasoning?: string;
    key_attributes?: string[];
  };
}

export interface OutreachDraftPayload {
  show_id: string;
  subject: string;
  body: string;
}

export interface RecordedAction {
  actionId: string;
  status: ActionStatus;
  replay: boolean;
}

export interface SerializedAction {
  id: string;
  kind: ActionKind;
  status: ActionStatus;
  idempotency_key: string;
  payload: Record<string, unknown>;
  created_at: string;
  decided_at: string | null;
  decided_by: string | null;
}

interface DbError {
  code?: string;
  message?: string;
}

interface DbList {
  data: Record<string, unknown>[] | null;
  error: DbError | null;
}

interface DbOne {
  data: Record<string, unknown> | null;
  error: DbError | null;
}

interface FilterQuery extends PromiseLike<DbList> {
  eq(column: string, value: unknown): this;
  or(filters: string): this;
  order(column: string, options?: { ascending?: boolean }): this;
  limit(count: number): this;
}

interface OneQuery {
  eq(column: string, value: unknown): this;
  or(filters: string): this;
  limit(count: number): this;
  maybeSingle(): PromiseLike<DbOne>;
}

interface InsertQuery {
  select(columns: string): {
    single(): PromiseLike<DbOne>;
  };
}

export function validateCampaignCreate(body: unknown): CampaignCreatePayload {
  const record = bodyRecord(body);
  rejectUnknown(record, CAMPAIGN_KEYS);
  const context = customerContext(record.customer_context);
  const reusing = context != null;
  const product = record.product == null ? undefined : productOf(record.product);
  if (!reusing && !product) {
    throw new ApiWriteError(422, "Product details are required");
  }
  const customer = optionalText(record.customer_text, "customer_text");
  if (!reusing && !customer) {
    throw new ApiWriteError(422, "Tell us about your customer");
  }
  const payload: CampaignCreatePayload = {
    goals: goalsOf(record.goals),
    budget_total: budgetOf(record.budget_total),
    flight: flightOf(record.flight),
  };
  if (product) payload.product = product;
  if (customer) payload.customer_text = customer;
  if (context) payload.customer_context = context;
  const goalsContext = optionalText(record.goals_context, "goals_context");
  if (goalsContext) payload.goals_context = goalsContext;
  const exclusions = optionalText(record.exclusions_text, "exclusions_text");
  if (exclusions) payload.exclusions_text = exclusions;
  return payload;
}

export function validateOutreachDraft(body: unknown): OutreachDraftPayload {
  const record = bodyRecord(body);
  rejectUnknown(record, OUTREACH_KEYS);
  if (record.show_id == null || record.show_id === "") {
    throw new ApiWriteError(422, "show_id is required.");
  }
  if (typeof record.show_id !== "string" || !isUuid(record.show_id)) {
    throw new ApiWriteError(404, "Not found.");
  }
  const subject = requiredText(record.subject, "subject");
  if (subject.length > SUBJECT_MAX) {
    throw new ApiWriteError(422, "subject is too long.");
  }
  if (/[\u0000-\u001F\u007F]/.test(subject)) {
    throw new ApiWriteError(422, "subject must be printable text.");
  }
  const message = requiredText(record.body, "body");
  if (message.length < BODY_MIN) throw new ApiWriteError(422, "body is too short.");
  if (message.length > BODY_MAX) throw new ApiWriteError(422, "body is too long.");
  return { show_id: record.show_id.toLowerCase(), subject, body: message };
}

export async function recordCampaignCreate(ctx: ApiWriteContext): Promise<RecordedAction> {
  const payload = validateCampaignCreate(ctx.body);
  return recordAction({
    brandId: ctx.brandId,
    keyId: ctx.keyId,
    kind: "campaign.create",
    payload,
    idempotencyKey: ctx.idempotencyKey,
  });
}

export async function recordOutreachDraft(ctx: ApiWriteContext): Promise<RecordedAction> {
  const payload = validateOutreachDraft(ctx.body);
  return recordAction({
    brandId: ctx.brandId,
    keyId: ctx.keyId,
    kind: "outreach.draft",
    payload,
    idempotencyKey: ctx.idempotencyKey,
    beforeInsert: () => assertShowVisible(ctx.brandId, payload.show_id),
  });
}

export async function listWriteActions(
  brandId: string,
  req: Request
): Promise<ApiPage<SerializedAction>> {
  assertBrand(brandId);
  const page = pageArgs(req);
  const rows = await asList(
    applyPage(
      supabaseAdmin
        .from("api_write_actions")
        .select(ACTION_COLUMNS)
        .eq("brand_id", brandId) as unknown as FilterQuery,
      page.cursor,
      page.limit
    )
  );
  const sliced = pageOf(rows, page.limit);
  return {
    data: sliced.rows.map(serializeAction),
    nextCursor: sliced.nextCursor,
  };
}

export async function getWriteAction(
  brandId: string,
  actionId: string
): Promise<SerializedAction> {
  assertBrand(brandId);
  if (!isUuid(actionId)) throw new ApiReadError(404, "Not found.");
  const row = await asOne(
    (
      supabaseAdmin
        .from("api_write_actions")
        .select(ACTION_COLUMNS)
        .eq("brand_id", brandId)
        .eq("id", actionId) as unknown as OneQuery
    ).maybeSingle()
  );
  if (!row) throw new ApiReadError(404, "Not found.");
  return serializeAction(row);
}

async function recordAction(input: {
  brandId: string;
  keyId: string;
  kind: ActionKind;
  payload: CampaignCreatePayload | OutreachDraftPayload;
  idempotencyKey: string;
  beforeInsert?: () => Promise<void>;
}): Promise<RecordedAction> {
  assertBrand(input.brandId);
  if (!isUuid(input.keyId)) throw new Error("API write failed.");
  const hash = payloadHash(input.payload);
  const existing = await findAction(input.brandId, input.idempotencyKey);
  if (existing) return settle(existing, input.kind, hash);
  if (input.beforeInsert) await input.beforeInsert();
  const inserted = await (
    supabaseAdmin.from("api_write_actions").insert({
      brand_id: input.brandId,
      api_key_id: input.keyId,
      kind: input.kind,
      payload: input.payload,
      payload_hash: hash,
      idempotency_key: input.idempotencyKey,
      status: "pending",
    }) as unknown as InsertQuery
  )
    .select("id, status")
    .single();
  if (inserted.error?.code === "23505") {
    const again = await findAction(input.brandId, input.idempotencyKey);
    if (!again) throw new Error("API write failed.");
    return settle(again, input.kind, hash);
  }
  if (inserted.error || !inserted.data) failWrite(inserted.error);
  return {
    actionId: stringField(inserted.data, "id"),
    status: statusField(inserted.data.status),
    replay: false,
  };
}

async function findAction(
  brandId: string,
  idempotencyKey: string
): Promise<Record<string, unknown> | null> {
  return asOne(
    (
      supabaseAdmin
        .from("api_write_actions")
        .select("id, status, kind, payload_hash")
        .eq("brand_id", brandId)
        .eq("idempotency_key", idempotencyKey) as unknown as OneQuery
    ).maybeSingle()
  );
}

function settle(
  existing: Record<string, unknown>,
  kind: ActionKind,
  hash: string
): RecordedAction {
  if (existing.kind !== kind || existing.payload_hash !== hash) {
    throw new ApiWriteError(
      409,
      "Idempotency key was already used with a different payload."
    );
  }
  return {
    actionId: stringField(existing, "id"),
    status: statusField(existing.status),
    replay: true,
  };
}

async function assertShowVisible(brandId: string, showId: string): Promise<void> {
  const row = await asOne(
    (
      supabaseAdmin.from("shows").select("id, is_discoverable").eq("id", showId) as unknown as OneQuery
    ).maybeSingle()
  );
  if (!row) throw new ApiWriteError(404, "Not found.");
  if (row.is_discoverable === true) return;
  if (await brandOwnsShow(brandId, showId)) return;
  throw new ApiWriteError(404, "Not found.");
}

async function brandOwnsShow(brandId: string, showId: string): Promise<boolean> {
  const profileIds = await brandProfileIds(brandId);
  const rows = await asList(
    (supabaseAdmin.from("deals").select("id") as unknown as FilterQuery)
      .or(ownerOr(brandId, profileIds))
      .eq("show_id", showId)
      .limit(1)
  );
  return rows.length > 0;
}

async function brandProfileIds(brandId: string): Promise<string[]> {
  const rows = await asList(
    supabaseAdmin.from("brand_profiles").select("id").eq("user_id", brandId) as unknown as PromiseLike<DbList>
  );
  const ids: string[] = [];
  for (const row of rows) {
    const id = row.id;
    if (typeof id === "string" && isUuid(id) && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

function ownerOr(brandId: string, profileIds: readonly string[]): string {
  if (profileIds.length === 0) return `brand_id.eq.${brandId}`;
  return `brand_id.eq.${brandId},brand_profile_id.in.(${profileIds.join(",")})`;
}

function payloadHash(payload: unknown): string {
  return createHash("sha256").update(canonicalJson(payload)).digest("hex");
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    const source = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) {
      const child = source[key];
      if (child === undefined) continue;
      out[key] = canonicalize(child);
    }
    return out;
  }
  return value;
}

function bodyRecord(body: unknown): Record<string, unknown> {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new ApiWriteError(422, "Request body must be an object.");
  }
  return body as Record<string, unknown>;
}

function rejectUnknown(record: Record<string, unknown>, allowed: readonly string[]): void {
  for (const key of Object.keys(record)) {
    if (!allowed.includes(key)) {
      throw new ApiWriteError(422, `Unknown field ${key}.`);
    }
  }
}

function productOf(value: unknown): BriefProduct {
  const record = bodyRecord(value);
  rejectUnknown(record, PRODUCT_KEYS);
  const source = record.source;
  if (source !== "url" && source !== "paragraph") {
    throw new ApiWriteError(422, "Product details are required");
  }
  let url: string | null = null;
  if (record.url != null) {
    if (typeof record.url !== "string") {
      throw new ApiWriteError(422, "Product details are required");
    }
    url = record.url.trim() || null;
  }
  return {
    brand_name: requiredText(record.brand_name, "brand_name"),
    category: requiredText(record.category, "category"),
    product_description: requiredText(record.product_description, "product_description"),
    aov_bucket: aovOf(record.aov_bucket),
    aov_reasoning: requiredText(record.aov_reasoning, "aov_reasoning"),
    key_attributes: stringList(record.key_attributes, "key_attributes"),
    source,
    url,
  };
}

function customerContext(value: unknown): CustomerContextPayload | undefined {
  if (value == null) return undefined;
  const record = bodyRecord(value);
  rejectUnknown(record, CONTEXT_KEYS);
  const reused = record.reused_from_pattern_id;
  if (typeof reused !== "string" || !isUuid(reused)) {
    throw new ApiWriteError(422, "Reused campaign pattern not found");
  }
  const context: CustomerContextPayload = { reused_from_pattern_id: reused.toLowerCase() };
  const delta = optionalText(record.delta_text, "delta_text");
  if (delta) context.delta_text = delta;
  if (record.product_url !== undefined) {
    context.product_url = nullableText(record.product_url, "product_url");
  }
  if (record.changed_fields !== undefined) {
    context.changed_fields = changedFields(record.changed_fields);
  }
  if (record.product_attributes !== undefined) {
    context.product_attributes = productAttributes(record.product_attributes);
  }
  return context;
}

function changedFields(
  value: unknown
): CustomerContextPayload["changed_fields"] {
  const record = bodyRecord(value);
  const out: NonNullable<CustomerContextPayload["changed_fields"]> = {};
  for (const key of Object.keys(record)) {
    if (!CHANGED_FIELDS.includes(key as BriefChangedFieldKey)) {
      throw new ApiWriteError(422, "Invalid changed fields record");
    }
    const entry = bodyRecord(record[key]);
    rejectUnknown(entry, ["before", "after"]);
    out[key as BriefChangedFieldKey] = {
      before: nullableText(entry.before, "before"),
      after: nullableText(entry.after, "after"),
    };
  }
  return out;
}

function productAttributes(value: unknown): NonNullable<CustomerContextPayload["product_attributes"]> {
  const record = bodyRecord(value);
  rejectUnknown(record, DERIVATION_KEYS);
  const attributes: NonNullable<CustomerContextPayload["product_attributes"]> = {
    brand_name: requiredText(record.brand_name, "brand_name"),
    category: requiredText(record.category, "category"),
    aov_bucket: aovOf(record.aov_bucket),
  };
  if (record.product_description != null) {
    attributes.product_description = requiredText(record.product_description, "product_description");
  }
  if (record.aov_reasoning != null) {
    attributes.aov_reasoning = requiredText(record.aov_reasoning, "aov_reasoning");
  }
  if (record.key_attributes != null) {
    attributes.key_attributes = stringList(record.key_attributes, "key_attributes");
  }
  return attributes;
}

function goalsOf(value: unknown): BriefGoal[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_GOALS) {
    throw new ApiWriteError(422, `Pick 1-${MAX_GOALS} campaign goals`);
  }
  const goals: BriefGoal[] = [];
  for (const item of value) {
    if (typeof item !== "string" || !GOALS.includes(item as BriefGoal) || goals.includes(item as BriefGoal)) {
      throw new ApiWriteError(422, `Pick 1-${MAX_GOALS} campaign goals`);
    }
    goals.push(item as BriefGoal);
  }
  return goals;
}

function budgetOf(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < MIN_BUDGET) {
    throw new ApiWriteError(422, `Budget must be at least $${MIN_BUDGET.toLocaleString("en-US")}`);
  }
  return value;
}

function flightOf(value: unknown): BriefFlight {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ApiWriteError(422, "Pick a flight window");
  }
  const record = value as Record<string, unknown>;
  rejectUnknown(record, FLIGHT_KEYS);
  if (record.mode === "preset") {
    if (typeof record.preset !== "string" || !PRESETS.includes(record.preset as BriefFlightPreset)) {
      throw new ApiWriteError(422, "Pick a flight window preset");
    }
    return { mode: "preset", preset: record.preset as BriefFlightPreset };
  }
  if (record.mode === "dates") {
    if (typeof record.start_date !== "string" || typeof record.end_date !== "string") {
      throw new ApiWriteError(422, "Pick flight start and end dates");
    }
    const dateError = validateFlightDates(record.start_date, record.end_date);
    if (dateError) throw new ApiWriteError(422, dateError.message);
    return { mode: "dates", start_date: record.start_date, end_date: record.end_date };
  }
  throw new ApiWriteError(422, "Pick a flight window");
}

function aovOf(value: unknown): AovBucket {
  if (typeof value !== "string" || !AOV.includes(value as AovBucket)) {
    throw new ApiWriteError(422, "Product details are required");
  }
  return value as AovBucket;
}

function stringList(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new ApiWriteError(422, `${field} must be a list of text.`);
  }
  return value.map((item) => (item as string).trim()).filter((item) => item.length > 0);
}

function requiredText(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ApiWriteError(422, `${field} is required.`);
  }
  return value.trim();
}

function optionalText(value: unknown, field: string): string | undefined {
  if (value == null || value === "") return undefined;
  if (typeof value !== "string") throw new ApiWriteError(422, `${field} must be text.`);
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

function nullableText(value: unknown, field: string): string | null {
  if (value == null) return null;
  if (typeof value !== "string") throw new ApiWriteError(422, `${field} must be text.`);
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function serializeAction(row: Record<string, unknown>): SerializedAction {
  const kind = row.kind;
  if (kind !== "campaign.create" && kind !== "outreach.draft") {
    throw new Error("API read failed.");
  }
  const payload = row.payload;
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    throw new Error("API read failed.");
  }
  return {
    id: stringField(row, "id"),
    kind,
    status: statusField(row.status),
    idempotency_key: stringField(row, "idempotency_key"),
    payload: payload as Record<string, unknown>,
    created_at: timestampOf(row.created_at),
    decided_at: row.decided_at == null ? null : timestampOf(row.decided_at),
    decided_by: row.decided_by == null ? null : stringField(row, "decided_by"),
  };
}

function statusField(value: unknown): ActionStatus {
  if (typeof value !== "string" || !ACTION_STATUSES.includes(value as ActionStatus)) {
    throw new Error("API write failed.");
  }
  return value as ActionStatus;
}

function stringField(row: Record<string, unknown>, key: string): string {
  const value = row[key];
  if (typeof value !== "string" || value.length === 0) throw new Error("API write failed.");
  return value;
}

function timestampOf(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string" && value.length > 0) return value;
  throw new Error("API read failed.");
}

function assertBrand(brandId: string): void {
  if (!isUuid(brandId)) throw new Error("API write failed.");
}

function pageArgs(req: Request): { limit: number; cursor: Cursor | null } {
  const url = new URL(req.url);
  const limit = parseLimit(url.searchParams.get("limit"));
  if (!limit.ok) throw new ApiReadError(400, "Invalid limit.");
  const cursor = parseCursor(url.searchParams.get("cursor"));
  if (!cursor.ok) throw new ApiReadError(400, "Invalid cursor.");
  return { limit: limit.limit, cursor: cursor.cursor };
}

function applyPage(query: FilterQuery, cursor: Cursor | null, limit: number): FilterQuery {
  const ordered = query
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(limit + 1);
  if (!cursor) return ordered;
  return ordered.or(cursorFilter(cursor));
}

function pageOf(
  rows: Record<string, unknown>[],
  limit: number
): { rows: Record<string, unknown>[]; nextCursor: string | null } {
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  if (!hasMore || page.length === 0) return { rows: page, nextCursor: null };
  const last = page[page.length - 1];
  const created = typeof last.created_at === "string" ? last.created_at : null;
  const id = typeof last.id === "string" ? last.id : null;
  if (!created || !id) throw new Error("API read failed.");
  return { rows: page, nextCursor: encodeCursor({ created_at: created, id }) };
}

function failWrite(error: DbError | null): never {
  console.warn("[api.v1] write failed:", error?.code ?? "unknown");
  throw new Error("API write failed.");
}

async function asList(query: PromiseLike<DbList>): Promise<Record<string, unknown>[]> {
  const result = await query;
  if (result.error) failWrite(result.error);
  return result.data ?? [];
}

async function asOne(query: PromiseLike<DbOne>): Promise<Record<string, unknown> | null> {
  const result = await query;
  if (result.error) failWrite(result.error);
  return result.data;
}
