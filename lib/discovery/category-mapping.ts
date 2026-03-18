// ============================================================
// CATEGORY MAPPING
// Maps Taylslate campaign brief interests to Podscan category
// IDs and YouTube search terms for show discovery.
// ============================================================

/**
 * Maps the 18 Taylslate audience interest categories to Podscan
 * category IDs. These are the actual ct_* IDs from Podscan's /categories endpoint.
 */
const INTEREST_TO_PODSCAN: Record<string, string[]> = {
  "Fitness & Wellness": ["ct_akrev35b2454ypql", "ct_ox4amd5dkpneyq2r", "ct_3krv4dnrkq579l6o"], // health, fitness, wellness
  "Technology": ["ct_3krv4dnrrqn79l6o"], // technology
  "Business & Finance": ["ct_o9mjlawx3owkdy3r", "ct_7v9m4lnk9wx6jkap", "ct_m68b3l5qo8nx7k4r"], // business, investing, entrepreneurship
  "Entertainment": ["ct_rzemq35l4jn9x27d", "ct_6zvjgq5arjw8drle", "ct_akrev35bv9w4ypql"], // tv, leisure, film
  "Sports": ["ct_6vqzjd529vn8xlep"], // sports
  "Parenting & Family": ["ct_7v9m4lnkd95x6jka", "ct_pr6a94ngra5ez2dk", "ct_6vqzjd52avw8xlep"], // kids, family, parenting
  "Food & Cooking": ["ct_ox4amd5dp5eyq2rl", "ct_lxbp9dwoxkwaeom7"], // food, cooking
  "Travel": ["ct_7v9m4lnkr9wx6jka", "ct_m68b3l5q285x7k4r"], // travel, places
  "Education": ["ct_6olr4e5edkwb7yj2", "ct_adpvjb57v657k6qe"], // education, learning
  "Health & Medicine": ["ct_akrev35b2454ypql", "ct_rmxeo6n6aowvqpzj", "ct_o9mjlawx3owkdy3r"], // health, medicine, mental
  "Gaming": ["ct_adpvjb57e6n7k6qe", "ct_rzemq35l6459x27d"], // games, video-games
  "Fashion & Beauty": ["ct_rzemq35lo459x27d", "ct_akrev35b4w4ypql9"], // fashion, beauty (from arts subcats)
  "Politics & News": ["ct_2v89gony7jnrqj3d", "ct_m68b3l5q68nx7k4r", "ct_8kgrblw8aoneo36z"], // news, politics, government
  "Science": ["ct_3pk7q259ebwvr4bx", "ct_zqbe76njjpnyjx43"], // science, natural
  "True Crime": ["ct_lxbp9dwoak5aeom7"], // true crime
  "Comedy": ["ct_z9majpn4brwo73bx"], // comedy
  "Music": ["ct_akrev35bm4w4ypql"], // music (from leisure)
  "Self-Improvement": ["ct_zqbe76njppnyjx43", "ct_rzemq35ldjn9x27d"], // self-improvement, personal-development
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
