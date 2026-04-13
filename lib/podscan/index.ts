// ============================================================
// PODSCAN INTEGRATION LAYER — BARREL EXPORT
// Wave 4: Typed clients for all Podscan endpoints needed
// by the scoring engine (Wave 5).
// ============================================================

// Client
export { PodscanClient, PodscanApiError, getPodscanClient, getPodscanClientSafe } from "./client";

// Endpoint functions
export { searchCategoryLeaders, type CategoryLeadersParams } from "./category-leaders";
export { searchPodcasts, type PodcastSearchParams } from "./search";
export { discoverSimilar, type DiscoverParams, type DiscoverIndex } from "./discover";
export { getPodcastDemographics } from "./demographics";
export { getPodcastAnalysis } from "./analysis";
export { getEpisodeEngagement } from "./engagement";
export { getPodcastBrandSafety } from "./brand-safety";
export { getPodcastRankings, type RankingsParams } from "./rankings";

// Types
export type {
  // Core
  PodscanPodcast,
  PodscanPagination,
  PodscanReach,
  PodscanSocialLink,

  // Demographics
  PodscanDemographics,
  PodscanAgeDistributionEntry,
  PodscanAgeGenderEntry,
  PodscanGeoEntry,
  PodscanIndustryEntry,
  PodscanFamilyStatusEntry,

  // Brand Safety
  PodscanBrandSafetyResponse,
  PodscanBrandSafetyCategory,
  PodscanBrandSafetyEvidence,
  PodscanBrandSafetyEvidenceField,
  PodscanBrandSafetyAggregation,
  PodscanRiskLevel,
  PodscanAdvertiserRecommendation,

  // Analysis
  PodscanAnalysisResponse,
  PodscanAnalysisGuest,
  PodscanAnalysisSponsor,
  PodscanAnalysisHost,

  // Engagement
  PodscanPodcastEngagement,
  PodscanEpisodeEngagement,
  PodscanPlacementDetail,
  PodscanRetentionPoint,
  PodscanSkipDistributionPoint,

  // Discovery
  PodscanDiscoverResponse,
  PodscanDiscoverPodcast,

  // Category Leaders
  PodscanCategoryLeaderSelection,
  PodscanCategoryLeaderPodcast,
  PodscanCategoryLeadersResponse,

  // Rankings
  PodscanRankedPodcast,
  PodscanRankingsResponse,

  // Search
  PodscanSearchResponse,

  // Error
  PodscanErrorDetail,
} from "./types";
