// ============================================================
// CATEGORY MAPPING
// Maps Taylslate campaign brief interests to Podscan category
// IDs, YouTube search terms, and diverse discovery queries.
//
// Podscan: Uses /episodes/search with text queries + category filters
// YouTube: one normalized query per confirmed ring (capped at 4). When a
// run has fewer than 4 ring queries, top up with the interest/keyword query
// and shorter ring tails. No ring labels: the interest/keyword query alone.
// ============================================================

import type { DiscoveryBrief } from "./discover-shows";

/**
 * Maps the 18 Taylslate audience interest categories to Podscan
 * category IDs. These are the actual ct_* IDs from Podscan's /categories endpoint.
 */
const INTEREST_TO_PODSCAN: Record<string, string[]> = {
  "Health & Wellness": ["ct_akrev35b2454ypql", "ct_ox4amd5dkpneyq2r", "ct_3krv4dnrkq579l6o", "ct_rmxeo6n6aowvqpzj", "ct_o9mjlawx3owkdy3r"], // health, fitness, wellness, medicine, mental
  "Technology": ["ct_3krv4dnrrqn79l6o"], // technology
  "Business & Finance": ["ct_o9mjlawx3owkdy3r", "ct_7v9m4lnk9wx6jkap", "ct_m68b3l5qo8nx7k4r"], // business, investing, entrepreneurship
  "Entertainment": ["ct_rzemq35l4jn9x27d", "ct_6zvjgq5arjw8drle", "ct_akrev35bv9w4ypql"], // tv, leisure, film
  "Sports": ["ct_6vqzjd529vn8xlep"], // sports
  "Parenting & Family": ["ct_7v9m4lnkd95x6jka", "ct_pr6a94ngra5ez2dk", "ct_6vqzjd52avw8xlep"], // kids, family, parenting
  "Education": ["ct_6olr4e5edkwb7yj2", "ct_adpvjb57v657k6qe"], // education, learning
  "True Crime": ["ct_lxbp9dwoak5aeom7"], // true crime
  "Comedy": ["ct_z9majpn4brwo73bx"], // comedy
  "Self-Improvement": ["ct_zqbe76njppnyjx43", "ct_rzemq35ldjn9x27d"], // self-improvement, personal-development
};

/**
 * Adjacent interest mapping — when a user selects one interest,
 * we also search these related categories to broaden discovery.
 * This ensures a $120K sauna brand gets health, wellness, biohacking,
 * recovery, fitness shows — not just literal sauna podcasts.
 */
/**
 * Podscan category IDs for removed interests — still accessible via adjacent search.
 * These aren't selectable in the UI but their IDs enrich discovery for related interests.
 */
const REMOVED_CATEGORY_IDS: Record<string, string[]> = {
  "Food & Cooking": ["ct_ox4amd5dp5eyq2rl", "ct_lxbp9dwoxkwaeom7"],
  "Travel": ["ct_7v9m4lnkr9wx6jka", "ct_m68b3l5q285x7k4r"],
  "Gaming": ["ct_adpvjb57e6n7k6qe", "ct_rzemq35l6459x27d"],
  "Fashion & Beauty": ["ct_rzemq35lo459x27d", "ct_akrev35b4w4ypql9"],
  "Politics & News": ["ct_2v89gony7jnrqj3d", "ct_m68b3l5q68nx7k4r", "ct_8kgrblw8aoneo36z"],
  "Science": ["ct_3pk7q259ebwvr4bx", "ct_zqbe76njjpnyjx43"],
  "Music": ["ct_akrev35bm4w4ypql"],
};

const ADJACENT_INTERESTS: Record<string, string[]> = {
  "Health & Wellness": ["Self-Improvement", "Science", "Food & Cooking"],
  "Technology": ["Business & Finance", "Science", "Education"],
  "Business & Finance": ["Technology", "Self-Improvement", "Education"],
  "Entertainment": ["Comedy", "Music", "True Crime"],
  "Sports": ["Health & Wellness", "Self-Improvement"],
  "Parenting & Family": ["Health & Wellness", "Education", "Self-Improvement"],
  "Education": ["Science", "Technology", "Self-Improvement"],
  "True Crime": ["Entertainment", "Politics & News"],
  "Comedy": ["Entertainment"],
  "Self-Improvement": ["Health & Wellness", "Business & Finance", "Education"],
};

/**
 * Search terms per interest — used to build diverse text queries
 * for Podscan's /episodes/search endpoint.
 */
const INTEREST_SEARCH_TERMS: Record<string, string[]> = {
  "Health & Wellness": ["fitness", "workout", "wellness", "health", "recovery", "biohacking", "nutrition", "mental health", "longevity", "supplements"],
  "Technology": ["tech", "software", "AI", "gadgets", "startups"],
  "Business & Finance": ["business", "finance", "investing", "entrepreneurship", "marketing"],
  "Entertainment": ["entertainment", "pop culture", "movies", "tv shows", "celebrity"],
  "Sports": ["sports", "athletics", "training", "coaching"],
  "Parenting & Family": ["parenting", "family", "kids", "motherhood", "fatherhood"],
  "Education": ["education", "learning", "teaching", "knowledge"],
  "True Crime": ["true crime", "crime", "mystery", "investigation", "forensics"],
  "Comedy": ["comedy", "humor", "stand up", "funny"],
  "Self-Improvement": ["self improvement", "motivation", "productivity", "mindset", "habits"],
  // Removed interests — still used for adjacent term lookups
  "Food & Cooking": ["cooking", "food", "recipes", "nutrition", "chef"],
  "Travel": ["travel", "adventure", "explore", "destinations"],
  "Gaming": ["gaming", "video games", "esports", "streaming"],
  "Fashion & Beauty": ["fashion", "beauty", "style", "skincare", "makeup"],
  "Politics & News": ["news", "politics", "current events", "policy"],
  "Science": ["science", "research", "neuroscience", "biology", "physics"],
  "Music": ["music", "musician", "songs", "artist", "producer"],
};

/**
 * Maps interests to YouTube search modifiers for better channel discovery.
 * YouTube API requires text-based queries (no category ID system like Podscan).
 */
const INTEREST_TO_YOUTUBE_TERMS: Record<string, string[]> = {
  "Health & Wellness": ["fitness", "workout", "wellness", "health", "nutrition"],
  "Technology": ["tech", "technology", "gadgets", "software"],
  "Business & Finance": ["business", "finance", "investing", "entrepreneurship"],
  "Entertainment": ["entertainment", "pop culture", "movies", "tv"],
  "Sports": ["sports", "athletics", "training"],
  "Parenting & Family": ["parenting", "family", "kids", "mom", "dad"],
  "Education": ["education", "learning", "tutorial", "how to"],
  "True Crime": ["true crime", "crime", "mystery", "investigation"],
  "Comedy": ["comedy", "funny", "humor", "stand up"],
  "Self-Improvement": ["self improvement", "motivation", "productivity", "mindset"],
};

/**
 * True if `name` is a recognized Podscan interest bucket — i.e. it resolves to
 * category IDs (INTEREST_TO_PODSCAN) and/or per-interest search terms
 * (INTEREST_SEARCH_TERMS). The source of truth callers validate against so a
 * near-miss bucket name (e.g. "Health and Wellness") is caught instead of
 * silently mapping to nothing. Byte-for-byte; keys are case/punctuation exact.
 */
export function isKnownPodscanInterest(name: string): boolean {
  return (
    Object.prototype.hasOwnProperty.call(INTEREST_TO_PODSCAN, name) ||
    Object.prototype.hasOwnProperty.call(INTEREST_SEARCH_TERMS, name)
  );
}

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
 * Get adjacent category IDs for broader discovery.
 * Returns category IDs from related interests that the user didn't explicitly select.
 */
export function getAdjacentCategoryIds(interests: string[]): string[] {
  const ids = new Set<string>();
  const selectedSet = new Set(interests);

  for (const interest of interests) {
    const adjacent = ADJACENT_INTERESTS[interest] ?? [];
    for (const adj of adjacent) {
      // Only include adjacent categories not already in the user's selection
      if (!selectedSet.has(adj)) {
        // Check primary map first, then removed categories
        const mapped = INTEREST_TO_PODSCAN[adj] ?? REMOVED_CATEGORY_IDS[adj];
        if (mapped) {
          for (const id of mapped) ids.add(id);
        }
      }
    }
  }
  return Array.from(ids);
}

/**
 * Build 5-6 diverse text queries for Podscan /episodes/search.
 *
 * Strategy:
 * - Query 1: Direct keywords from brief ("sauna wellness recovery")
 * - Query 2-3: Interest-specific terms ("health wellness nutrition", "fitness workout biohacking")
 * - Query 4: Adjacent interest terms ("self improvement motivation", "science neuroscience")
 * - Query 5-6: Broader category terms ("health podcast", "wellness lifestyle")
 *
 * Each query gets paired with category IDs as filters for relevance.
 */
export function buildDiscoveryQueries(brief: DiscoveryBrief): {
  query: string;
  categoryIds: string;
  perPage: number;
  hasSponsors?: boolean;
}[] {
  const queries: { query: string; categoryIds: string; perPage: number; hasSponsors?: boolean }[] = [];
  const primaryCategoryIds = mapInterestsToPodscanCategoryIds(brief.target_interests);
  const adjacentCategoryIds = getAdjacentCategoryIds(brief.target_interests);
  const allCategoryIds = [...new Set([...primaryCategoryIds, ...adjacentCategoryIds])];

  // Query 1: Direct keywords from brief (highest priority, largest batch)
  if (brief.keywords.length > 0) {
    queries.push({
      query: brief.keywords.slice(0, 4).join(" "),
      categoryIds: primaryCategoryIds.join(","),
      perPage: 25,
    });
  }

  // Query 2-3: Each interest gets its own broad search with interest-specific terms
  for (const interest of brief.target_interests.slice(0, 2)) {
    const terms = INTEREST_SEARCH_TERMS[interest];
    if (terms) {
      queries.push({
        query: terms.slice(0, 3).join(" "),
        categoryIds: primaryCategoryIds.join(","),
        perPage: 20,
      });
    }
  }

  // Query 4: Adjacent interest terms — broadens the net
  const adjacentTerms: string[] = [];
  const selectedSet = new Set(brief.target_interests);
  for (const interest of brief.target_interests) {
    const adjacent = ADJACENT_INTERESTS[interest] ?? [];
    for (const adj of adjacent) {
      if (!selectedSet.has(adj)) {
        const terms = INTEREST_SEARCH_TERMS[adj];
        if (terms) adjacentTerms.push(...terms.slice(0, 2));
      }
    }
  }
  if (adjacentTerms.length > 0) {
    queries.push({
      query: [...new Set(adjacentTerms)].slice(0, 4).join(" "),
      categoryIds: adjacentCategoryIds.join(","),
      perPage: 20,
    });
  }

  // Query 5: Keywords + interest cross-pollination
  if (brief.keywords.length > 0 && brief.target_interests.length > 0) {
    const crossTerms: string[] = [...brief.keywords.slice(0, 2)];
    for (const interest of brief.target_interests.slice(0, 2)) {
      const terms = INTEREST_SEARCH_TERMS[interest];
      if (terms) crossTerms.push(terms[0]);
    }
    queries.push({
      query: [...new Set(crossTerms)].join(" "),
      categoryIds: allCategoryIds.join(","),
      perPage: 20,
    });
  }

  // Query 6: Broader "podcast" category search with has_sponsors filter
  if (brief.target_interests.length > 0) {
    const broadTerms = brief.target_interests
      .slice(0, 2)
      .map((i) => i.toLowerCase().replace(/ & /g, " "));
    queries.push({
      query: broadTerms.join(" ") + " podcast",
      categoryIds: primaryCategoryIds.join(","),
      perPage: 15,
      hasSponsors: true,
    });
  }

  // Fallback: if no queries generated, use interests as raw text
  if (queries.length === 0 && brief.target_interests.length > 0) {
    queries.push({
      query: brief.target_interests.join(" ").toLowerCase(),
      categoryIds: primaryCategoryIds.join(","),
      perPage: 25,
    });
  }

  return queries;
}

/**
 * One YouTube channel search per confirmed ring, plus top-up queries when
 * the ring list is short. The allowed band is 3 to 5. Four searches is 400
 * quota units (search.list is 100 each). The empty-result retry stays inside
 * this cap, so a run never issues a fifth channel search.
 */
export const MAX_YOUTUBE_SEARCHES = 4;

/** Words kept from a normalized ring label. */
const RING_QUERY_WORD_CAP = 5;

/**
 * One normalized query per confirmed ring, in slot order, capped at
 * MAX_YOUTUBE_SEARCHES. Hyphens and slashes become spaces, possessive 's
 * and other punctuation are dropped, and only the first 5 words are kept.
 * Identical labels count once. When fewer than 4 ring queries exist, top up
 * with the interest/keyword query, then shorter tails (last 3 words, then
 * last 2). A tail drops punctuation and keeps the letter s, so
 * "women's wellness" becomes "womens wellness". With no ring terms, fall
 * back to the single interest/keyword query.
 */
export function buildYouTubeQueries(brief: {
  target_interests: string[];
  keywords: string[];
  ring_terms?: string[];
}): string[] {
  const queries: string[] = [];
  const seen = new Set<string>();

  const push = (query: string): boolean => {
    const trimmed = query.trim().replace(/\s+/g, " ");
    if (!trimmed) return false;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) return false;
    if (queries.length >= MAX_YOUTUBE_SEARCHES) return false;
    seen.add(key);
    queries.push(trimmed);
    return true;
  };

  let ringQueries = 0;
  for (const term of brief.ring_terms ?? []) {
    const query = normalizeYouTubeRingLabel(term);
    if (!query) continue;
    if (push(query)) ringQueries += 1;
    if (queries.length >= MAX_YOUTUBE_SEARCHES) return queries;
  }

  if (ringQueries === 0) {
    const fallback = buildYouTubeQuery(brief).trim();
    return fallback ? [fallback] : [];
  }

  push(buildYouTubeQuery(brief));
  if (queries.length >= MAX_YOUTUBE_SEARCHES) return queries;

  for (const term of brief.ring_terms ?? []) {
    if (!normalizeYouTubeRingLabel(term)) continue;
    for (const variant of shorterYouTubeRingVariants(term)) {
      push(variant);
      if (queries.length >= MAX_YOUTUBE_SEARCHES) return queries;
    }
  }

  return queries;
}

/**
 * Search text for a ring label. Hyphens and slashes become spaces, possessive
 * 's is removed, remaining punctuation is dropped, and at most 5 words remain.
 */
function normalizeYouTubeRingLabel(label: string): string {
  const words = label
    .trim()
    .replace(/[-/]+/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((word) =>
      word
        .replace(/['\u2018\u2019\u02BC]s\b/gi, "")
        .replace(/[^\p{L}\p{N}]+/gu, "")
    )
    .filter(Boolean)
    .slice(0, RING_QUERY_WORD_CAP);
  return words.join(" ");
}

/**
 * Last 3 words, then last 2, with punctuation (including apostrophes) removed.
 * "women's wellness" becomes "womens wellness".
 */
function shorterYouTubeRingVariants(label: string): string[] {
  const words = label
    .trim()
    .replace(/[-/]+/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.replace(/[^\p{L}\p{N}]+/gu, ""))
    .filter(Boolean);
  const variants: string[] = [];
  if (words.length >= 3) variants.push(words.slice(-3).join(" "));
  if (words.length >= 2) variants.push(words.slice(-2).join(" "));
  return variants;
}

/**
 * Build a YouTube search query from campaign brief interests + keywords.
 * YouTube API needs text queries — combine interest terms with keywords
 * for the best channel discovery results.
 * Used when a brief has no confirmed ring terms, and as the top-up query
 * when a run has fewer than MAX_YOUTUBE_SEARCHES ring queries.
 */
export function buildYouTubeQuery(brief: {
  target_interests: string[];
  keywords: string[];
}): string {
  const parts: string[] = [];

  // Add 1-2 terms per interest (max 2 interests)
  for (const interest of brief.target_interests.slice(0, 2)) {
    const terms = INTEREST_TO_YOUTUBE_TERMS[interest];
    if (terms) {
      parts.push(...terms.slice(0, 2));
    }
  }

  // Add keywords — useful for YouTube where text search matters more
  // (e.g., "sauna" helps find wellness/biohacking YouTube channels)
  parts.push(...brief.keywords.slice(0, 2));

  // Fallback
  if (parts.length === 0) {
    return brief.target_interests[0] ?? "popular creator";
  }

  // Deduplicate and join
  return [...new Set(parts)].slice(0, 5).join(" ");
}
