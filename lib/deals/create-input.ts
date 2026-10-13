// Turn a POST /api/deals body into the commercial columns on a deal row.
// Party ids are not taken from the client. The route stamps the signed-in
// user onto brand_id or agent_id (see partiesForRole) so the insert satisfies
// RLS and later IO party checks.

import type {
  AdFormat,
  Deal,
  Placement,
  PriceType,
  UserRole,
} from "@/lib/data/types";

const PLACEMENTS: Placement[] = ["pre-roll", "mid-roll", "post-roll"];
const AD_FORMATS: AdFormat[] = [
  "host_read",
  "scripted",
  "personal_experience",
  "dynamic_insertion",
  "integration",
];
const PRICE_TYPES: PriceType[] = ["cpm", "flat_rate"];
const READER_TYPES = ["host_read", "producer_read", "guest_read"] as const;
const CONTENT_TYPES = ["evergreen", "dated"] as const;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export type DealFieldErrors = Record<string, string>;

export interface ParsedDeal {
  show_id?: string;
  show_name?: string;
  num_episodes: number;
  placement: Placement;
  ad_format: AdFormat;
  price_type: PriceType;
  cpm_rate: number;
  gross_cpm?: number;
  guaranteed_downloads: number;
  net_per_episode: number;
  gross_per_episode?: number;
  total_net: number;
  total_gross?: number;
  is_scripted: boolean;
  is_personal_experience: boolean;
  reader_type: Deal["reader_type"];
  content_type: Deal["content_type"];
  pixel_required: boolean;
  competitor_exclusion: string[];
  exclusivity_days: number;
  rofr_days: number;
  flight_start: string;
  flight_end: string;
  notes?: string;
  campaign_id?: string;
}

export type ParseDealResult =
  | { ok: true; deal: ParsedDeal }
  | { ok: false; fields: DealFieldErrors };

function money(n: number): number {
  return Math.round(n * 100) / 100;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T | null {
  return typeof value === "string" && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : null;
}

/**
 * brand_id is NOT NULL, so the actor's profile always fills it. Agent and
 * agency roles also stamp their own column. Client-supplied party ids are
 * ignored — the signed-in user has to be on the row or the IO party check
 * and the deals insert policy both fail.
 */
export function partiesForRole(
  userId: string,
  role: UserRole | null | undefined
): { brand_id: string; agent_id?: string; agency_id?: string } {
  if (role === "agent") {
    return { brand_id: userId, agent_id: userId };
  }
  if (role === "agency") {
    return { brand_id: userId, agency_id: userId };
  }
  return { brand_id: userId };
}

export function parseDealBody(body: Record<string, unknown>): ParseDealResult {
  const fields: DealFieldErrors = {};

  const showId = typeof body.show_id === "string" ? body.show_id.trim() : "";
  const showName = typeof body.show_name === "string" ? body.show_name.trim() : "";
  if (!showId && !showName) {
    fields.show_id = "Select a show";
  } else if (showId && !UUID_RE.test(showId)) {
    fields.show_id = "Show id is not a valid id";
  }

  const numEpisodes = Number(body.num_episodes);
  if (!Number.isInteger(numEpisodes) || numEpisodes < 1) {
    fields.num_episodes = "Add at least one episode";
  }

  const placement = oneOf(body.placement, PLACEMENTS);
  if (!placement) fields.placement = "Choose a placement";

  const adFormat = oneOf(body.ad_format, AD_FORMATS);
  if (!adFormat) fields.ad_format = "Choose an ad format";

  const priceType = oneOf(body.price_type, PRICE_TYPES);
  if (!priceType) fields.price_type = "Choose a price type";

  const downloads = Number(body.guaranteed_downloads);
  if (!Number.isFinite(downloads) || downloads < 1) {
    fields.guaranteed_downloads = "Enter guaranteed downloads";
  }

  let cpmRate = 0;
  let netPerEpisode = 0;
  if (priceType === "flat_rate") {
    const flat = Number(body.flat_rate);
    if (!Number.isFinite(flat) || flat <= 0) {
      fields.flat_rate = "Enter a flat rate per episode";
    } else if (Number.isFinite(downloads) && downloads > 0) {
      netPerEpisode = money(flat);
      cpmRate = money((flat / downloads) * 1000);
    }
  } else if (priceType === "cpm") {
    const cpm = Number(body.cpm_rate);
    if (!Number.isFinite(cpm) || cpm <= 0) {
      fields.cpm_rate = "Enter a CPM rate";
    } else if (Number.isFinite(downloads) && downloads > 0) {
      cpmRate = money(cpm);
      netPerEpisode = money((downloads / 1000) * cpm);
    }
  }

  const readerType = oneOf(body.reader_type, READER_TYPES);
  if (!readerType) fields.reader_type = "Choose a reader type";

  const contentType = oneOf(body.content_type, CONTENT_TYPES);
  if (!contentType) fields.content_type = "Choose a content type";

  if (typeof body.is_scripted !== "boolean") {
    fields.is_scripted = "Say whether the read is scripted";
  }
  if (typeof body.is_personal_experience !== "boolean") {
    fields.is_personal_experience = "Say whether this is a personal-experience read";
  }
  if (typeof body.pixel_required !== "boolean") {
    fields.pixel_required = "Say whether a pixel is required";
  }

  const flightStart = typeof body.flight_start === "string" ? body.flight_start : "";
  const flightEnd = typeof body.flight_end === "string" ? body.flight_end : "";
  if (!DATE_RE.test(flightStart)) fields.flight_start = "Choose a flight start";
  if (!DATE_RE.test(flightEnd)) fields.flight_end = "Choose a flight end";
  if (DATE_RE.test(flightStart) && DATE_RE.test(flightEnd) && flightEnd < flightStart) {
    fields.flight_end = "Flight end is before the start";
  }

  let campaignId: string | undefined;
  if (body.campaign_id != null && body.campaign_id !== "") {
    if (typeof body.campaign_id === "string" && UUID_RE.test(body.campaign_id)) {
      campaignId = body.campaign_id;
    } else {
      fields.campaign_id = "Campaign id is not a valid id";
    }
  }

  let grossCpm: number | undefined;
  let grossPerEpisode: number | undefined;
  let totalGross: number | undefined;
  if (body.gross_cpm != null && body.gross_cpm !== "") {
    const gross = Number(body.gross_cpm);
    if (!Number.isFinite(gross) || gross < 0) {
      fields.gross_cpm = "Gross CPM must be a number";
    } else if (Number.isFinite(downloads) && downloads > 0 && Number.isInteger(numEpisodes)) {
      grossCpm = money(gross);
      grossPerEpisode = money((downloads / 1000) * gross);
      totalGross = money(grossPerEpisode * numEpisodes);
    }
  }

  if (Object.keys(fields).length > 0) {
    return { ok: false, fields };
  }

  const episodes = numEpisodes;
  const notes = typeof body.notes === "string" && body.notes.trim() ? body.notes.trim() : undefined;
  const exclusions = Array.isArray(body.competitor_exclusion)
    ? body.competitor_exclusion.filter((item): item is string => typeof item === "string" && item.trim() !== "")
    : [];

  return {
    ok: true,
    deal: {
      show_id: showId || undefined,
      show_name: showName || undefined,
      num_episodes: episodes,
      placement: placement as Placement,
      ad_format: adFormat as AdFormat,
      price_type: priceType as PriceType,
      cpm_rate: cpmRate,
      gross_cpm: grossCpm,
      guaranteed_downloads: downloads,
      net_per_episode: netPerEpisode,
      gross_per_episode: grossPerEpisode,
      total_net: money(netPerEpisode * episodes),
      total_gross: totalGross,
      is_scripted: body.is_scripted === true,
      is_personal_experience: body.is_personal_experience === true,
      reader_type: readerType as Deal["reader_type"],
      content_type: contentType as Deal["content_type"],
      pixel_required: body.pixel_required === true,
      competitor_exclusion: exclusions,
      exclusivity_days: Number(body.exclusivity_days ?? 90) || 90,
      rofr_days: Number(body.rofr_days ?? 30) || 30,
      flight_start: flightStart,
      flight_end: flightEnd,
      notes,
      campaign_id: campaignId,
    },
  };
}
