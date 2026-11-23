// Service-role writes for one deal price record. Snapshot columns are
// inserted once. Later calls only fill outcome columns or the rebook link.
// Public wrappers log a failure code and do not throw.

import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  buildDealPriceSnapshot,
  chooseIo,
  type DealSource,
  type IoSource,
  type LineSource,
} from "./snapshot";

const DEAL_SELECT = [
  "id",
  "show_id",
  "brand_id",
  "brand_profile_id",
  "agreed_cpm",
  "agreed_episode_count",
  "agreed_placement",
  "agreed_flight_start",
  "agreed_flight_end",
  "cpm_rate",
  "gross_cpm",
  "num_episodes",
  "placement",
  "ad_format",
  "price_type",
  "guaranteed_downloads",
  "total_net",
  "total_gross",
  "flight_start",
  "flight_end",
  "exclusivity_days",
  "rofr_days",
  "competitor_exclusion",
  "show_signed_at",
  "signed_io_pdf_url",
].join(",");

const IO_SELECT = [
  "id",
  "io_number",
  "deal_id",
  "total_gross",
  "total_net",
  "payment_terms",
  "exclusivity_days",
  "rofr_days",
  "cancellation_notice_days",
  "make_good_threshold",
  "competitor_exclusion",
  "payment_off_platform",
  "created_at",
].join(",");

const LINE_SELECT = [
  "io_id",
  "format",
  "placement",
  "guaranteed_downloads",
  "gross_rate",
  "gross_cpm",
  "price_type",
  "spot_format",
  "post_date",
  "verified",
  "actual_downloads",
].join(",");

const RECORD_SELECT = [
  "id",
  "deal_id",
  "show_id",
  "brand_id",
  "brand_profile_id",
  "booked_at",
  "created_at",
  "rebook_sequence",
  "prior_record_id",
  "rebooked",
  "delivered_at",
  "outcome_status",
  "unit_count",
  "agreed_total_gross",
  "signed_io_pdf_url",
].join(",");

export type OutcomeStatus =
  | "booked"
  | "delivering"
  | "delivered"
  | "make_good"
  | "cancelled";

export interface OutcomePatch {
  delivered_units?: number;
  delivered_at?: string | null;
  make_good_count?: number;
  make_good_credit_total?: number;
  actual_downloads?: number | null;
  reported_conversions?: number | null;
  outcome_status?: OutcomeStatus;
}

interface PriceRow {
  id: string;
  deal_id: string;
  show_id: string | null;
  brand_id: string | null;
  brand_profile_id: string | null;
  booked_at: string;
  created_at: string;
  rebook_sequence: number | null;
  prior_record_id: string | null;
  rebooked: boolean | null;
  delivered_at: string | null;
  outcome_status: string | null;
  unit_count: number | null;
  agreed_total_gross: number | string | null;
  signed_io_pdf_url?: string | null;
}

class QueryError extends Error {
  readonly code: string;
  constructor(code: string) {
    super("query_failed");
    this.name = "QueryError";
    this.code = code;
  }
}

function fail(scope: string, err: unknown): void {
  const code =
    err && typeof err === "object" && "code" in err && typeof (err as { code: unknown }).code === "string"
      ? (err as { code: string }).code.slice(0, 32)
      : "failed";
  console.error(`[deal-price-record] ${scope} failed ${code}`);
}

function raise(error: { code?: string } | null): void {
  if (!error) return;
  throw new QueryError(error.code || "query_failed");
}

async function loadDeal(dealId: string): Promise<DealSource | null> {
  const { data, error } = await supabaseAdmin
    .from("deals")
    .select(DEAL_SELECT)
    .eq("id", dealId)
    .maybeSingle();
  raise(error);
  return (data as DealSource | null) ?? null;
}

async function loadOrders(dealId: string): Promise<IoSource[]> {
  const { data, error } = await supabaseAdmin
    .from("insertion_orders")
    .select(IO_SELECT)
    .eq("deal_id", dealId);
  raise(error);
  return (data as IoSource[] | null) ?? [];
}

async function loadLines(ioId: string): Promise<LineSource[]> {
  const { data, error } = await supabaseAdmin
    .from("io_line_items")
    .select(LINE_SELECT)
    .eq("io_id", ioId);
  raise(error);
  return (data as LineSource[] | null) ?? [];
}

async function loadShowPlatform(showId: string | null): Promise<string | null> {
  if (!showId) return null;
  const { data, error } = await supabaseAdmin
    .from("shows")
    .select("platform")
    .eq("id", showId)
    .maybeSingle();
  raise(error);
  const platform = (data as { platform?: unknown } | null)?.platform;
  return typeof platform === "string" ? platform : null;
}

async function loadRecord(dealId: string): Promise<PriceRow | null> {
  const { data, error } = await supabaseAdmin
    .from("deal_price_records")
    .select(RECORD_SELECT)
    .eq("deal_id", dealId)
    .maybeSingle();
  raise(error);
  return (data as PriceRow | null) ?? null;
}

export async function createDealPriceRecord(
  dealId: string
): Promise<{ created: boolean }> {
  const deal = await loadDeal(dealId);
  if (!deal) {
    console.error("[deal-price-record] book skipped");
    return { created: false };
  }
  const orders = await loadOrders(dealId);
  const chosen = chooseIo(dealId, orders);
  const lines = chosen?.id ? await loadLines(chosen.id) : [];
  const showPlatform = await loadShowPlatform(deal.show_id ?? null);
  const snapshot = buildDealPriceSnapshot({
    deal,
    orders,
    lines,
    showPlatform,
  });
  const { error } = await supabaseAdmin.from("deal_price_records").insert(snapshot);
  if (error && error.code !== "23505") raise(error);
  return { created: !error };
}

function sameBrand(a: PriceRow, b: PriceRow): boolean {
  if (a.brand_profile_id && a.brand_profile_id === b.brand_profile_id) return true;
  if (a.brand_id && a.brand_id === b.brand_id) return true;
  return false;
}

function isEarlier(other: PriceRow, self: PriceRow): boolean {
  if (other.booked_at < self.booked_at) return true;
  if (other.booked_at > self.booked_at) return false;
  const otherCreated = other.created_at ?? "";
  const selfCreated = self.created_at ?? "";
  if (otherCreated < selfCreated) return true;
  if (otherCreated > selfCreated) return false;
  return other.id < self.id;
}

export async function linkRebook(dealId: string): Promise<{ linked: boolean }> {
  const self = await loadRecord(dealId);
  if (!self || !self.show_id) return { linked: false };
  if (self.prior_record_id) return { linked: true };

  const { data, error } = await supabaseAdmin
    .from("deal_price_records")
    .select(RECORD_SELECT)
    .eq("show_id", self.show_id)
    .neq("id", self.id);
  raise(error);
  const earlier = ((data as PriceRow[] | null) ?? [])
    .filter((row) => sameBrand(row, self) && isEarlier(row, self))
    .sort((a, b) => (isEarlier(a, b) ? 1 : -1));
  const prior = earlier[0];
  if (!prior) return { linked: false };

  const sequence = (prior.rebook_sequence ?? 1) + 1;
  const { error: linkError } = await supabaseAdmin
    .from("deal_price_records")
    .update({ prior_record_id: prior.id, rebook_sequence: sequence })
    .eq("id", self.id)
    .is("prior_record_id", null);
  raise(linkError);
  const { error: flagError } = await supabaseAdmin
    .from("deal_price_records")
    .update({ rebooked: true })
    .eq("id", prior.id);
  raise(flagError);
  return { linked: true };
}

const OUTCOME_STATUS = new Set<OutcomeStatus>([
  "booked",
  "delivering",
  "delivered",
  "make_good",
  "cancelled",
]);

export async function updateOutcome(dealId: string, patch: OutcomePatch): Promise<boolean> {
  const current = await loadRecord(dealId);
  if (!current) {
    console.error("[deal-price-record] outcome skipped");
    return false;
  }
  const next: Record<string, unknown> = {
    outcome_updated_at: new Date().toISOString(),
  };
  if (patch.delivered_units !== undefined) next.delivered_units = patch.delivered_units;
  if (patch.delivered_at !== undefined) next.delivered_at = patch.delivered_at;
  if (patch.make_good_count !== undefined) next.make_good_count = patch.make_good_count;
  if (patch.make_good_credit_total !== undefined) {
    next.make_good_credit_total = patch.make_good_credit_total;
  }
  if (patch.actual_downloads !== undefined) next.actual_downloads = patch.actual_downloads;
  if (patch.reported_conversions !== undefined) {
    next.reported_conversions = patch.reported_conversions;
  }
  if (patch.outcome_status && OUTCOME_STATUS.has(patch.outcome_status)) {
    next.outcome_status = patch.outcome_status;
  }
  const { error } = await supabaseAdmin
    .from("deal_price_records")
    .update(next)
    .eq("deal_id", dealId);
  raise(error);
  return true;
}

async function fillSignedIoUrl(dealId: string): Promise<void> {
  const deal = await loadDeal(dealId);
  const url = typeof deal?.signed_io_pdf_url === "string" ? deal.signed_io_pdf_url.trim() : "";
  if (!url) return;
  const row = await loadRecord(dealId);
  if (!row) return;
  if (typeof row.signed_io_pdf_url === "string" && row.signed_io_pdf_url.trim()) return;
  const { error } = await supabaseAdmin
    .from("deal_price_records")
    .update({ signed_io_pdf_url: url })
    .eq("deal_id", dealId)
    .is("signed_io_pdf_url", null);
  raise(error);
}

export async function recordBookedDeal(dealId: string): Promise<void> {
  try {
    await createDealPriceRecord(dealId);
    await linkRebook(dealId);
    await fillSignedIoUrl(dealId);
  } catch (err) {
    fail("book", err);
  }
}

function asCount(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.round(parsed));
}

export async function recordDeliveryOutcome(dealId: string): Promise<void> {
  try {
    const current = await loadRecord(dealId);
    if (!current) {
      console.error("[deal-price-record] delivery skipped");
      return;
    }
    const { data: orders, error: orderError } = await supabaseAdmin
      .from("insertion_orders")
      .select("id")
      .eq("deal_id", dealId);
    raise(orderError);
    const ioIds = ((orders as { id: string }[] | null) ?? []).map((order) => order.id);
    let units = 0;
    let downloads = 0;
    if (ioIds.length > 0) {
      const { data: lines, error: lineError } = await supabaseAdmin
        .from("io_line_items")
        .select("verified, actual_downloads")
        .in("io_id", ioIds)
        .eq("verified", true);
      raise(lineError);
      for (const line of (lines as { verified?: boolean; actual_downloads?: unknown }[] | null) ?? []) {
        if (line.verified !== true) continue;
        units += 1;
        downloads += asCount(line.actual_downloads);
      }
    }
    const unitCount = asCount(current.unit_count);
    let outcomeStatus: OutcomeStatus | undefined;
    if (current.outcome_status !== "cancelled") {
      if (unitCount > 0 && units >= unitCount) outcomeStatus = "delivered";
      else if (units > 0 && current.outcome_status !== "make_good") outcomeStatus = "delivering";
    }
    await updateOutcome(dealId, {
      delivered_units: units,
      actual_downloads: downloads,
      delivered_at: new Date().toISOString(),
      ...(outcomeStatus ? { outcome_status: outcomeStatus } : {}),
    });
  } catch (err) {
    fail("delivery", err);
  }
}

export async function recordMakeGoodOutcome(dealId: string): Promise<void> {
  try {
    const { data, error } = await supabaseAdmin
      .from("make_goods")
      .select("status, credit_amount")
      .eq("deal_id", dealId)
      .eq("status", "approved");
    raise(error);
    const rows = (data as { credit_amount?: unknown }[] | null) ?? [];
    const credit = rows.reduce((sum, row) => {
      const amount = typeof row.credit_amount === "number" ? row.credit_amount : Number(row.credit_amount);
      return sum + (Number.isFinite(amount) ? amount : 0);
    }, 0);
    await updateOutcome(dealId, {
      make_good_count: rows.length,
      make_good_credit_total: Math.round(credit * 100) / 100,
      outcome_status: "make_good",
    });
  } catch (err) {
    fail("make_good", err);
  }
}

export async function recordReportedConversions(
  dealId: string,
  conversions: number | null
): Promise<void> {
  try {
    await updateOutcome(dealId, { reported_conversions: conversions });
  } catch (err) {
    fail("conversion", err);
  }
}
