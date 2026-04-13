// ============================================================
// PODSCAN API TYPES
// TypeScript interfaces for all Podscan REST API responses
// used by the Taylslate scoring engine (Wave 5).
//
// Base URL: https://podscan.fm/api/v1
// Auth: Bearer token via PODSCAN_API_KEY
// Plan: Professional (5K/day, 120/min, 15 concurrent)
// ============================================================

// ---- Pagination ----

export interface PodscanPagination {
  total: number;
  per_page: number;
  current_page: number;
  last_page: number;
  from: number | null;
  to: number | null;
}

// ---- Reach (nested in podcast objects) ----

export interface PodscanSocialLink {
  platform: string;
  url: string;
}

export interface PodscanReach {
  audience_size: number | null;
  email: string | null;
  website: string | null;
  social_links: PodscanSocialLink[];
  itunes: {
    itunes_rating_average?: number | null;
    itunes_rating_count?: number | null;
    itunes_rating_count_bracket?: string | null;
  } | [];
  spotify: {
    spotify_rating_average?: number | null;
    spotify_rating_count?: number | null;
    spotify_rating_count_bracket?: string | null;
  } | [];
}

// ---- Listener Engagement (podcast-level, from GET /podcasts/{id}) ----

export interface PodscanPlacementDetail {
  sessions_reached: number;
  sessions_engaged: number;
  sessions_skipped: number;
  reach_rate: number | null;
  engagement_rate: number | null;
  threshold_seconds: number | null;
  episode_duration_seconds: number | null;
}

export interface PodscanPodcastEngagement {
  total_listeners: number;
  total_sessions: number;
  episode_count: number;
  avg_completion_ratio: number;
  avg_engagement_ratio: number;
  avg_play_seconds: number;
  avg_completion_rate: number;
  avg_ad_engagement_rate: number;
  avg_skips_per_session: number;
  avg_pre_roll_ad_engagement_rate: number;
  avg_mid_roll_ad_engagement_rate: number;
  avg_post_roll_ad_engagement_rate: number;
  placement_details: {
    pre_roll?: PodscanPlacementDetail;
    mid_roll?: PodscanPlacementDetail;
    post_roll?: PodscanPlacementDetail;
  } | null;
  country_breakdown: Record<string, number>;
  state_breakdown: Record<string, Record<string, number>>;
  data_start: string;
  data_end: string;
}

// ---- Podcast Object ----

export interface PodscanPodcast {
  podcast_id: string;
  podcast_guid?: string;
  podcast_name: string;
  podcast_url?: string;
  podcast_description?: string;
  podcast_image_url?: string | null;
  podcast_categories: (string | { category_id: string; category_name: string })[];
  podcast_iab_categories?: (string | { iab_category_id: string; iab_category_name: string })[];
  podcast_has_guests?: boolean | null;
  podcast_has_sponsors?: boolean | null;
  podcast_itunes_id?: string;
  podcast_spotify_id?: string | null;
  podcast_reach_score?: number | null;
  publisher_name?: string;
  publisher_ids?: string[];
  brand_safety?: PodscanBrandSafetyAggregation | null;
  reach?: PodscanReach;
  rss_url?: string;
  rss_url_normalized?: string;
  is_active?: boolean;
  episode_count?: number;
  episodes_in_database?: number;
  language?: string;
  region?: string;
  last_posted_at?: string;
  last_scanned_at?: string;
  created_at?: string;
  updated_at?: string;
  is_duplicate?: boolean;
  is_duplicate_of?: string | null;
  avg_episode_duration?: number;
  avg_episode_duration_display?: string;
  listener_engagement?: PodscanPodcastEngagement | null;
  podcast_summary?: string | null;
}

// ---- Brand Safety ----

export type PodscanRiskLevel = "none" | "low" | "medium" | "high" | "floor_violation";

export type PodscanAdvertiserRecommendation =
  | "safe"
  | "safe_for_all"
  | "safe_with_caution"
  | "warning"
  | "medium_risk"
  | "unsafe"
  | "high_risk"
  | "unsafe_for_all"
  | "low_risk"
  | "none";

export interface PodscanBrandSafetyEvidence {
  timestamp?: string;
  excerpt?: string;
  text?: string;
}

/** Evidence can be an array of objects OR an object with parallel arrays */
export type PodscanBrandSafetyEvidenceField =
  | PodscanBrandSafetyEvidence[]
  | { excerpts: string[]; timestamps: string[] };

export interface PodscanBrandSafetyCategory {
  name?: string;
  category?: string;
  risk_level: PodscanRiskLevel;
  advertiser_recommendation?: PodscanAdvertiserRecommendation;
  reasoning: string | null;
  evidence: PodscanBrandSafetyEvidenceField;
}

export interface PodscanBrandSafetyAggregation {
  max_risk_level?: PodscanRiskLevel;
  most_common_recommendation?: PodscanAdvertiserRecommendation;
}

export interface PodscanBrandSafetyResponse {
  framework: "GARM";
  podcast_id: string;
  podcast_name: string;
  aggregation: {
    episode_count: number;
    max_risk_level: PodscanRiskLevel;
    most_common_recommendation: PodscanAdvertiserRecommendation;
    risk_distribution: Record<PodscanRiskLevel, number>;
  };
  categories: PodscanBrandSafetyCategory[];
}

// ---- Demographics ----

export interface PodscanAgeDistributionEntry {
  age: string; // "0-18", "18-24", "25-34", "35-44", "45-54", "55-64", "65+"
  percentage: number;
}

export interface PodscanAgeGenderEntry {
  age: string;
  gender: string;
  percentage: number;
}

export interface PodscanGeoEntry {
  region: string; // "North America", "Europe", "Asia", etc.
  percentage: number;
}

export interface PodscanIndustryEntry {
  industry: string;
  percentage: number;
}

export interface PodscanFamilyStatusEntry {
  status: string; // "single_no_children", "married_no_children", etc.
  percentage: number;
}

export interface PodscanDemographics {
  episodes_analyzed: number;
  total_episodes: number;
  age: string | null; // dominant age bracket, e.g. "25-34"
  gender_skew: string | null; // "heavily_male" | "mostly_male" | "leaning_male" | "balanced" | etc.
  purchasing_power: string | null; // "low" | "medium" | "high"
  education_level: string | null;
  engagement_level: string | null;
  age_distribution: PodscanAgeDistributionEntry[] | null;
  age_gender_distribution: PodscanAgeGenderEntry[] | null;
  geographic_distribution: PodscanGeoEntry[] | null;
  professional_industry: PodscanIndustryEntry[] | null;
  family_status_distribution: PodscanFamilyStatusEntry[] | null;
  technology_adoption: {
    profile: string; // "early_adopter", "innovator", "early_majority", etc.
    confidence_score: number;
    reasoning: string;
  } | null;
  content_habits: {
    primary_platforms: string[];
    content_frequency: string;
    preferred_formats: string[];
    consumption_context: string[];
  } | null;
  ideological_leaning: {
    spectrum: string; // "far_left" | "left" | "center_left" | "center" | "center_right" | "right" | "far_right"
    confidence_score?: number;
    polarization_level?: string;
    reasoning?: string;
  } | null;
  living_environment: {
    urban: number;
    suburban: number;
    rural: number;
    confidence_score?: number;
    reasoning?: string;
  } | null;
  brand_relationship: {
    loyalty_level: string; // "very_low" | "low" | "moderate" | "high" | "very_high"
    price_sensitivity?: string;
    brand_switching_frequency?: string;
    advocacy_potential?: string;
    reasoning?: string;
  } | null;
}

// ---- Analysis (sponsor/guest history) ----

export interface PodscanAnalysisGuest {
  name: string;
  company: string | null;
  industry: string | null;
  occupation: string | null;
  episode_count: number;
}

export interface PodscanAnalysisSponsor {
  name: string;
  product_mentioned: string | null;
  url: string | null;
  episode_count: number;
}

export interface PodscanAnalysisHost {
  name: string;
  company?: string | null;
  occupation?: string | null;
}

export interface PodscanAnalysisResponse {
  podcast_id: string;
  podcast_name: string;
  episodes_analyzed: number;
  guests: PodscanAnalysisGuest[];
  sponsors: PodscanAnalysisSponsor[];
  hosts: PodscanAnalysisHost[];
  catchup_summary: {
    summary?: string;
    key_topics?: string[];
    notable_guests?: string[];
  } | null;
}

// ---- Episode Engagement ----

export interface PodscanRetentionPoint {
  position: number;
  percent: number;
}

export interface PodscanSkipDistributionPoint {
  position: number;
  skip_rate: number;
}

export interface PodscanEpisodeEngagement {
  episode_id: string;
  episode_title: string;
  podcast_id: string;
  podcast_name: string;
  engagement_data: {
    total_listeners: number;
    total_sessions: number;
    total_play_seconds: number;
    avg_play_seconds: number;
    avg_completion_ratio: number;
    completion_rate: number;
    engagement_ratio: number;
    ad_engagement_rate: number;
    placement_details: {
      pre_roll?: PodscanPlacementDetail;
      mid_roll?: PodscanPlacementDetail;
      post_roll?: PodscanPlacementDetail;
    } | null;
    retention_curve: PodscanRetentionPoint[] | null;
    country_breakdown: Record<string, number> | null;
    podcast_benchmarks: Record<string, number> | null;
  };
}

// ---- Discover (vector similarity) ----

export interface PodscanDiscoverPodcast extends PodscanPodcast {
  similarity_scores?: Record<string, number>; // per-index scores
}

export interface PodscanDiscoverResponse {
  similar_podcasts: PodscanDiscoverPodcast[];
  meta?: Record<string, unknown>;
}

// ---- Category Leaders ----

export interface PodscanCategoryLeaderSelection {
  type: "category" | "iab" | "chart";
  id: string;
  country?: string;
  platform?: "apple" | "spotify";
}

/** Category leader podcasts have a simplified shape compared to standard podcasts */
export interface PodscanCategoryLeaderPodcast {
  id: string; // podcast ID (not "podcast_id")
  name: string;
  website?: string;
  email?: string;
  prs_score: number;
  episode_count?: number;
  last_posted_at?: string;
  image_url?: string | null;
  audience_size?: number | null;
  social_media_links?: PodscanSocialLink[];
}

export interface PodscanCategoryLeadersResponse {
  podcasts: PodscanCategoryLeaderPodcast[];
  total: number;
  limit: number;
}

// ---- Rankings ----

export interface PodscanRankedPodcast {
  podcast_id: string;
  podcast_name: string;
  podcast_url?: string;
  prs_score: number;
  podcast_image_url?: string | null;
  episode_count?: number;
  last_episode_date?: string;
  dashboard_url?: string;
}

export interface PodscanRankingsResponse {
  podcasts: PodscanRankedPodcast[];
  count: number;
  filters: {
    min_score: number;
    max_score: number;
    order: string;
    limit: number;
  };
  statistics: {
    total_count: number;
    average_score: number;
    min_score: number;
    max_score: number;
  };
}

// ---- Search ----

export interface PodscanSearchResponse {
  podcasts: PodscanPodcast[];
  pagination: PodscanPagination;
}

// ---- Error ----

export interface PodscanErrorDetail {
  error: boolean;
  code: string;
  message: string;
  details?: Record<string, unknown>;
}
