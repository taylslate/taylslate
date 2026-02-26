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

  created_at: string;
  updated_at: string;
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

export interface ShowRecommendation {
  show_id: string;
  show_name: string;
  platform: Platform;
  network?: string;
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

export interface Campaign {
  id: string;
  user_id: string;
  name: string;
  brief: CampaignBrief;
  budget_total: number;
  platforms: Platform[];
  status: CampaignStatus;
  recommendations: ShowRecommendation[];
  created_at: string;
  updated_at: string;
}

// ---- Deals ----
// A deal is the relationship between a brand/agency and a show for a campaign.
// When approved, it generates an IO.

export type DealStatus =
  | "proposed" // brand/agent created the deal
  | "negotiating" // terms being discussed
  | "approved" // both sides agreed, IO ready to generate
  | "io_sent" // IO generated and sent for signature
  | "signed" // IO signed by both parties
  | "live" // campaign is running
  | "completed" // all episodes delivered
  | "cancelled";

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
