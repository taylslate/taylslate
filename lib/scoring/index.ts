// ============================================================
// SCORING ENGINE — MAIN ORCHESTRATOR
// Takes a brand brief, pulls candidate shows via Category Leaders +
// Discover + Podcast Search, enriches each with demographics/
// analysis/engagement/brand-safety, scores across all dimensions,
// and returns a ranked list of 50-100 shows.
//
// Brand safety is attached as metadata but does NOT affect the score.
// ============================================================

import type { CampaignBrief } from "@/lib/data/types";
import {
  type PodscanClient,
  getPodscanClient,
  searchCategoryLeaders,
  searchPodcasts,
  discoverSimilar,
  getPodcastDemographics,
  getPodcastAnalysis,
  getPodcastBrandSafety,
} from "@/lib/podscan";
import type {
  PodscanPodcast,
  PodscanCategoryLeaderPodcast,
  PodscanDemographics,
  PodscanAnalysisResponse,
  PodscanBrandSafetyResponse,
  PodscanPodcastEngagement,
} from "@/lib/podscan/types";
import { mapInterestsToPodscanCategoryIds } from "@/lib/discovery/category-mapping";
import { DEFAULT_WEIGHTS, redistributeWeights, type ScoringWeights } from "./weights";
import { scoreAudienceFit } from "./dimensions/audience-fit";
import { scoreAdEngagement } from "./dimensions/ad-engagement";
import { scoreSponsorRetention } from "./dimensions/sponsor-retention";
import { scoreReach } from "./dimensions/reach";

// ---- Output types ----

export interface DimensionScores {
  audienceFit: number | null;
  adEngagement: number | null;
  sponsorRetention: number | null;
  reach: number;
}

export interface ScoredShow {
  // Identity
  podcastId: string;
  name: string;
  description: string;
  imageUrl: string | null;
  websiteUrl: string | null;
  rssUrl: string | null;

  // Metadata
  categories: string[];
  publisherName: string | null;
  language: string | null;
  episodeCount: number;
  lastPostedAt: string | null;
  contactEmail: string | null;

  // Audience
  audienceSize: number;
  prsScore: number | null;

  // Scores
  compositeScore: number; // 0-100 weighted blend
  dimensionScores: DimensionScores;
  weightsUsed: ScoringWeights;

  // Enrichment data (for UI display)
  demographics: PodscanDemographics | null;
  sponsorHistory: {
    sponsors: { name: string; episodeCount: number }[];
    totalSponsors: number;
  } | null;
  engagement: PodscanPodcastEngagement | null;
  brandSafety: PodscanBrandSafetyResponse | null;

  // Source tracking
  source: "category_leaders" | "search" | "discover";
}

export interface ScoringResult {
  shows: ScoredShow[];
  meta: {
    candidatesFound: number;
    candidatesScored: number;
    sourceCounts: { categoryLeaders: number; search: number; discover: number };
    errors: string[];
    durationMs: number;
  };
}

export interface ScoringOptions {
  weights?: Partial<ScoringWeights>;
  maxCandidates?: number; // cap on candidates before enrichment, default 150
  maxResults?: number;    // final output cap, default 100
  minAudienceSize?: number; // default 1000
}

// ---- Candidate pool ----

interface Candidate {
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
  engagement: PodscanPodcastEngagement | null;
  source: "category_leaders" | "search" | "discover";
}

// ---- Main entry point ----

/**
 * Score and rank podcast shows for a brand brief.
 *
 * Pipeline:
 * 1. Pull candidates from Category Leaders, Podcast Search, and Discover
 * 2. Deduplicate by podcast ID
 * 3. Enrich each with demographics, analysis, engagement, brand safety
 * 4. Score across 4 dimensions with weight redistribution
 * 5. Sort by composite score descending
 * 6. Return top 50-100
 */
export async function scoreShows(
  brief: CampaignBrief,
  options?: ScoringOptions
): Promise<ScoringResult> {
  const startTime = Date.now();
  const errors: string[] = [];
  const client = getPodscanClient();

  const maxCandidates = options?.maxCandidates ?? 150;
  const maxResults = options?.maxResults ?? 100;
  const minAudience = options?.minAudienceSize ?? 1000;
  const baseWeights: ScoringWeights = {
    ...DEFAULT_WEIGHTS,
    ...options?.weights,
  };

  // Step 1: Build candidate pool from 3 sources
  const sourceCounts = { categoryLeaders: 0, search: 0, discover: 0 };
  const candidateMap = new Map<string, Candidate>();

  const [leaderCandidates, searchCandidates] = await Promise.all([
    pullFromCategoryLeaders(client, brief, errors),
    pullFromSearch(client, brief, minAudience, errors),
  ]);

  for (const c of leaderCandidates) {
    if (!candidateMap.has(c.podcastId)) {
      candidateMap.set(c.podcastId, c);
      sourceCounts.categoryLeaders++;
    }
  }
  for (const c of searchCandidates) {
    if (!candidateMap.has(c.podcastId)) {
      candidateMap.set(c.podcastId, c);
      sourceCounts.search++;
    }
  }

  // Discover: fan out from top 3 candidates found so far
  const topSeeds = Array.from(candidateMap.values())
    .sort((a, b) => (b.prsScore ?? 0) - (a.prsScore ?? 0))
    .slice(0, 3);

  if (topSeeds.length > 0) {
    const discoverCandidates = await pullFromDiscover(client, topSeeds, errors);
    for (const c of discoverCandidates) {
      if (!candidateMap.has(c.podcastId)) {
        candidateMap.set(c.podcastId, c);
        sourceCounts.discover++;
      }
    }
  }

  // Filter by minimum audience, English-only language, and cap candidates.
  // language === null is kept (category-leaders response omits it; API doesn't
  // support a language filter there, so we can't distinguish English from not).
  const candidates = Array.from(candidateMap.values())
    .filter((c) => c.audienceSize >= minAudience || c.audienceSize === 0)
    .filter((c) => !c.language || c.language.toLowerCase().startsWith("en"))
    .slice(0, maxCandidates);

  console.log(`[scoring] ${candidates.length} candidates after dedup and filtering (${sourceCounts.categoryLeaders} leaders, ${sourceCounts.search} search, ${sourceCounts.discover} discover)`);

  // Step 2: Enrich and score in batches (concurrency-limited)
  const scoredShows = await enrichAndScore(client, candidates, brief, baseWeights, errors);

  // Step 3: Sort by composite score, return top N
  scoredShows.sort((a, b) => b.compositeScore - a.compositeScore);
  const results = scoredShows.slice(0, maxResults);

  return {
    shows: results,
    meta: {
      candidatesFound: candidateMap.size,
      candidatesScored: scoredShows.length,
      sourceCounts,
      errors,
      durationMs: Date.now() - startTime,
    },
  };
}

// ---- Candidate pulling ----

async function pullFromCategoryLeaders(
  client: PodscanClient,
  brief: CampaignBrief,
  errors: string[]
): Promise<Candidate[]> {
  const categoryIds = mapInterestsToPodscanCategoryIds(brief.target_interests);
  if (categoryIds.length === 0) return [];

  try {
    // Use chart-based category leaders (these return actual data)
    // Map interests to chart category slugs
    const chartCategories = mapInterestsToChartCategories(brief.target_interests);
    if (chartCategories.length === 0) return [];

    const result = await searchCategoryLeaders(client, {
      selections: chartCategories.map((cat) => ({
        type: "chart" as const,
        id: cat,
        platform: "apple" as const,
        country: "us",
      })),
      limit: 100,
    });

    return result.podcasts.map((p) => categoryLeaderToCandidate(p));
  } catch (err) {
    errors.push(`Category leaders: ${err instanceof Error ? err.message : "unknown error"}`);
    return [];
  }
}

async function pullFromSearch(
  client: PodscanClient,
  brief: CampaignBrief,
  minAudience: number,
  errors: string[]
): Promise<Candidate[]> {
  const candidates: Candidate[] = [];

  // Run 2-3 search queries in parallel
  const queries: string[] = [];

  // Query from keywords
  if (brief.keywords.length > 0) {
    queries.push(brief.keywords.slice(0, 4).join(" "));
  }

  // Query from interests
  if (brief.target_interests.length > 0) {
    queries.push(brief.target_interests.slice(0, 3).join(" ").toLowerCase());
  }

  // Cross-query
  if (brief.keywords.length > 0 && brief.target_interests.length > 0) {
    queries.push(
      [...brief.keywords.slice(0, 2), brief.target_interests[0].toLowerCase()].join(" ")
    );
  }

  const results = await Promise.allSettled(
    queries.map((q) =>
      searchPodcasts(client, {
        query: q,
        perPage: 50,
        minAudienceSize: minAudience,
        hasSponsors: true,
        orderBy: "audience_size",
        orderDir: "desc",
        language: "en",
      })
    )
  );

  for (const result of results) {
    if (result.status === "fulfilled") {
      for (const p of result.value.podcasts) {
        candidates.push(podcastToCandidate(p, "search"));
      }
    } else {
      errors.push(`Search: ${result.reason instanceof Error ? result.reason.message : "unknown error"}`);
    }
  }

  return candidates;
}

async function pullFromDiscover(
  client: PodscanClient,
  seeds: Candidate[],
  errors: string[]
): Promise<Candidate[]> {
  const candidates: Candidate[] = [];

  const results = await Promise.allSettled(
    seeds.map((seed) =>
      discoverSimilar(client, {
        podcastId: seed.podcastId,
        indices: ["content", "demographics", "commercial"],
        weights: [0.4, 0.35, 0.25],
        limit: 20,
      })
    )
  );

  for (const result of results) {
    if (result.status === "fulfilled") {
      for (const p of result.value.similar_podcasts) {
        candidates.push(podcastToCandidate(p, "discover"));
      }
    } else {
      errors.push(`Discover: ${result.reason instanceof Error ? result.reason.message : "unknown error"}`);
    }
  }

  return candidates;
}

// ---- Enrichment + scoring ----

// Podscan Professional: 15 concurrent, 120/min. Each candidate = 3 enrichment calls.
// 5 concurrent candidates × 3 calls = 15 max in-flight requests.
const ENRICHMENT_CONCURRENCY = 5;

async function enrichAndScore(
  client: PodscanClient,
  candidates: Candidate[],
  brief: CampaignBrief,
  baseWeights: ScoringWeights,
  errors: string[]
): Promise<ScoredShow[]> {
  const results: ScoredShow[] = [];

  // Process in batches to respect Podscan's 15 concurrent limit
  for (let i = 0; i < candidates.length; i += ENRICHMENT_CONCURRENCY) {
    const batch = candidates.slice(i, i + ENRICHMENT_CONCURRENCY);

    const batchResults = await Promise.allSettled(
      batch.map((c) => enrichAndScoreOne(client, c, brief, baseWeights))
    );

    for (const result of batchResults) {
      if (result.status === "fulfilled") {
        results.push(result.value);
      } else {
        errors.push(`Enrich: ${result.reason instanceof Error ? result.reason.message : "unknown"}`);
      }
    }

    // Pause between batches to stay under 120/min rate limit
    if (i + ENRICHMENT_CONCURRENCY < candidates.length) {
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  return results;
}

async function enrichAndScoreOne(
  client: PodscanClient,
  candidate: Candidate,
  brief: CampaignBrief,
  baseWeights: ScoringWeights
): Promise<ScoredShow> {
  // Fetch enrichment data in parallel (4 API calls per candidate)
  const [demographics, analysis, brandSafety] = await Promise.all([
    getPodcastDemographics(client, candidate.podcastId).catch(() => null),
    getPodcastAnalysis(client, candidate.podcastId).catch(() => null),
    getPodcastBrandSafety(client, candidate.podcastId).catch(() => null),
  ]);

  // Engagement comes from the podcast object's listener_engagement field
  const engagement = candidate.engagement;

  // Score each dimension
  const audienceFitScore = scoreAudienceFit(demographics, brief);
  const adEngagementScore = scoreAdEngagement(engagement);
  const sponsorRetentionScore = scoreSponsorRetention(analysis);
  const reachScore = scoreReach(candidate.audienceSize, candidate.prsScore);

  // Redistribute weights based on data availability
  const weights = redistributeWeights(baseWeights, {
    audienceFit: audienceFitScore !== null,
    adEngagement: adEngagementScore !== null,
    sponsorRetention: sponsorRetentionScore !== null,
    reach: true, // reach always has data
  });

  // Compute weighted composite score
  const compositeScore = Math.round(
    (audienceFitScore ?? 0) * weights.audienceFit +
    (adEngagementScore ?? 0) * weights.adEngagement +
    (sponsorRetentionScore ?? 0) * weights.sponsorRetention +
    reachScore * weights.reach
  );

  return {
    podcastId: candidate.podcastId,
    name: candidate.name,
    description: candidate.description,
    imageUrl: candidate.imageUrl,
    websiteUrl: candidate.websiteUrl,
    rssUrl: candidate.rssUrl,
    categories: candidate.categories,
    publisherName: candidate.publisherName,
    language: candidate.language,
    episodeCount: candidate.episodeCount,
    lastPostedAt: candidate.lastPostedAt,
    contactEmail: candidate.contactEmail,
    audienceSize: candidate.audienceSize,
    prsScore: candidate.prsScore,

    compositeScore: Math.min(100, Math.max(0, compositeScore)),
    dimensionScores: {
      audienceFit: audienceFitScore,
      adEngagement: adEngagementScore,
      sponsorRetention: sponsorRetentionScore,
      reach: reachScore,
    },
    weightsUsed: weights,

    demographics,
    sponsorHistory: analysis
      ? {
          sponsors: analysis.sponsors.map((s) => ({
            name: s.name,
            episodeCount: s.episode_count,
          })),
          totalSponsors: analysis.sponsors.length,
        }
      : null,
    engagement,
    brandSafety,

    source: candidate.source,
  };
}

// ---- Conversion helpers ----

function extractCategories(
  cats: (string | { category_id: string; category_name: string })[]
): string[] {
  return (cats ?? []).map((c) =>
    typeof c === "object" && c !== null && "category_name" in c
      ? c.category_name
      : String(c)
  );
}

function podcastToCandidate(
  p: PodscanPodcast,
  source: "search" | "discover"
): Candidate {
  return {
    podcastId: p.podcast_id,
    name: p.podcast_name,
    description: p.podcast_description ?? "",
    imageUrl: p.podcast_image_url ?? null,
    websiteUrl: p.reach?.website ?? p.podcast_url ?? null,
    rssUrl: p.rss_url ?? null,
    categories: extractCategories(p.podcast_categories),
    publisherName: p.publisher_name ?? null,
    language: p.language ?? null,
    episodeCount: p.episode_count ?? 0,
    lastPostedAt: p.last_posted_at ?? null,
    contactEmail: p.reach?.email ?? null,
    audienceSize: p.reach?.audience_size ?? 0,
    prsScore: p.podcast_reach_score ?? null,
    engagement: p.listener_engagement ?? null,
    source,
  };
}

function categoryLeaderToCandidate(
  p: PodscanCategoryLeaderPodcast
): Candidate {
  return {
    podcastId: p.id,
    name: p.name,
    description: "",
    imageUrl: p.image_url ?? null,
    websiteUrl: p.website ?? null,
    rssUrl: null,
    categories: [],
    publisherName: null,
    language: null,
    episodeCount: p.episode_count ?? 0,
    lastPostedAt: p.last_posted_at ?? null,
    contactEmail: p.email ?? null,
    audienceSize: p.audience_size ?? 0,
    prsScore: p.prs_score ?? null,
    engagement: null,
    source: "category_leaders",
  };
}

// ---- Interest → chart category mapping ----

const INTEREST_TO_CHART_CATEGORY: Record<string, string[]> = {
  "Health & Wellness": ["health-fitness", "science"],
  "Technology": ["technology"],
  "Business & Finance": ["business", "investing"],
  "Entertainment": ["tv-film", "leisure"],
  "Sports": ["sports"],
  "Parenting & Family": ["kids-family"],
  "Education": ["education"],
  "True Crime": ["true-crime"],
  "Comedy": ["comedy"],
  "Self-Improvement": ["self-improvement", "education"],
};

function mapInterestsToChartCategories(interests: string[]): string[] {
  const cats = new Set<string>();
  for (const interest of interests) {
    const mapped = INTEREST_TO_CHART_CATEGORY[interest];
    if (mapped) {
      for (const c of mapped) cats.add(c);
    }
  }
  return Array.from(cats);
}
