// Explicit allowlists for public API bodies. Each function builds a new
// object field by field. Payment, payout, fee, envelope, and note columns
// are not copied. Net amounts and other party ids are left out.

export const DEMOGRAPHIC_FIELDS = [
  "age_18_24",
  "age_25_34",
  "age_35_44",
  "age_45_54",
  "age_55_plus",
  "male",
  "female",
  "us",
  "uk",
  "canada",
  "australia",
  "hhi_50k_plus",
  "hhi_100k_plus",
] as const;

export const RATE_FIELDS = [
  "preroll_cpm",
  "midroll_cpm",
  "postroll_cpm",
  "flat_rate",
] as const;

export const SHOW_FIELDS = [
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
  "rates",
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
  "verified",
] as const;

export const PRODUCT_FIELDS = [
  "brand_name",
  "category",
  "product_description",
  "aov_bucket",
  "aov_reasoning",
  "key_attributes",
  "source",
  "url",
] as const;

export const FLIGHT_FIELDS = ["mode", "preset", "start_date", "end_date"] as const;

export const BRIEF_V1_FIELDS = [
  "brand_url",
  "target_age_range",
  "target_gender",
  "target_interests",
  "keywords",
  "campaign_goals",
] as const;

export const BRIEF_V2_FIELDS = [
  "version",
  "product",
  "customer_text",
  "goals",
  "goals_context",
  "flight",
  "exclusions_text",
  "submitted_at",
] as const;

export const CAMPAIGN_FIELDS = [
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
] as const;

export const SCORE_FIELDS = [
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
] as const;

export const PLAN_LINE_FIELDS = [
  "podcast_id",
  "placement",
  "num_episodes",
  "addon_surface_ids",
] as const;

export const PLAN_FIELDS = [
  "default_placement",
  "default_episodes",
  "spacing",
  "line_items",
  "updated_at",
] as const;

export const DEAL_FIELDS = [
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
  "guaranteed_downloads",
] as const;

export interface SerializedDemographics {
  age_18_24: number | null;
  age_25_34: number | null;
  age_35_44: number | null;
  age_45_54: number | null;
  age_55_plus: number | null;
  male: number | null;
  female: number | null;
  us: number | null;
  uk: number | null;
  canada: number | null;
  australia: number | null;
  hhi_50k_plus: number | null;
  hhi_100k_plus: number | null;
}

export interface SerializedRates {
  preroll_cpm: number | null;
  midroll_cpm: number | null;
  postroll_cpm: number | null;
  flat_rate: number | null;
}

export interface SerializedShow {
  id: string;
  name: string;
  slug: string | null;
  platform: string | null;
  categories: string[];
  audience_size: number | null;
  description: string | null;
  image_url: string | null;
  network: string | null;
  tags: string[];
  demographics: SerializedDemographics;
  audience_interests: string[];
  audience_purchase_power: number | null;
  rates: SerializedRates;
  price_type: string | null;
  min_buy: number | null;
  ad_formats: string[];
  episode_cadence: string | null;
  avg_episode_length_min: number | null;
  current_sponsors: string[];
  past_sponsors: string[];
  apple_id: string | null;
  spotify_id: string | null;
  youtube_channel_id: string | null;
  rss_url: string | null;
  available_slots: number | null;
  next_available_date: string | null;
  verified: boolean;
}

export interface SerializedProduct {
  brand_name: string | null;
  category: string | null;
  product_description: string | null;
  aov_bucket: string | null;
  aov_reasoning: string | null;
  key_attributes: string[];
  source: string | null;
  url: string | null;
}

export interface SerializedFlight {
  mode: string | null;
  preset: string | null;
  start_date: string | null;
  end_date: string | null;
}

export interface SerializedBriefV1 {
  brand_url: string | null;
  target_age_range: string | null;
  target_gender: string | null;
  target_interests: string[];
  keywords: string[];
  campaign_goals: string | null;
}

export interface SerializedBriefV2 {
  version: 2;
  product: SerializedProduct | null;
  customer_text: string | null;
  goals: string[];
  goals_context: string | null;
  flight: SerializedFlight | null;
  exclusions_text: string | null;
  submitted_at: string | null;
}

export interface SerializedCampaign {
  id: string;
  name: string;
  status: string | null;
  budget_total: number | null;
  platforms: string[];
  brief: SerializedBriefV1 | SerializedBriefV2;
  test_spot_count: number | null;
  test_placement: string | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface SerializedScore {
  id: string;
  show_id: string | null;
  ring_hypothesis_id: string | null;
  audience_fit_score: number | null;
  topical_relevance_score: number | null;
  purchase_power_score: number | null;
  composite_score: number | null;
  conviction_band: string | null;
  reasoning: string | null;
  tier: string | null;
  created_at: string | null;
}

export interface SerializedPlanLine {
  podcast_id: string | null;
  placement: string | null;
  num_episodes: number | null;
  addon_surface_ids: string[];
}

export interface SerializedPlan {
  default_placement: string | null;
  default_episodes: number | null;
  spacing: string | null;
  line_items: SerializedPlanLine[];
  updated_at: string | null;
}

export interface SerializedDeal {
  id: string;
  campaign_id: string | null;
  show_id: string | null;
  status: string | null;
  placement: string | null;
  ad_format: string | null;
  num_episodes: number | null;
  flight_start: string | null;
  flight_end: string | null;
  price_type: string | null;
  cpm_rate: number | null;
  gross_cpm: number | null;
  gross_per_episode: number | null;
  total_gross: number | null;
  agreed_cpm: number | null;
  guaranteed_downloads: number | null;
}

export function serializeShow(
  row: Record<string, unknown>,
  verified: boolean
): SerializedShow {
  const body: SerializedShow = {
    id: requiredText(row.id),
    name: requiredText(row.name),
    slug: textOrNull(row.slug),
    platform: textOrNull(row.platform),
    categories: stringList(row.categories),
    audience_size: numberOrNull(row.audience_size),
    description: textOrNull(row.description),
    image_url: textOrNull(row.image_url),
    network: textOrNull(row.network),
    tags: stringList(row.tags),
    demographics: serializeDemographics(row.demographics),
    audience_interests: stringList(row.audience_interests),
    audience_purchase_power: numberOrNull(row.audience_purchase_power),
    rates: serializeRates(row.rate_card),
    price_type: textOrNull(row.price_type),
    min_buy: numberOrNull(row.min_buy),
    ad_formats: stringList(row.ad_formats),
    episode_cadence: textOrNull(row.episode_cadence),
    avg_episode_length_min: numberOrNull(row.avg_episode_length_min),
    current_sponsors: stringList(row.current_sponsors),
    past_sponsors: stringList(row.past_sponsors),
    apple_id: textOrNull(row.apple_id),
    spotify_id: textOrNull(row.spotify_id),
    youtube_channel_id: textOrNull(row.youtube_channel_id),
    rss_url: textOrNull(row.rss_url),
    available_slots: numberOrNull(row.available_slots),
    next_available_date: textOrNull(row.next_available_date),
    verified,
  };
  return body;
}

export function serializeCampaign(row: Record<string, unknown>): SerializedCampaign {
  const body: SerializedCampaign = {
    id: requiredText(row.id),
    name: requiredText(row.name),
    status: textOrNull(row.status),
    budget_total: numberOrNull(row.budget_total),
    platforms: stringList(row.platforms),
    brief: serializeBrief(row.brief),
    test_spot_count: numberOrNull(row.test_spot_count),
    test_placement: textOrNull(row.test_placement),
    created_at: textOrNull(row.created_at),
    updated_at: textOrNull(row.updated_at),
  };
  return body;
}

export function serializeScore(row: Record<string, unknown>): SerializedScore {
  const body: SerializedScore = {
    id: requiredText(row.id),
    show_id: textOrNull(row.show_id),
    ring_hypothesis_id: textOrNull(row.ring_hypothesis_id),
    audience_fit_score: numberOrNull(row.audience_fit_score),
    topical_relevance_score: numberOrNull(row.topical_relevance_score),
    purchase_power_score: numberOrNull(row.purchase_power_score),
    composite_score: numberOrNull(row.composite_score),
    conviction_band: textOrNull(row.conviction_band),
    reasoning: textOrNull(row.reasoning),
    tier: textOrNull(row.tier),
    created_at: textOrNull(row.created_at),
  };
  return body;
}

export function serializePlan(value: unknown): SerializedPlan | null {
  if (!isRecord(value)) return null;
  const lines: SerializedPlanLine[] = [];
  if (Array.isArray(value.line_items)) {
    for (const item of value.line_items) {
      if (!isRecord(item)) continue;
      lines.push({
        podcast_id: textOrNull(item.podcast_id),
        placement: textOrNull(item.placement),
        num_episodes: numberOrNull(item.num_episodes),
        addon_surface_ids: stringList(item.addon_surface_ids),
      });
    }
  }
  const body: SerializedPlan = {
    default_placement: textOrNull(value.default_placement),
    default_episodes: numberOrNull(value.default_episodes),
    spacing: textOrNull(value.spacing),
    line_items: lines,
    updated_at: textOrNull(value.updated_at),
  };
  return body;
}

export function serializeDeal(row: Record<string, unknown>): SerializedDeal {
  const body: SerializedDeal = {
    id: requiredText(row.id),
    campaign_id: textOrNull(row.campaign_id),
    show_id: textOrNull(row.show_id),
    status: textOrNull(row.status),
    placement: firstText(row.placement, row.agreed_placement),
    ad_format: textOrNull(row.ad_format),
    num_episodes: firstNumber(row.num_episodes, row.agreed_episode_count),
    flight_start: firstText(row.flight_start, row.agreed_flight_start),
    flight_end: firstText(row.flight_end, row.agreed_flight_end),
    price_type: textOrNull(row.price_type),
    cpm_rate: firstNumber(row.cpm_rate, row.agreed_cpm),
    gross_cpm: numberOrNull(row.gross_cpm),
    gross_per_episode: numberOrNull(row.gross_per_episode),
    total_gross: numberOrNull(row.total_gross),
    agreed_cpm: numberOrNull(row.agreed_cpm),
    guaranteed_downloads: numberOrNull(row.guaranteed_downloads),
  };
  return body;
}

function serializeBrief(value: unknown): SerializedBriefV1 | SerializedBriefV2 {
  if (!isRecord(value)) return emptyBriefV1();
  if (value.version === 2) return serializeBriefV2(value);
  return serializeBriefV1(value);
}

function serializeBriefV1(row: Record<string, unknown>): SerializedBriefV1 {
  return {
    brand_url: textOrNull(row.brand_url),
    target_age_range: textOrNull(row.target_age_range),
    target_gender: textOrNull(row.target_gender),
    target_interests: stringList(row.target_interests),
    keywords: stringList(row.keywords),
    campaign_goals: textOrNull(row.campaign_goals),
  };
}

function emptyBriefV1(): SerializedBriefV1 {
  return serializeBriefV1({});
}

function serializeBriefV2(row: Record<string, unknown>): SerializedBriefV2 {
  return {
    version: 2,
    product: serializeProduct(row.product),
    customer_text: textOrNull(row.customer_text),
    goals: stringList(row.goals),
    goals_context: textOrNull(row.goals_context),
    flight: serializeFlight(row.flight),
    exclusions_text: textOrNull(row.exclusions_text),
    submitted_at: textOrNull(row.submitted_at),
  };
}

function serializeProduct(value: unknown): SerializedProduct | null {
  if (!isRecord(value)) return null;
  return {
    brand_name: textOrNull(value.brand_name),
    category: textOrNull(value.category),
    product_description: textOrNull(value.product_description),
    aov_bucket: textOrNull(value.aov_bucket),
    aov_reasoning: textOrNull(value.aov_reasoning),
    key_attributes: stringList(value.key_attributes),
    source: textOrNull(value.source),
    url: textOrNull(value.url),
  };
}

function serializeFlight(value: unknown): SerializedFlight | null {
  if (!isRecord(value)) return null;
  return {
    mode: textOrNull(value.mode),
    preset: textOrNull(value.preset),
    start_date: textOrNull(value.start_date),
    end_date: textOrNull(value.end_date),
  };
}

function serializeDemographics(value: unknown): SerializedDemographics {
  const source = isRecord(value) ? value : {};
  return {
    age_18_24: numberOrNull(source.age_18_24),
    age_25_34: numberOrNull(source.age_25_34),
    age_35_44: numberOrNull(source.age_35_44),
    age_45_54: numberOrNull(source.age_45_54),
    age_55_plus: numberOrNull(source.age_55_plus),
    male: numberOrNull(source.male),
    female: numberOrNull(source.female),
    us: numberOrNull(source.us),
    uk: numberOrNull(source.uk),
    canada: numberOrNull(source.canada),
    australia: numberOrNull(source.australia),
    hhi_50k_plus: numberOrNull(source.hhi_50k_plus),
    hhi_100k_plus: numberOrNull(source.hhi_100k_plus),
  };
}

function serializeRates(value: unknown): SerializedRates {
  const source = isRecord(value) ? value : {};
  return {
    preroll_cpm: numberOrNull(source.preroll_cpm),
    midroll_cpm: numberOrNull(source.midroll_cpm),
    postroll_cpm: numberOrNull(source.postroll_cpm),
    flat_rate: numberOrNull(source.flat_rate),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    !(value instanceof Date)
  );
}

function textOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function requiredText(value: unknown): string {
  return textOrNull(value) ?? "";
}

function firstText(primary: unknown, fallback: unknown): string | null {
  return textOrNull(primary) ?? textOrNull(fallback);
}

function numberOrNull(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function firstNumber(primary: unknown, fallback: unknown): number | null {
  const first = numberOrNull(primary);
  if (first != null) return first;
  return numberOrNull(fallback);
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    if (typeof item === "string") out.push(item);
  }
  return out;
}
