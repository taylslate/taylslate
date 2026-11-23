// Pure snapshot of a booked deal. Price, terms, and unit columns are
// copied once from the deal, its insertion order, and that order's lines.
// Outcome columns are not set here.

import { dealIoNumber } from "@/lib/io/io-number";

export type PricingBasis = "cpm" | "flat" | "per_engaged_view";
export type DealMedium = "podcast" | "youtube" | "social";

export interface DealSource {
  id: string;
  show_id?: string | null;
  brand_id?: string | null;
  brand_profile_id?: string | null;
  agreed_cpm?: number | string | null;
  agreed_episode_count?: number | string | null;
  agreed_placement?: string | null;
  agreed_flight_start?: string | null;
  agreed_flight_end?: string | null;
  cpm_rate?: number | string | null;
  gross_cpm?: number | string | null;
  num_episodes?: number | string | null;
  placement?: string | null;
  ad_format?: string | null;
  price_type?: string | null;
  guaranteed_downloads?: number | string | null;
  total_net?: number | string | null;
  total_gross?: number | string | null;
  flight_start?: string | null;
  flight_end?: string | null;
  exclusivity_days?: number | string | null;
  rofr_days?: number | string | null;
  competitor_exclusion?: unknown;
  show_signed_at?: string | null;
  signed_io_pdf_url?: string | null;
}

export interface IoSource {
  id: string;
  io_number?: string | null;
  deal_id?: string | null;
  total_gross?: number | string | null;
  total_net?: number | string | null;
  payment_terms?: string | null;
  exclusivity_days?: number | string | null;
  rofr_days?: number | string | null;
  cancellation_notice_days?: number | string | null;
  make_good_threshold?: number | string | null;
  competitor_exclusion?: unknown;
  payment_off_platform?: boolean | null;
  created_at?: string | null;
}

export interface LineSource {
  io_id?: string | null;
  format?: string | null;
  placement?: string | null;
  guaranteed_downloads?: number | string | null;
  gross_rate?: number | string | null;
  gross_cpm?: number | string | null;
  price_type?: string | null;
  spot_format?: string | null;
  post_date?: string | null;
}

export interface DealPriceSnapshot {
  deal_id: string;
  io_id: string | null;
  io_number: string | null;
  brand_profile_id: string | null;
  brand_id: string | null;
  show_id: string | null;
  agreed_total_gross: number | null;
  agreed_total_net: number | null;
  pricing_basis: PricingBasis | null;
  unit_rate: number | null;
  medium: DealMedium | null;
  unit_format: string | null;
  placement: string | null;
  unit_count: number | null;
  guaranteed_impressions: number | null;
  terms: {
    payment_terms: string | null;
    exclusivity_days: number | null;
    rofr_days: number | null;
    cancellation_notice_days: number | null;
    make_good_threshold: number | null;
    competitor_exclusion: string[];
    payment_off_platform: boolean | null;
  };
  flight_start: string | null;
  flight_end: string | null;
  booked_at: string;
  signed_io_pdf_url: string | null;
  outcome_status: "booked";
  rebook_sequence: number;
  rebooked: boolean;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function money(value: unknown): number | null {
  const parsed = asNumber(value);
  if (parsed === null) return null;
  return Math.round(parsed * 100) / 100;
}

function rate(value: unknown): number | null {
  const parsed = asNumber(value);
  if (parsed === null) return null;
  return Math.round(parsed * 10000) / 10000;
}

function asInt(value: unknown): number | null {
  const parsed = asNumber(value);
  if (parsed === null) return null;
  return Math.round(parsed);
}

function dateOnly(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(value);
  return match ? match[1] : null;
}

function text(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, max);
}

function names(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") continue;
    const trimmed = item.trim();
    if (trimmed) out.push(trimmed.slice(0, 120));
  }
  return out;
}

function basisOf(value: unknown): PricingBasis | null {
  if (value === "cpm" || value === "per_engaged_view") return value;
  if (value === "flat" || value === "flat_rate") return "flat";
  return null;
}

function mediumOf(value: unknown): DealMedium | null {
  if (value === "podcast" || value === "youtube" || value === "social") return value;
  return null;
}

export function chooseIo(dealId: string, orders: IoSource[]): IoSource | null {
  if (orders.length === 0) return null;
  const wanted = dealIoNumber(dealId);
  const sorted = [...orders].sort((a, b) =>
    String(b.created_at ?? "").localeCompare(String(a.created_at ?? ""))
  );
  return sorted.find((order) => order.io_number === wanted) ?? sorted[0];
}

function sharedMedium(lines: LineSource[], showPlatform: string | null): DealMedium | null {
  const values = lines
    .map((line) => mediumOf(line.format))
    .filter((value): value is DealMedium => value !== null);
  if (values.length > 0 && values.every((value) => value === values[0])) return values[0];
  return mediumOf(showPlatform);
}

function sharedPlacement(lines: LineSource[], fallback: string | null): string | null {
  const values = lines
    .map((line) => text(line.placement, 200))
    .filter((value): value is string => value !== null);
  if (values.length > 0 && values.every((value) => value === values[0])) return values[0];
  if (values.length > 1) {
    return [...new Set(values)].sort().join(", ").slice(0, 200);
  }
  return text(fallback, 200);
}

function dominantBasis(lines: LineSource[], deal: DealSource): {
  basis: PricingBasis | null;
  unitRate: number | null;
} {
  const tagged = lines
    .map((line) => ({
      basis: basisOf(line.price_type),
      gross: money(line.gross_rate) ?? 0,
      cpm: rate(line.gross_cpm),
      flat: money(line.gross_rate),
    }))
    .filter((line) => line.basis !== null);
  if (tagged.length === 0) {
    const basis = basisOf(deal.price_type) ?? (asNumber(deal.agreed_cpm) != null ? "cpm" : null);
    const unitRate =
      basis === "flat"
        ? money(deal.total_gross)
        : rate(deal.agreed_cpm) ?? rate(deal.cpm_rate) ?? rate(deal.gross_cpm);
    return { basis, unitRate };
  }
  const first = tagged[0].basis;
  const uniform = tagged.every((line) => line.basis === first);
  const chosen = uniform
    ? tagged[0]
    : tagged.reduce((best, line) => (line.gross > best.gross ? line : best));
  if (chosen.basis === "flat") return { basis: "flat", unitRate: chosen.flat };
  if (chosen.basis === "per_engaged_view") {
    return { basis: "per_engaged_view", unitRate: chosen.cpm ?? rate(deal.agreed_cpm) };
  }
  return {
    basis: "cpm",
    unitRate: rate(deal.agreed_cpm) ?? chosen.cpm ?? rate(deal.cpm_rate),
  };
}

export function buildDealPriceSnapshot(input: {
  deal: DealSource;
  orders: IoSource[];
  lines: LineSource[];
  showPlatform: string | null;
  now?: string;
}): DealPriceSnapshot {
  const { deal } = input;
  const order = chooseIo(deal.id, input.orders);
  const lines = order ? input.lines.filter((line) => line.io_id === order.id) : [];
  const { basis, unitRate } = dominantBasis(lines, deal);
  const unitCount =
    lines.length > 0
      ? lines.length
      : asInt(deal.agreed_episode_count) ?? asInt(deal.num_episodes);
  const guaranteedFromLines = lines.reduce((sum, line) => sum + (asInt(line.guaranteed_downloads) ?? 0), 0);
  const guaranteed =
    lines.length > 0
      ? guaranteedFromLines
      : unitCount != null && asInt(deal.guaranteed_downloads) != null
        ? unitCount * (asInt(deal.guaranteed_downloads) as number)
        : asInt(deal.guaranteed_downloads);
  const postDates = lines
    .map((line) => dateOnly(line.post_date))
    .filter((value): value is string => value !== null)
    .sort();
  const format =
    lines.map((line) => text(line.spot_format, 500)).find((value) => value !== null) ??
    text(deal.ad_format, 500);

  return {
    deal_id: deal.id,
    io_id: order?.id ?? null,
    io_number: text(order?.io_number, 80),
    brand_profile_id: text(deal.brand_profile_id, 80),
    brand_id: text(deal.brand_id, 80),
    show_id: text(deal.show_id, 80),
    agreed_total_gross: order ? money(order.total_gross) : money(deal.total_gross),
    agreed_total_net: order ? money(order.total_net) : money(deal.total_net),
    pricing_basis: basis,
    unit_rate: unitRate,
    medium: sharedMedium(lines, input.showPlatform),
    unit_format: format,
    placement: sharedPlacement(
      lines,
      deal.agreed_placement ?? deal.placement ?? null
    ),
    unit_count: unitCount,
    guaranteed_impressions: guaranteed,
    terms: {
      payment_terms: text(order?.payment_terms, 500),
      exclusivity_days: asInt(order?.exclusivity_days) ?? asInt(deal.exclusivity_days),
      rofr_days: asInt(order?.rofr_days) ?? asInt(deal.rofr_days),
      cancellation_notice_days: asInt(order?.cancellation_notice_days),
      make_good_threshold:
        asNumber(order?.make_good_threshold) === null
          ? null
          : Math.round((asNumber(order?.make_good_threshold) as number) * 10000) / 10000,
      competitor_exclusion:
        names(order?.competitor_exclusion).length > 0
          ? names(order?.competitor_exclusion)
          : names(deal.competitor_exclusion),
      payment_off_platform:
        typeof order?.payment_off_platform === "boolean" ? order.payment_off_platform : null,
    },
    flight_start:
      dateOnly(deal.agreed_flight_start) ??
      dateOnly(deal.flight_start) ??
      postDates[0] ??
      null,
    flight_end:
      dateOnly(deal.agreed_flight_end) ??
      dateOnly(deal.flight_end) ??
      postDates[postDates.length - 1] ??
      null,
    booked_at: text(deal.show_signed_at, 40) ?? input.now ?? new Date().toISOString(),
    signed_io_pdf_url: text(deal.signed_io_pdf_url, 500),
    outcome_status: "booked",
    rebook_sequence: 1,
    rebooked: false,
  };
}
