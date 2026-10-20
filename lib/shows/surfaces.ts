// Creator-attached sellable surfaces: newsletter, social, community, live,
// bonus episode. They ride on a show as add-ons. They are not standalone
// paid media, and they never change a discovery score or hide a show.

import type { Placement } from "@/lib/data/types";

export const SHOW_SURFACE_TYPES = [
  "newsletter",
  "instagram",
  "tiktok",
  "reels",
  "shorts",
  "x",
  "linkedin",
  "patreon",
  "discord",
  "community",
  "live_event",
  "bonus_episode",
] as const;

export type ShowSurfaceType = (typeof SHOW_SURFACE_TYPES)[number];

export type SurfacePostingOwner = "creator" | "brand";

export const SURFACE_TYPE_LABELS: Record<ShowSurfaceType, string> = {
  newsletter: "Newsletter mention",
  instagram: "Instagram post",
  tiktok: "TikTok clip",
  reels: "Instagram Reel",
  shorts: "YouTube Short",
  x: "X post",
  linkedin: "LinkedIn post",
  patreon: "Patreon mention",
  discord: "Discord mention",
  community: "Community mention",
  live_event: "Live event",
  bonus_episode: "Bonus episode package",
};

/** What a brand sees and what an IO line is built from. No owner id. */
export interface SellableSurface {
  id: string;
  show_id: string;
  type: ShowSurfaceType;
  audience_size: number | null;
  format: string | null;
  min_buy: number | null;
  creative_constraints: string | null;
  lead_time_days: number | null;
  posting_owner: SurfacePostingOwner;
  price: number | null;
  notes: string | null;
  published: boolean;
}

/** Onboarding / settings draft. The server assigns show_id and owner. */
export interface ShowSurfaceDraft {
  type: ShowSurfaceType;
  audience_size: number | null;
  format: string | null;
  min_buy: number | null;
  creative_constraints: string | null;
  lead_time_days: number | null;
  posting_owner: SurfacePostingOwner;
  price: number | null;
  notes: string | null;
  published: boolean;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const MAX_SURFACES = 8;
const FORMAT_MAX = 80;
const TEXT_MAX = 500;

const TYPE_SET = new Set<string>(SHOW_SURFACE_TYPES);

export function surfaceTypeLabel(type: ShowSurfaceType): string {
  return SURFACE_TYPE_LABELS[type];
}

export function postingOwnerLabel(owner: SurfacePostingOwner): string {
  return owner === "brand" ? "brand posts" : "creator posts";
}

export function formatSurfacePrice(price: number | null | undefined): string {
  if (price == null || !Number.isFinite(price)) return "Quote";
  return `$${price.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}

/** Suggested minimum is copy. The add-on stays selectable either way. */
export function surfaceMinBuyNote(minBuy: number | null | undefined): string | null {
  if (minBuy == null || !Number.isFinite(minBuy) || minBuy <= 0) return null;
  return `Suggested minimum ${formatSurfacePrice(minBuy)}. A smaller buy can still be added.`;
}

export function surfaceAddonDecision(surface: {
  min_buy: number | null;
  price: number | null;
}): { selectable: true; note: string | null } {
  return { selectable: true, note: surfaceMinBuyNote(surface.min_buy) };
}

export function emptySurfaceDraft(): ShowSurfaceDraft {
  return {
    type: "newsletter",
    audience_size: null,
    format: null,
    min_buy: null,
    creative_constraints: null,
    lead_time_days: null,
    posting_owner: "creator",
    price: null,
    notes: null,
    published: true,
  };
}

function moneyOrNull(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.max(0, Math.round(value * 100) / 100);
}

function intOrNull(value: unknown, max: number): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.max(0, Math.min(max, Math.round(value)));
}

function textOrNull(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

export function sanitizeShowSurfaceDrafts(input: unknown): ShowSurfaceDraft[] {
  if (!Array.isArray(input)) return [];
  const out: ShowSurfaceDraft[] = [];
  for (const raw of input) {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) continue;
    const entry = raw as Record<string, unknown>;
    if (typeof entry.type !== "string" || !TYPE_SET.has(entry.type)) continue;
    const posting: SurfacePostingOwner = entry.posting_owner === "brand" ? "brand" : "creator";
    out.push({
      type: entry.type as ShowSurfaceType,
      audience_size: intOrNull(entry.audience_size, 1_000_000_000),
      format: textOrNull(entry.format, FORMAT_MAX),
      min_buy: moneyOrNull(entry.min_buy),
      creative_constraints: textOrNull(entry.creative_constraints, TEXT_MAX),
      lead_time_days: intOrNull(entry.lead_time_days, 365),
      posting_owner: posting,
      price: moneyOrNull(entry.price),
      notes: textOrNull(entry.notes, TEXT_MAX),
      published: entry.published !== false,
    });
    if (out.length >= MAX_SURFACES) break;
  }
  return out;
}

export function sanitizeAddonSurfaceIds(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of input) {
    if (typeof value !== "string" || !UUID_RE.test(value)) continue;
    const id = value.toLowerCase();
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    if (out.length >= MAX_SURFACES) break;
  }
  return out;
}

/** UUID or null. Invalid and blank both become null so a line can clear the link. */
export function parseShowSurfaceId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return UUID_RE.test(trimmed) ? trimmed.toLowerCase() : null;
}

export function ownerShowSlug(userId: string): string {
  return `owner-${userId}`;
}

export function chooseSurfaceShowId(input: {
  catalogShowId: string | null;
  catalogOwnedByOther: boolean;
  existingOwnerShowId: string | null;
}): { kind: "catalog" | "existing_owner" | "create_owner"; showId: string | null } {
  if (input.catalogShowId && !input.catalogOwnedByOther) {
    return { kind: "catalog", showId: input.catalogShowId };
  }
  if (input.existingOwnerShowId) {
    return { kind: "existing_owner", showId: input.existingOwnerShowId };
  }
  return { kind: "create_owner", showId: null };
}

export function groupPublishedSurfaces(input: {
  catalogIds: string[];
  podscanByCatalogId: Map<string, string>;
  podscanBySurfaceShowId: Map<string, string>;
  direct: SellableSurface[];
  aliased: SellableSurface[];
}): Record<string, SellableSurface[]> {
  const catalog = new Set(input.catalogIds);
  const out: Record<string, SellableSurface[]> = {};
  const seen = new Map<string, Set<string>>();

  const add = (catalogId: string, surface: SellableSurface) => {
    if (!surface.published) return;
    const ids = seen.get(catalogId) ?? new Set<string>();
    if (ids.has(surface.id)) return;
    ids.add(surface.id);
    seen.set(catalogId, ids);
    (out[catalogId] ??= []).push(surface);
  };

  for (const surface of input.direct) {
    if (catalog.has(surface.show_id)) add(surface.show_id, surface);
  }

  const catalogsByPodscan = new Map<string, string[]>();
  for (const [id, podscan] of input.podscanByCatalogId) {
    const list = catalogsByPodscan.get(podscan) ?? [];
    list.push(id);
    catalogsByPodscan.set(podscan, list);
  }

  for (const surface of input.aliased) {
    const podscan = input.podscanBySurfaceShowId.get(surface.show_id);
    if (!podscan) continue;
    for (const catalogId of catalogsByPodscan.get(podscan) ?? []) {
      add(catalogId, surface);
    }
  }

  return out;
}

export function formatSurfaceSummary(
  surfaces: Array<Pick<SellableSurface, "type" | "price" | "published">>
): string {
  const listed = surfaces.filter((surface) => surface.published);
  if (listed.length === 0) return "";
  return listed
    .map((surface) => `${surfaceTypeLabel(surface.type)} (${formatSurfacePrice(surface.price)})`)
    .join(", ");
}

/** Printed on the IO under an add-on line, and stored on spot_format so a reload still renders it. */
export function surfaceSpotFormat(
  surface: Pick<
    SellableSurface,
    "type" | "format" | "posting_owner" | "lead_time_days" | "creative_constraints"
  >
): string {
  const parts = [surfaceTypeLabel(surface.type)];
  const format = surface.format?.trim();
  if (format) parts.push(format);
  parts.push(postingOwnerLabel(surface.posting_owner));
  if (surface.lead_time_days != null) parts.push(`${surface.lead_time_days}-day lead`);
  const constraints = surface.creative_constraints?.trim();
  if (constraints) parts.push(constraints.slice(0, 80));
  return parts.join(" · ");
}

/** Caption for a line that references a surface. Episode lines return null. */
export function ioLineSurfaceCaption(line: {
  show_surface_id?: string | null;
  spot_format?: string | null;
}): string | null {
  if (!line.show_surface_id) return null;
  const label = line.spot_format?.trim();
  return label ? `Add-on: ${label}` : "Add-on";
}

export function addonSpend(
  surfaces: Array<Pick<SellableSurface, "id" | "price">>,
  selectedIds: string[] | undefined
): number {
  const selected = new Set((selectedIds ?? []).map((id) => id.toLowerCase()));
  return surfaces.reduce((sum, surface) => {
    if (!selected.has(surface.id.toLowerCase())) return sum;
    if (surface.price == null || surface.price <= 0) return sum;
    return sum + surface.price;
  }, 0);
}

export interface SurfaceAddonLine {
  format: "podcast" | "youtube";
  post_date: string;
  guaranteed_downloads: number;
  show_name: string;
  placement: Placement;
  is_scripted: false;
  is_personal_experience: false;
  reader_type: "host_read";
  content_type: "evergreen";
  pixel_required: false;
  gross_rate: number;
  gross_cpm: number;
  price_type: "flat_rate";
  net_due: number;
  verified: false;
  make_good_triggered: false;
  spot_format: string;
  show_surface_id: string;
}

/**
 * One flat line per selected, priced surface. Unpriced selections stay off
 * the IO (a $0 gross_rate cannot be persisted) and are named in `unpriced`
 * so the caller can say so. min_buy never drops a line.
 */
export function buildSurfaceAddonLines(input: {
  surfaces: SellableSurface[];
  selectedIds: string[] | undefined;
  showName: string;
  placement: Placement;
  postDate: string;
  format: "podcast" | "youtube";
}): { lines: SurfaceAddonLine[]; unpriced: string[] } {
  const selected = new Set(sanitizeAddonSurfaceIds(input.selectedIds));
  const lines: SurfaceAddonLine[] = [];
  const unpriced: string[] = [];
  for (const surface of input.surfaces) {
    if (!surface.published) continue;
    if (!selected.has(surface.id.toLowerCase())) continue;
    if (surface.price == null || surface.price <= 0) {
      unpriced.push(surfaceTypeLabel(surface.type));
      continue;
    }
    lines.push({
      format: input.format,
      post_date: input.postDate,
      guaranteed_downloads: surface.audience_size ?? 0,
      show_name: input.showName,
      placement: input.placement,
      is_scripted: false,
      is_personal_experience: false,
      reader_type: "host_read",
      content_type: "evergreen",
      pixel_required: false,
      gross_rate: surface.price,
      gross_cpm: 0,
      price_type: "flat_rate",
      net_due: surface.price,
      verified: false,
      make_good_triggered: false,
      spot_format: surfaceSpotFormat(surface),
      show_surface_id: surface.id,
    });
  }
  return { lines, unpriced };
}
