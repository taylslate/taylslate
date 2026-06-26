// ============================================================
// TAYLSLATE DATA TYPES
// Single source of truth for the entire platform.
// Maps to Supabase tables when connected; used with seed data until then.
// ============================================================

// ---- User Roles ----

export type UserRole = "brand" | "agency" | "agent" | "show";

export type SubscriptionTier = "free" | "starter" | "growth" | "business";

export interface Profile {
  id: string;
  email: string;
  full_name: string;
  company_name?: string;
  company_url?: string;
  role: UserRole;
  tier: SubscriptionTier;
  created_at: string;
}

// ---- Shows ----

export type Platform = "podcast" | "youtube";

export type AdFormat =
  | "host_read"
  | "scripted"
  | "personal_experience"
  | "dynamic_insertion"
  | "integration";

export type Placement = "pre-roll" | "mid-roll" | "post-roll";

export type PriceType = "cpm" | "flat_rate";

export interface ShowContact {
  name: string;
  email: string;
  method: "email" | "form" | "network_rep" | "agent";
}

export interface ShowDemographics {
  age_18_24?: number;
  age_25_34?: number;
  age_35_44?: number;
  age_45_54?: number;
  age_55_plus?: number;
  male?: number;
  female?: number;
  us?: number;
  uk?: number;
  canada?: number;
  australia?: number;
  hhi_50k_plus?: number; // household income $50K+
  hhi_100k_plus?: number;
}

export interface ShowRateCard {
  preroll_cpm?: number;
  midroll_cpm?: number;
  postroll_cpm?: number;
  flat_rate?: number; // for YouTube or flat-rate podcast deals
}

export interface Show {
  id: string;
  name: string;
  platform: Platform;
  description: string;
  image_url?: string;

  // Taxonomy
  categories: string[];
  tags: string[];

  // Network & contacts
  network?: string;
  contact: ShowContact;
  agent_id?: string; // references an agent Profile

  // Audience
  audience_size: number; // avg downloads/ep (podcast) or avg views (youtube)
  demographics: ShowDemographics;
  audience_interests: string[];
  /**
   * Estimated audience purchase power 0-100 (Wave 14 Phase 2B). Derived from
   * a category proxy (lib/scoring/purchase-power) and persisted to
   * shows.audience_purchase_power; one of three non-gating conviction
   * dimensions. Optional: undefined on shows ingested before the proxy ran.
   */
  audience_purchase_power?: number;

  // Pricing — the gold
  rate_card: ShowRateCard;
  price_type: PriceType;
  min_buy?: number; // minimum campaign spend

  // Ad formats
  ad_formats: AdFormat[];
  episode_cadence: "daily" | "weekly" | "biweekly" | "monthly";
  avg_episode_length_min: number;

  // Sponsors (current + historical)
  current_sponsors: string[];
  past_sponsors?: string[];

  // External IDs
  apple_id?: string;
  spotify_id?: string;
  youtube_channel_id?: string;
  rss_url?: string;

  // Verification
  is_claimed: boolean;
  is_verified: boolean;

  // Availability
  available_slots?: number; // open ad slots in next 30 days
  next_available_date?: string;

  // Metadata
  data_sources?: string[]; // e.g. ["seed"], ["discovery"], ["podscan"], ["agent_import"]
  last_api_refresh?: string;

  /**
   * Wave 14 Phase 2B (migration 026). Simulcast surfaces — populated only when
   * a podcast + long-form YouTube record for the same show are merged into one
   * record (lib/discovery mergeSimulcasts). Null/undefined for single-surface
   * shows, which is every show while discovery is podcast-only.
   */
  surfaces?: ShowSurfaces;
  /**
   * Wave 14 Phase 2B (migration 026). Medium-specific scoring priors (CPM
   * range, engagement weight, frequency norms). Populated light for launch;
   * structure reserved for full medium-aware scoring math (deferred).
   */
  medium_priors?: Record<string, unknown>;

  created_at: string;
  updated_at: string;
}

/**
 * Wave 14 Phase 2B (migration 026). Simulcast surface payload: the same show
 * present on both podcast and long-form YouTube, merged into one record. Light
 * shape — one key per surface the show appears on; absent keys mean the show is
 * not on that surface. Forward-compatible with medium-aware scoring math.
 */
export interface ShowSurfaces {
  podcast?: {
    rss_url?: string;
    audience_size?: number;
    rate_card?: ShowRateCard;
  };
  youtube?: {
    youtube_channel_id?: string;
    audience_size?: number;
    rate_card?: ShowRateCard;
  };
}

// ---- Campaigns (Brand Side) ----

export type CampaignStatus =
  | "draft"
  | "planned"
  | "active"
  | "completed"
  | "archived";

export interface CampaignBrief {
  brand_url?: string;
  target_age_range?: string;
  target_gender?: string;
  target_interests: string[];
  keywords: string[];
  campaign_goals?: string;
}

// ---- Campaign Brief v2 (Wave 14 Phase 2A) ----
// Free-text-led brief intake. Stored in the same campaigns.brief JSONB
// column, discriminated by `version: 2`. Fields are optional because a
// draft row exists before the brand finishes the form (the derive-product
// endpoint needs a campaign id); validation happens at submit.

export type BriefGoal =
  | "test_channel"
  | "scale_winner"
  | "direct_response"
  | "brand_awareness"
  | "lead_gen";

export type BriefFlightPreset =
  | "asap"
  | "next_30_days"
  | "next_60_days"
  | "next_quarter";

export interface BriefFlight {
  mode: "preset" | "dates";
  preset?: BriefFlightPreset;
  start_date?: string; // ISO date
  end_date?: string;   // ISO date
}

/** Brand-confirmed product derivation plus where it came from. */
export interface BriefProduct extends ProductDerivation {
  source: "url" | "paragraph";
  url?: string | null;
}

/** Fields the returning-brand check-in lets the brand edit directly. */
export type BriefChangedFieldKey =
  | "product_url"
  | "customer_description"
  | "exclusions";

export interface BriefChangedField {
  before: string | null;
  after: string | null;
}

export interface CampaignBriefV2 {
  version: 2;
  product?: BriefProduct;
  customer_text?: string;
  /** Returning-brand check-in: prior pattern reused and/or what changed. */
  customer_context?: {
    reused_from_pattern_id?: string;
    /** Legacy free-text delta; no longer written by the intake form. */
    delta_text?: string;
    /** New full product URL on the returning-brand path. */
    product_url?: string | null;
    /**
     * Field-level before/after for fields the brand edited in the
     * check-in. Audit record — Layer 4 reads the new full values from
     * customer_text / exclusions_text / product_url, not from here.
     */
    changed_fields?: Partial<Record<BriefChangedFieldKey, BriefChangedField>>;
    /**
     * Brand-confirmed re-derivation when the returning brand changed the
     * product URL. Canonical over the prior pattern's product attributes
     * for category, AOV bucket, and analog retrieval.
     */
    product_attributes?: ProductDerivation;
  };
  goals?: BriefGoal[];
  goals_context?: string;
  flight?: BriefFlight;
  exclusions_text?: string;
  /** Set when the brand submits the brief; absent on un-submitted drafts. */
  submitted_at?: string;
}

export function isBriefV2(
  brief: CampaignBrief | CampaignBriefV2
): brief is CampaignBriefV2 {
  return (brief as CampaignBriefV2).version === 2;
}

export interface ShowRecommendation {
  show_id: string;
  show_name: string;
  platform: Platform;
  network?: string;
  image_url?: string;
  fit_score: number; // 0-100
  estimated_cpm: number;
  audience_size: number;
  categories: string[];
  current_sponsors: string[];
  allocated_budget: number;
  num_episodes: number;
  placement: Placement;
  estimated_impressions: number;
  overlap_flag: boolean;
  overlap_with: string[];
  contact_email: string;
}

export interface YouTubeRecommendation {
  show_id: string;
  show_name: string;
  platform: "youtube";
  network?: string;
  image_url?: string;
  fit_score: number; // 0-100
  audience_size: number; // avg views per video
  categories: string[];
  current_sponsors: string[];
  allocated_budget: number;
  flat_fee_per_video: number;
  num_videos: number;
  estimated_views: number; // audience_size × num_videos
  overlap_flag: boolean;
  overlap_with: string[];
  contact_email: string;
}

export interface ExpansionShow {
  show_id: string;
  show_name: string;
  platform: Platform;
  network?: string;
  image_url?: string;
  fit_score: number; // 0-100
  estimated_cpm?: number; // podcast only
  flat_fee?: number; // youtube only — per video
  audience_size: number;
  categories: string[];
  current_sponsors: string[];
  contact_email: string;
  reason: string; // why this show is a good expansion pick
}

export interface Campaign {
  id: string;
  user_id: string;
  /** Wave 8: the brand profile the campaign was created from, if any. */
  brand_profile_id?: string | null;
  name: string;
  brief: CampaignBrief | CampaignBriefV2;
  budget_total: number;
  platforms: Platform[];
  status: CampaignStatus;
  recommendations: ShowRecommendation[]; // podcast recommendations (legacy)
  youtube_recommendations?: YouTubeRecommendation[];
  expansion_opportunities?: ExpansionShow[];
  // Wave 6: Scoring engine output
  scored_shows?: ScoredShowRecord[]; // JSONB from scoring engine
  selected_show_ids?: string[];      // podcast IDs the brand checked
  scoring_meta?: Record<string, unknown>;
  // Wave 7: Media plan builder persistence
  media_plan?: MediaPlan | null;
  // Wave 14 Phase 2C Layer 5 (migration 029): campaign-level portfolio override
  // INPUTS. Durable system-of-record for the brand's test config, kept separate
  // from the recomputed cost/tier cache on conviction_scores. null ⇒ default
  // (3 spots / 'midroll'); survives a discovery re-run (which mints a new
  // pattern). test_placement uses the DISCOVERY vocabulary ('preroll' |
  // 'midroll' | 'postroll'), mapped to Wave 7 at the media-plan handoff.
  test_spot_count?: number | null;
  test_placement?: "preroll" | "midroll" | "postroll" | null;
  created_at: string;
  updated_at: string;
}

// ---- Brand Profile (Wave 8) ----

export type BrandTargetGender = "mostly_men" | "mostly_women" | "mixed" | "no_preference";

export type BrandCampaignGoal =
  | "direct_sales"
  | "brand_awareness"
  | "new_product"
  | "test_podcast";

export interface BrandProfile {
  id: string;
  user_id: string;

  // Step 2–4 (free text)
  brand_identity?: string | null;
  brand_website?: string | null;
  target_customer?: string | null;

  // Step 5 (age range)
  target_age_min?: number | null;
  target_age_max?: number | null;

  // Step 6
  target_gender?: BrandTargetGender | null;

  // Step 7
  content_categories?: string[];

  // Step 8 — multi-select, 1-3 goals
  campaign_goals?: BrandCampaignGoal[] | null;

  // Step 9
  exclusions?: string | null;

  onboarded_at?: string | null;
  created_at: string;
  updated_at: string;
}

// ---- Show Profile (Wave 9) ----

export type ShowProfilePlatform = "podcast" | "youtube" | "both";

export type ShowEpisodeCadence =
  | "daily"
  | "weekly"
  | "biweekly"
  | "monthly"
  | "irregular";

export type ShowAdFormat = "host_read_baked" | "dynamic_insertion";

export type ShowAdReadType =
  | "personal_experience"
  | "scripted"
  | "talking_points"
  | "any";

export type ShowPlacement = "pre_roll" | "mid_roll" | "post_roll";

export type ShowCategoryExclusion =
  | "gambling"
  | "alcohol"
  | "supplements"
  | "political"
  | "crypto"
  | "adult"
  | "none";

export interface ShowProfile {
  id: string;
  user_id: string;

  // Step 1
  feed_url?: string | null;

  // Step 2 — Podscan-enriched, editable
  podscan_id?: string | null;
  show_name?: string | null;
  show_description?: string | null;
  show_image_url?: string | null;
  show_categories?: string[];
  episode_count?: number | null;

  // Step 3
  platform?: ShowProfilePlatform | null;

  // Step 4
  episode_cadence?: ShowEpisodeCadence | null;

  // Step 5
  audience_size?: number | null;

  // Step 6
  expected_cpm?: number | null;

  // Steps 7-10 (multi-select)
  ad_formats?: ShowAdFormat[];
  ad_read_types?: ShowAdReadType[];
  placements?: ShowPlacement[];
  category_exclusions?: ShowCategoryExclusion[];

  // Step 11 (Wave 11) — contact routing. Both optional, fall back to profiles.email.
  ad_copy_email?: string | null;
  billing_email?: string | null;

  onboarded_at?: string | null;
  created_at: string;
  updated_at: string;
}

// ---- Media Plan (Wave 7) ----

export type PlanSpacing = "weekly" | "biweekly" | "monthly";

/** Per-show configuration chosen by the brand in the plan builder. */
export interface MediaPlanLineItem {
  podcast_id: string;      // references ScoredShowRecord.podcastId
  placement: Placement;
  num_episodes: number;
}

export interface MediaPlan {
  default_placement: Placement;
  default_episodes: number;
  spacing: PlanSpacing;
  line_items: MediaPlanLineItem[];
  updated_at: string;
}

/** Serializable subset of ScoredShow for JSONB storage */
export interface ScoredShowRecord {
  podcastId: string;
  name: string;
  description: string;
  imageUrl: string | null;
  websiteUrl: string | null;
  rssUrl: string | null;
  categories: string[];
  publisherName: string | null;
  language: string | null;
  episodeCount: number;
  lastPostedAt: string | null;
  contactEmail: string | null;
  audienceSize: number;
  prsScore: number | null;
  compositeScore: number;
  dimensionScores: {
    audienceFit: number | null;
    adEngagement: number | null;
    sponsorRetention: number | null;
    reach: number;
  };
  estimatedCpm: number;
  demographics: {
    genderSkew: string | null;
    dominantAge: string | null;
    purchasingPower: string | null;
  } | null;
  sponsorCount: number;
  adEngagementRate: number | null;
  brandSafety: {
    maxRiskLevel: string;
    recommendation: string;
  } | null;
  source: "category_leaders" | "search" | "discover";
}

// ---- Outreach Drafts ----

export interface OutreachDraft {
  show_id: string;
  show_name: string;
  platform: Platform;
  contact_email: string;
  subject: string;
  body: string;
  sent?: boolean;
}

// ---- Outreach (Wave 11) ----

export type OutreachResponseStatus =
  | "pending"
  | "accepted"
  | "countered"
  | "declined"
  | "no_response";

export type OutreachPlacement = Placement;

export interface Outreach {
  id: string;
  brand_profile_id: string;
  campaign_id: string;
  show_id?: string | null;
  podscan_id?: string | null;
  show_name: string;

  proposed_cpm: number;
  proposed_episode_count: number;
  proposed_placement: OutreachPlacement;
  proposed_flight_start: string;
  proposed_flight_end: string;

  pitch_body: string;

  sent_at?: string | null;
  sent_to_email: string;

  response_status: OutreachResponseStatus;
  responded_at?: string | null;
  counter_cpm?: number | null;
  counter_message?: string | null;
  decline_reason?: string | null;

  token: string;

  created_at: string;
  updated_at: string;
}

// ---- Wave 12: Outreach-driven Deal lifecycle ----
// New status values for deals created from accepted outreaches. Older legacy
// deal statuses (planning, io_sent, live, completed) coexist on the same
// table — Wave-12 deals are identified by a non-null outreach_id.

export type Wave12DealStatus =
  | "planning"        // outreach accepted, IO not yet sent for signature
  | "brand_signed"    // brand signed, awaiting show countersignature
  | "show_signed"     // both signed (terminal until delivery starts)
  | "live"            // ad campaign in flight
  | "delivering"      // verification mid-flight
  | "completed"       // wrapped
  | "cancelled";      // any party cancelled or 14-day timeout fired

export interface Wave12Deal {
  id: string;
  outreach_id: string;
  brand_profile_id: string;
  show_profile_id: string;
  status: Wave12DealStatus;

  agreed_cpm: number;
  agreed_episode_count: number;
  agreed_placement: Placement;
  agreed_flight_start: string;
  agreed_flight_end: string;

  docusign_envelope_id?: string | null;
  brand_signed_at?: string | null;
  show_signed_at?: string | null;
  signed_io_pdf_url?: string | null;
  signature_certificate_url?: string | null;
  brand_reminder_sent_at?: string | null;
  cancelled_at?: string | null;
  cancellation_reason?: string | null;

  created_at: string;
  updated_at: string;
}

// ---- Domain Events (Wave 12) ----

export type DomainEventType =
  | "deal.created"
  | "deal.updated"
  | "deal.status_changed"
  | "deal.cancelled"
  | "io.generated"
  | "io.sent_for_signature"
  | "io.brand_signed"
  | "io.show_signed"
  | "io.completed"
  | "io.declined"
  | "io.counter_accepted"
  | "io.timeout_cancelled"
  // Wave 13 — subscription/plan transitions
  | "customer.upgraded"
  | "customer.downgraded"
  | "customer.plan_changed"
  | "customer.seat_added"
  | "customer.seat_removed"
  | "customer.conversion_alert_sent"
  // Wave 13 — payment lifecycle (Stripe pay-as-delivers)
  | "payment.charged"
  | "payment.failed"
  | "payment.settled"
  | "payment.disputed"
  // Wave 13 — Stripe subscription webhook state
  | "subscription.updated"
  | "subscription.deleted"
  // Wave 13 — Pay-as-delivers SetupIntent + payout flow
  | "deal.setup_intent_created"
  | "deal.payment_method_attached"
  | "payout.transferred"
  | "payout.early_requested"
  // Wave 14 Phase 2A — brief intake + interpretation loop
  | "brief.url_derived"
  | "brief.url_derivation_failed"
  | "brief.submitted"
  | "brief.interpretation_completed"
  | "brief.interpretation_failed"
  // Wave 14 Phase 2A Layer 5 — interpretation confirm + refine loop
  | "brief.refinement_submitted"
  | "brief.refinement_failed"
  | "brief.interpretation_confirmed"
  // Wave 14 Phase 2B Layer 3 — conviction scoring run finished
  | "conviction.scored"
  // Wave 14 Phase 2B Layer 4 — batched per-ring reasoning prose
  | "conviction.reasoning_generated"
  | "conviction.reasoning_failed"
  // Wave 14 Phase 2C Layer 2 — test/scale/dropped portfolio split completed
  | "portfolio.tiered"
  // Wave 14 Phase 2C Layer 5 — an override (spot-count / placement / per-show
  // CPM / reset) triggered a recompute of the split
  | "portfolio.override_applied"
  // Wave 14 Phase 2C Layer 4 — scale-tier watchlist curation + promotion
  | "scale_show.saved"
  | "scale_show.dismissed"
  | "scale_show.promoted_to_test";

export type DomainEntityType =
  | "deal"
  | "insertion_order"
  | "outreach"
  // Wave 13 — billing/subscription state lives on profiles
  | "customer"
  // Wave 13 — payments table + per-profile subscription audit
  | "payment"
  | "profile"
  // Wave 13 — pay-as-delivers payouts to show connected accounts
  | "payout"
  // Wave 14 Phase 2A — brief derivation/interpretation events hang off campaigns
  | "campaign";

export interface DomainEvent {
  id: string;
  event_type: DomainEventType;
  entity_type: DomainEntityType;
  entity_id: string;
  actor_id?: string | null;
  payload: Record<string, unknown>;
  schema_version: string;
  created_at: string;
}

// ---- Deals ----
// A deal is the relationship between a brand/agency and a show for a campaign.
// When approved, it generates an IO.

export type DealStatus = "planning" | "io_sent" | "live" | "completed";

export interface Deal {
  id: string;
  campaign_id?: string; // optional — agent-side deals may not have a campaign
  show_id: string;
  brand_id: string; // profile id of the brand
  agent_id?: string; // profile id of the agent (if show has one)
  agency_id?: string; // profile id of the agency (if applicable)

  // Deal terms
  status: DealStatus;
  num_episodes: number;
  placement: Placement;
  ad_format: AdFormat;
  price_type: PriceType;
  cpm_rate: number; // the actual negotiated CPM
  gross_cpm?: number; // CPM charged to brand (if agency involved)
  guaranteed_downloads: number; // per episode

  // Calculated
  net_per_episode: number; // what the show receives per episode
  gross_per_episode?: number; // what the brand/agency pays per episode
  total_net: number; // total show payment
  total_gross?: number; // total brand payment

  // Content terms
  is_scripted: boolean;
  is_personal_experience: boolean;
  reader_type: "host_read" | "producer_read" | "guest_read";
  content_type: "evergreen" | "dated";
  pixel_required: boolean;

  // Exclusivity
  competitor_exclusion: string[]; // brand names
  exclusivity_days: number; // typically 90
  rofr_days: number; // right of first refusal, typically 30

  // Dates
  flight_start: string;
  flight_end: string;

  notes?: string;
  created_at: string;
  updated_at: string;
}

// ---- Insertion Orders ----

export type IOStatus =
  | "draft"
  | "sent"
  | "signed"
  | "active"
  | "completed"
  | "cancelled";

export interface IOLineItem {
  id: string;
  format: Platform;
  post_date: string; // scheduled episode air date
  guaranteed_downloads: number;
  show_name: string;
  placement: Placement;
  is_scripted: boolean;
  is_personal_experience: boolean;
  reader_type: "host_read" | "producer_read" | "guest_read";
  content_type: "evergreen" | "dated";
  pixel_required: boolean;
  gross_rate: number; // what brand/agency pays
  gross_cpm: number; // CPM charged to brand
  price_type: PriceType;
  net_due: number; // what show receives

  // Post-delivery tracking
  actual_post_date?: string;
  actual_downloads?: number;
  episode_url?: string;
  ad_timestamp?: string; // time in episode where ad appears
  verified: boolean;
  make_good_triggered: boolean;
  make_good_reason?: string;
}

export interface InsertionOrder {
  id: string;
  io_number: string; // e.g., "IO-2026-0001"
  deal_id: string;

  // Parties
  advertiser_name: string;
  advertiser_contact_name?: string;
  advertiser_contact_email?: string;

  publisher_name: string; // show entity name (e.g., "Left Field Enterprises")
  publisher_contact_name: string;
  publisher_contact_email: string;
  publisher_address?: string;

  agency_name?: string;
  agency_contact_name?: string;
  agency_contact_email?: string;
  agency_billing_contact?: string;
  agency_address?: string;
  send_invoices_to?: string;

  // Line items
  line_items: IOLineItem[];

  // Totals
  total_downloads: number;
  total_gross: number;
  total_net: number;

  // Terms (standard boilerplate from VeritoneOne template)
  payment_terms: string; // e.g., "Net 30 EOM"
  competitor_exclusion: string[];
  exclusivity_days: number;
  rofr_days: number;
  cancellation_notice_days: number; // typically 14
  download_tracking_days: number; // typically 45
  make_good_threshold: number; // typically 0.10 (10%)

  // Status & signature
  status: IOStatus;
  sent_at?: string;
  signed_at?: string;
  signed_by_publisher?: string;
  signed_by_agency?: string;

  created_at: string;
  updated_at: string;
}

// ---- Invoices ----

export type InvoiceStatus =
  | "draft"
  | "sent"
  | "paid"
  | "overdue"
  | "disputed"
  | "cancelled";

export interface InvoiceLineItem {
  id: string;
  io_line_item_id: string; // references the IO line item
  show_name: string;
  post_date: string;
  description: string; // e.g., "Mid-roll ad - Oddvice - Aug 2, 2021"
  guaranteed_downloads: number;
  actual_downloads?: number;
  rate: number; // net due amount
  make_good: boolean;
}

export interface Invoice {
  id: string;
  invoice_number: string; // e.g., "INV-2026-0001"
  io_id: string;
  io_number: string; // for display

  // Parties
  bill_to_name: string;
  bill_to_email: string;
  bill_to_address?: string;

  from_name: string;
  from_email: string;
  from_address?: string;

  // Reference
  advertiser_name: string;
  campaign_period: string; // e.g., "August 2021"

  // Line items
  line_items: InvoiceLineItem[];

  // Totals
  subtotal: number;
  adjustments: number; // make-good deductions
  total_due: number;

  // Payment
  status: InvoiceStatus;
  due_date: string;
  sent_at?: string;
  paid_at?: string;
  payment_method?: string;

  notes?: string;
  created_at: string;
  updated_at: string;
}

// ---- Payment Tracking ----

export type PaymentStatus =
  | "pending"
  | "processing"
  | "completed"
  | "failed"
  | "refunded";

export interface Payment {
  id: string;
  invoice_id: string;
  amount: number;
  status: PaymentStatus;
  method: "stripe" | "wire" | "check" | "ach" | "manual";
  stripe_payment_id?: string;
  processed_at?: string;
  created_at: string;
}

// ---- Agent-Show Relationship ----

export interface AgentShowRelationship {
  id: string;
  agent_id: string; // profile id
  show_id: string;
  commission_rate?: number; // agent's cut, e.g., 0.15 for 15%
  is_exclusive: boolean; // is this agent the exclusive rep?
  created_at: string;
}

// ---- Dashboard Aggregates (computed, not stored) ----

export interface AgentDashboardStats {
  total_shows: number;
  active_deals: number;
  pending_invoices: number;
  revenue_this_month: number;
  revenue_outstanding: number;
}

export interface BrandDashboardStats {
  active_campaigns: number;
  total_spend: number;
  total_impressions: number;
  shows_booked: number;
}

// ---- Wave 14 Phase 1: Discovery Agent Foundation row types ----
// These mirror the columns added by migration 019. Service-side admin
// types (snake_case) — used by lib/data/reasoning-log.ts and any future
// code that reads these tables directly.

export type AovBucket = "low" | "mid" | "high";

// Wave 14 Phase 2A Layer 2 — AI-derived product read from a brand URL (or
// pasted paragraph). Returned by /api/campaigns/[id]/derive-product for the
// brief intake read-back card. Not persisted — the brand-confirmed version
// is saved when the brief is submitted.
export interface ProductDerivation {
  brand_name: string;
  category: string;
  product_description: string;
  aov_bucket: AovBucket;
  aov_reasoning: string;
  key_attributes: string[];
}

export type RingHypothesisKind = "primary" | "lateral" | "confirmed";

export type ConvictionBand = "high" | "medium" | "low" | "speculative";

export type ConvictionTier = "test" | "scale" | "dropped";

// Wave 14 Phase 2C (migration 028). How a per-show spot cost was derived;
// persisted to conviction_scores.cost_basis (controlled vocabulary). Gates
// whether cost is allowed to decide the test/scale split: 'rate_card' (real
// onboarded) and 'derived' (podcast downloads × CPM) are gate-worthy;
// 'flat_fee' (non-onboarded YouTube) is conviction-only, cost never gates.
// Canonical home so the data layer can type the persisted column without
// importing from lib/discovery (lib/discovery/spot-cost.ts re-exports this).
export type CostBasis = "derived" | "flat_fee" | "rate_card";

// Wave 14 Phase 2B. Coarse audience-affluence tier from a category proxy
// (lib/scoring/purchase-power). Collapses to the shows.audience_purchase_power
// int via fixed anchors high=80 / medium=50 / low=25. One of three NON-GATING
// conviction dimensions — never a hard filter.
export type PurchasePowerTier = "high" | "medium" | "low";

// Wave 14 Phase 2A. Five-state brand decision on a proposed ring hypothesis.
// Replaces the boolean brand_confirmed flag; see migration 021.
export type BrandDecision =
  | "pending"
  | "confirmed"
  | "rejected"
  | "refined"
  | "added_by_brand";

export interface CampaignPatternRow {
  id: string;
  campaign_id: string | null;
  customer_id: string | null;
  created_at: string;
  product_attributes: Record<string, unknown>;
  customer_description: string | null;
  aov_bucket: AovBucket | null;
  scoring_weights: Record<string, unknown> | null;
}

export interface RingHypothesisRow {
  id: string;
  campaign_pattern_id: string;
  created_at: string;
  kind: RingHypothesisKind;
  label: string;
  reasoning: string | null;
  confidence: ConvictionBand;
  confidence_score: number | null;
  // DEPRECATED (Wave 14 Phase 2A): use brand_decision. Preserved for
  // backwards compatibility; not written by new code.
  brand_confirmed: boolean | null;
  brand_decision: BrandDecision;
  // Stable display slot within a pattern (migration 025). primary=0, laterals
  // 1..n; a refinement inherits its predecessor's slot, a brand-added ring
  // takes the next slot. Reconstruction sorts by this, not created_at.
  // Nullable for rows written before migration 025 backfilled.
  slot_position: number | null;
}

export interface ConvictionScoreRow {
  id: string;
  campaign_pattern_id: string;
  show_id: string | null;
  ring_hypothesis_id: string | null;
  created_at: string;
  audience_fit_score: number | null;
  topical_relevance_score: number | null;
  purchase_power_score: number | null;
  composite_score: number | null;
  conviction_band: ConvictionBand | null;
  reasoning: string | null;
  tier: ConvictionTier | null;
  // Wave 14 Phase 2C (migration 028) — per-show derived cost + tier curation.
  // Per-show values written to ALL of a show's ring rows by the tier pass; null
  // until tierCampaignPortfolio runs (or when persistence fails soft → the view
  // computes them on read). All integer cents; cpm_used_cents null for flat-fee.
  per_spot_cents: number | null;
  three_spot_cents: number | null;
  cpm_used_cents: number | null;
  cost_basis: CostBasis | null;
  cost_is_estimate: boolean | null;
  needs_quote: boolean | null;
  // Brand watchlist curation on the scale tier (write actions are Layer 4).
  brand_saved: boolean | null;
  brand_dismissed: boolean | null;
  // Wave 14 Phase 2C Layer 5 (migration 029) — per-show override INPUTS, written
  // to ALL of a show's ring rows (same grain as the cost columns above). Durable
  // system-of-record, kept separate from the cost/tier cache: the recompute reads
  // these + the band tables to rewrite the cache, so a per-show edit survives a
  // later campaign-level recompute. null ⇒ no override (derive from the band /
  // use the campaign placement default). cpm_override_cents is integer cents;
  // placement_override uses the discovery vocabulary (preroll/midroll/postroll).
  cpm_override_cents: number | null;
  placement_override: "preroll" | "midroll" | "postroll" | null;
}

export interface AnalogMatchRow {
  id: string;
  campaign_pattern_id: string;
  analog_name: string;
  reasoning: string | null;
  similarity_score: number | null;
  /** FK to the campaign_patterns row the analog came from (migration 022). */
  analog_pattern_id: string | null;
  created_at: string;
}

export interface FounderAnnotationRow {
  id: string;
  show_id: string | null;
  author_id: string | null;
  created_at: string;
  note: string;
  tags: string[];
}

/**
 * Self-reported by a show during onboarding (Wave 14 Phase 1).
 * Stored as JSONB on show_profiles.brand_history.
 */
export interface ShowBrandHistoryEntry {
  brand_name: string;
  category?: string;
  deal_type?: "one-off" | "annual";
  notes?: string;
}

// ---- Wave 14 Phase 2A Layer 4: brief interpretation ----
// Shape returned by POST /api/campaigns/[id]/interpret and rendered by the
// Layer 5 interpretation page. Ring ids are nullable because pattern
// library persistence is fail-soft — the interpretation still returns when
// a write fails; Layer 5 disables the confirm flow for rings without ids.

export interface InterpretedRing {
  ring_hypothesis_id: string | null;
  ring_label: string;
  confidence: ConvictionBand;
  reasoning: string;
  /** Brand names of library analogs the model cited for this ring. */
  analog_campaigns: string[];
}

export interface BriefInterpretation {
  campaign_pattern_id: string | null;
  campaign_pattern: {
    customer_summary: string;
    interpretation_confidence: ConvictionBand;
    /** Structured parse of the brief's free-text exclusions. */
    exclusions_parsed: string[];
  };
  primary_ring: InterpretedRing;
  lateral_rings: InterpretedRing[];
}
