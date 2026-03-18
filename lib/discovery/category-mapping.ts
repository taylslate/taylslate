// ============================================================
// CATEGORY MAPPING
// Maps Taylslate campaign brief interests to Podscan category
// IDs and YouTube search terms for show discovery.
// ============================================================

/**
 * Maps the 18 Taylslate audience interest categories to Podscan
 * category slugs. Derived from Podscan's /categories endpoint.
 * Update if Podscan's taxonomy changes.
 */
const INTEREST_TO_PODSCAN: Record<string, string[]> = {
  "Fitness & Wellness": ["health-fitness", "sports"],
  "Technology": ["technology"],
  "Business & Finance": ["business", "investing"],
  "Entertainment": ["tv-film", "leisure", "music"],
  "Sports": ["sports"],
  "Parenting & Family": ["kids-family"],
  "Food & Cooking": ["food"],
  "Travel": ["places-travel"],
  "Education": ["education"],
  "Health & Medicine": ["health-fitness", "science-medicine"],
  "Gaming": ["technology", "leisure"],
  "Fashion & Beauty": ["arts", "society-culture"],
  "Politics & News": ["news-politics", "government-organizations"],
  "Science": ["science-medicine", "natural-sciences"],
  "True Crime": ["true-crime", "society-culture"],
  "Comedy": ["comedy"],
  "Music": ["music"],
  "Self-Improvement": ["self-improvement", "education"],
};

/**
 * Maps interests to YouTube search modifiers for better channel discovery.
 */
const INTEREST_TO_YOUTUBE_TERMS: Record<string, string[]> = {
  "Fitness & Wellness": ["fitness", "workout", "wellness", "health"],
  "Technology": ["tech", "technology", "gadgets", "software"],
  "Business & Finance": ["business", "finance", "investing", "entrepreneurship"],
  "Entertainment": ["entertainment", "pop culture", "movies", "tv"],
  "Sports": ["sports", "athletics", "training"],
  "Parenting & Family": ["parenting", "family", "kids", "mom", "dad"],
  "Food & Cooking": ["cooking", "food", "recipes", "chef"],
  "Travel": ["travel", "adventure", "explore"],
  "Education": ["education", "learning", "tutorial", "how to"],
  "Health & Medicine": ["health", "medical", "nutrition", "mental health"],
  "Gaming": ["gaming", "video games", "esports"],
  "Fashion & Beauty": ["fashion", "beauty", "style", "makeup"],
  "Politics & News": ["news", "politics", "current events"],
  "Science": ["science", "research", "space", "physics"],
  "True Crime": ["true crime", "crime", "mystery", "investigation"],
  "Comedy": ["comedy", "funny", "humor", "stand up"],
  "Music": ["music", "musician", "songs", "artist"],
  "Self-Improvement": ["self improvement", "motivation", "productivity", "mindset"],
};

/**
 * Convert campaign brief interests to Podscan category IDs.
 */
export function mapInterestsToPodscanCategoryIds(interests: string[]): string[] {
  const ids = new Set<string>();
  for (const interest of interests) {
    const mapped = INTEREST_TO_PODSCAN[interest];
    if (mapped) {
      for (const id of mapped) ids.add(id);
    }
  }
  return Array.from(ids);
}

/**
 * Build optimized search queries from the campaign brief.
 * Returns 2-3 distinct queries for Podscan and 1 for YouTube.
 */
export function buildSearchQueries(brief: {
  target_interests: string[];
  keywords: string[];
  campaign_goals?: string;
}): { podscanQueries: string[]; youtubeQuery: string } {
  const queries: string[] = [];

  // Query 1: Keywords (most specific)
  if (brief.keywords.length > 0) {
    queries.push(brief.keywords.slice(0, 3).join(" "));
  }

  // Query 2: Interest-based
  if (brief.target_interests.length > 0) {
    // Pick top 2 interests and use their YouTube terms (more descriptive than category slugs)
    const interestTerms = brief.target_interests
      .slice(0, 2)
      .flatMap((i) => (INTEREST_TO_YOUTUBE_TERMS[i] ?? []).slice(0, 2));
    if (interestTerms.length > 0) {
      const interestQuery = interestTerms.join(" ");
      // Only add if different from query 1
      if (!queries.includes(interestQuery)) {
        queries.push(interestQuery);
      }
    }
  }

  // Query 3: Goals-based (only if we have fewer than 2 queries)
  if (queries.length < 2 && brief.campaign_goals) {
    // Extract first 4 meaningful words from goals
    const goalWords = brief.campaign_goals
      .replace(/[^a-zA-Z\s]/g, "")
      .split(/\s+/)
      .filter((w) => w.length > 3)
      .slice(0, 4)
      .join(" ");
    if (goalWords && !queries.includes(goalWords)) {
      queries.push(goalWords);
    }
  }

  // Fallback: if no queries at all, use a generic one from interests
  if (queries.length === 0) {
    queries.push(brief.target_interests[0] ?? "popular podcast");
  }

  // YouTube query: combine keywords + interest terms
  const ytParts = [
    ...brief.keywords.slice(0, 2),
    ...brief.target_interests.slice(0, 2).flatMap((i) => (INTEREST_TO_YOUTUBE_TERMS[i] ?? []).slice(0, 1)),
  ];
  const youtubeQuery = ytParts.length > 0 ? ytParts.join(" ") : queries[0];

  return {
    podscanQueries: queries.slice(0, 3),
    youtubeQuery,
  };
}
