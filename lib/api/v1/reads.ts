// Brand-scoped service-role reads for /api/v1.
//
// lib/data list helpers either need a user session or do not filter to this
// brand, so they are not used here. getWave12DealsForBrand filters
// brand_profile_id only and selects every column. Deals in this module match
// deals.brand_id = brand user, or a brand_profiles row owned by that user.
// Campaigns match campaigns.user_id. A show is visible when is_discoverable
// is true, or when one of this brand's deals points at it.
// `verified` is true only when getVerifiedProfileTies reports a tie.
// The shows.is_verified column is not copied.

import { supabaseAdmin } from "@/lib/supabase/admin";
import { getVerifiedProfileTies } from "@/lib/shows/apply-geography";
import { ApiReadError } from "@/lib/api/v1/handler";
import {
  cursorFilter,
  encodeCursor,
  isUuid,
  parseCursor,
  parseLimit,
  type Cursor,
} from "@/lib/api/v1/pagination";
import {
  serializeCampaign,
  serializeDeal,
  serializePlan,
  serializeScore,
  serializeShow,
  type SerializedCampaign,
  type SerializedDeal,
  type SerializedPlan,
  type SerializedScore,
  type SerializedShow,
} from "@/lib/api/v1/serializers";

const SHOW_COLUMNS = [
  "id",
  "name",
  "slug",
  "platform",
  "categories",
  "audience_size",
  "description",
  "image_url",
  "network",
  "tags",
  "demographics",
  "audience_interests",
  "audience_purchase_power",
  "rate_card",
  "price_type",
  "min_buy",
  "ad_formats",
  "episode_cadence",
  "avg_episode_length_min",
  "current_sponsors",
  "past_sponsors",
  "apple_id",
  "spotify_id",
  "youtube_channel_id",
  "rss_url",
  "available_slots",
  "next_available_date",
  "is_discoverable",
  "contact_email",
  "data_sources",
  "created_at",
].join(", ");

const CAMPAIGN_COLUMNS = [
  "id",
  "name",
  "status",
  "budget_total",
  "platforms",
  "brief",
  "test_spot_count",
  "test_placement",
  "created_at",
  "updated_at",
].join(", ");

const SCORE_COLUMNS = [
  "id",
  "show_id",
  "ring_hypothesis_id",
  "audience_fit_score",
  "topical_relevance_score",
  "purchase_power_score",
  "composite_score",
  "conviction_band",
  "reasoning",
  "tier",
  "created_at",
].join(", ");

const DEAL_COLUMNS = [
  "id",
  "campaign_id",
  "show_id",
  "status",
  "placement",
  "ad_format",
  "num_episodes",
  "flight_start",
  "flight_end",
  "price_type",
  "cpm_rate",
  "gross_cpm",
  "gross_per_episode",
  "total_gross",
  "agreed_cpm",
  "agreed_episode_count",
  "agreed_placement",
  "agreed_flight_start",
  "agreed_flight_end",
  "guaranteed_downloads",
  "created_at",
].join(", ");

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
  order(column: string, options?: { ascending?: boolean }): this;
  limit(count: number): this;
  maybeSingle(): PromiseLike<DbOne>;
}

export interface ApiPage<T> {
  data: T[];
  nextCursor: string | null;
}

export async function listShows(
  brandId: string,
  req: Request
): Promise<ApiPage<SerializedShow>> {
  assertBrand(brandId);
  const page = pageArgs(req);
  const showIds = await ownedShowIds(brandId);
  let query = supabaseAdmin.from("shows").select(SHOW_COLUMNS) as unknown as FilterQuery;
  const visible = visibleShowOr(showIds);
  query = visible ? query.or(visible) : query.eq("is_discoverable", true);
  const rows = await asList(applyPage(query, page.cursor, page.limit));
  const sliced = pageOf(rows, page.limit);
  return { data: await serializeShows(sliced.rows), nextCursor: sliced.nextCursor };
}

export async function getShow(brandId: string, showId: string): Promise<SerializedShow> {
  assertBrand(brandId);
  if (!isUuid(showId)) throw new ApiReadError(404, "Not found.");
  const row = await asOne(
    (
      supabaseAdmin.from("shows").select(SHOW_COLUMNS).eq("id", showId) as unknown as OneQuery
    ).maybeSingle()
  );
  if (!row) throw new ApiReadError(404, "Not found.");
  if (row.is_discoverable !== true && !(await brandOwnsShow(brandId, showId))) {
    throw new ApiReadError(404, "Not found.");
  }
  const shows = await serializeShows([row]);
  return shows[0];
}

export async function listCampaigns(
  brandId: string,
  req: Request
): Promise<ApiPage<SerializedCampaign>> {
  assertBrand(brandId);
  const page = pageArgs(req);
  const rows = await asList(
    applyPage(
      supabaseAdmin
        .from("campaigns")
        .select(CAMPAIGN_COLUMNS)
        .eq("user_id", brandId) as unknown as FilterQuery,
      page.cursor,
      page.limit
    )
  );
  const sliced = pageOf(rows, page.limit);
  const data: SerializedCampaign[] = [];
  for (const row of sliced.rows) data.push(serializeCampaign(row));
  return { data, nextCursor: sliced.nextCursor };
}

export async function getCampaign(
  brandId: string,
  campaignId: string
): Promise<SerializedCampaign> {
  const row = await ownedCampaign(brandId, campaignId, CAMPAIGN_COLUMNS);
  return serializeCampaign(row);
}

export async function listScores(
  brandId: string,
  campaignId: string,
  req: Request
): Promise<ApiPage<SerializedScore>> {
  assertBrand(brandId);
  const page = pageArgs(req);
  await ownedCampaign(brandId, campaignId, "id");
  const pattern = await asOne(
    (
      supabaseAdmin
        .from("campaign_patterns")
        .select("id")
        .eq("campaign_id", campaignId)
        .order("created_at", { ascending: false })
        .limit(1) as unknown as OneQuery
    ).maybeSingle()
  );
  if (!pattern || typeof pattern.id !== "string" || !isUuid(pattern.id)) {
    return { data: [], nextCursor: null };
  }
  const rows = await asList(
    applyPage(
      supabaseAdmin
        .from("conviction_scores")
        .select(SCORE_COLUMNS)
        .eq("campaign_pattern_id", pattern.id) as unknown as FilterQuery,
      page.cursor,
      page.limit
    )
  );
  const sliced = pageOf(rows, page.limit);
  const data: SerializedScore[] = [];
  for (const row of sliced.rows) data.push(serializeScore(row));
  return { data, nextCursor: sliced.nextCursor };
}

export async function getPlan(
  brandId: string,
  campaignId: string
): Promise<SerializedPlan | null> {
  const row = await ownedCampaign(brandId, campaignId, "media_plan");
  return serializePlan(row.media_plan);
}

export async function listDeals(
  brandId: string,
  req: Request
): Promise<ApiPage<SerializedDeal>> {
  assertBrand(brandId);
  const page = pageArgs(req);
  const profileIds = await brandProfileIds(brandId);
  const rows = await asList(
    applyPage(
      (
        supabaseAdmin.from("deals").select(DEAL_COLUMNS) as unknown as FilterQuery
      ).or(ownerOr(brandId, profileIds)),
      page.cursor,
      page.limit
    )
  );
  const sliced = pageOf(rows, page.limit);
  const data: SerializedDeal[] = [];
  for (const row of sliced.rows) data.push(serializeDeal(row));
  return { data, nextCursor: sliced.nextCursor };
}

export async function getDeal(brandId: string, dealId: string): Promise<SerializedDeal> {
  assertBrand(brandId);
  if (!isUuid(dealId)) throw new ApiReadError(404, "Not found.");
  const profileIds = await brandProfileIds(brandId);
  const row = await asOne(
    (
      supabaseAdmin
        .from("deals")
        .select(DEAL_COLUMNS)
        .eq("id", dealId)
        .or(ownerOr(brandId, profileIds)) as unknown as OneQuery
    ).maybeSingle()
  );
  if (!row) throw new ApiReadError(404, "Not found.");
  return serializeDeal(row);
}

function assertBrand(brandId: string): void {
  if (!isUuid(brandId)) throw new Error("API read failed.");
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
  const created = timestampOf(last.created_at);
  const id = typeof last.id === "string" ? last.id : null;
  if (!created || !id) throw new Error("API read failed.");
  return { rows: page, nextCursor: encodeCursor({ created_at: created, id }) };
}

function timestampOf(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return value;
  return null;
}

async function brandProfileIds(brandId: string): Promise<string[]> {
  const rows = await asList(
    supabaseAdmin.from("brand_profiles").select("id").eq("user_id", brandId) as unknown as PromiseLike<DbList>
  );
  return uuidColumn(rows, "id");
}

async function ownedShowIds(brandId: string): Promise<string[]> {
  const profileIds = await brandProfileIds(brandId);
  const rows = await asList(
    (supabaseAdmin.from("deals").select("show_id") as unknown as FilterQuery).or(
      ownerOr(brandId, profileIds)
    )
  );
  return uuidColumn(rows, "show_id");
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

function ownerOr(brandId: string, profileIds: readonly string[]): string {
  if (profileIds.length === 0) return `brand_id.eq.${brandId}`;
  return `brand_id.eq.${brandId},brand_profile_id.in.(${profileIds.join(",")})`;
}

function visibleShowOr(showIds: readonly string[]): string | null {
  if (showIds.length === 0) return null;
  return `is_discoverable.eq.true,id.in.(${showIds.join(",")})`;
}

async function ownedCampaign(
  brandId: string,
  campaignId: string,
  columns: string
): Promise<Record<string, unknown>> {
  assertBrand(brandId);
  if (!isUuid(campaignId)) throw new ApiReadError(404, "Not found.");
  const row = await asOne(
    (
      supabaseAdmin
        .from("campaigns")
        .select(columns)
        .eq("id", campaignId)
        .eq("user_id", brandId) as unknown as OneQuery
    ).maybeSingle()
  );
  if (!row) throw new ApiReadError(404, "Not found.");
  return row;
}

async function serializeShows(rows: Record<string, unknown>[]): Promise<SerializedShow[]> {
  const ties = await getVerifiedProfileTies(
    rows.map((row) => ({
      showId: typeof row.id === "string" ? row.id : undefined,
      contactEmail: typeof row.contact_email === "string" ? row.contact_email : undefined,
      dataSources: sourceList(row.data_sources),
    }))
  );
  const verified = new Set<string>();
  for (const tie of ties) verified.add(tie.showId);
  const out: SerializedShow[] = [];
  for (const row of rows) {
    const id = typeof row.id === "string" ? row.id : "";
    out.push(serializeShow(row, verified.has(id)));
  }
  return out;
}

function sourceList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out: string[] = [];
  for (const item of value) {
    if (typeof item === "string") out.push(item);
  }
  return out;
}

function uuidColumn(rows: Record<string, unknown>[], column: string): string[] {
  const ids: string[] = [];
  for (const row of rows) {
    const id = row[column];
    if (typeof id === "string" && isUuid(id) && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

function failRead(error: DbError): never {
  console.warn("[api.v1] read failed:", error.code ?? "unknown");
  throw new Error("API read failed.");
}

async function asList(query: PromiseLike<DbList>): Promise<Record<string, unknown>[]> {
  const result = await query;
  if (result.error) failRead(result.error);
  return result.data ?? [];
}

async function asOne(query: PromiseLike<DbOne>): Promise<Record<string, unknown> | null> {
  const result = await query;
  if (result.error) failRead(result.error);
  return result.data;
}
