// Maps a confirmed ring onto the YouTube library's broad categories.
// Deterministic. No LLM call. Close enough beats an exact niche:
// protein gummies land on health, and health's neighbors come along.

import { YOUTUBE_CATEGORY_SETS } from "./categories";

const SET_IDS = YOUTUBE_CATEGORY_SETS.map((set) => set.id);

/** Pull-set ids plus lifestyle, which has no pull phrases of its own. */
export const LIBRARY_CATEGORY_ORDER = insertLifestyle(SET_IDS);

export type LibraryCategory = (typeof LIBRARY_CATEGORY_ORDER)[number];

const CATEGORY_SET = new Set<string>(LIBRARY_CATEGORY_ORDER);

function insertLifestyle(ids: string[]): readonly string[] {
  const order = ids.slice();
  const nutrition = order.indexOf("nutrition");
  const at = nutrition === -1 ? order.length : nutrition + 1;
  order.splice(at, 0, "lifestyle");
  return order;
}

export interface RingCategoryInput {
  terms?: string[];
  interests?: string[];
  category?: string;
}

export interface RingCategoryMatch {
  primary: LibraryCategory[];
  adjacent: LibraryCategory[];
}

/**
 * Neighbors of a primary category. Health reaches fitness, nutrition,
 * lifestyle, women's health, and mental health. Finance reaches business
 * and investing. A category is never adjacent to itself.
 */
const ADJACENT: Record<string, readonly string[]> = {
  health: ["fitness", "nutrition", "lifestyle", "womens-health", "mental-health"],
  fitness: ["health", "nutrition", "sports", "lifestyle"],
  nutrition: ["health", "fitness", "food", "lifestyle"],
  lifestyle: ["health", "fitness", "beauty", "parenting", "food"],
  "womens-health": ["health", "mental-health", "beauty", "lifestyle"],
  "mental-health": ["health", "womens-health", "lifestyle"],
  "personal-finance": ["business", "investing"],
  investing: ["personal-finance", "business"],
  business: ["personal-finance", "investing"],
  tech: ["business", "education", "gaming"],
  gaming: ["tech"],
  parenting: ["lifestyle", "education", "womens-health"],
  food: ["nutrition", "lifestyle", "health"],
  beauty: ["lifestyle", "womens-health"],
  outdoors: ["fitness", "sports", "lifestyle"],
  "true-crime": ["education"],
  comedy: ["true-crime"],
  education: ["tech"],
  home: ["lifestyle"],
  cars: ["tech", "sports"],
  sports: ["fitness", "outdoors"],
};

/**
 * Phrase → category. Longer phrases are listed first so a test can read
 * the table in the order they are meant. Matching itself is a union:
 * "mental health" hits mental-health and, via the word health, health.
 * Health includes wellness and supplements. Fitness includes workout and
 * gym. Lifestyle includes daily routine and women's lifestyle.
 */
const SYNONYMS: { phrase: string; category: string }[] = [
  { phrase: "daily wellness routine", category: "lifestyle" },
  { phrase: "womens daily wellness", category: "lifestyle" },
  { phrase: "day in the life", category: "lifestyle" },
  { phrase: "womens lifestyle", category: "lifestyle" },
  { phrase: "women lifestyle", category: "lifestyle" },
  { phrase: "daily routine", category: "lifestyle" },
  { phrase: "wellness routine", category: "lifestyle" },
  { phrase: "health and wellness", category: "health" },
  { phrase: "mental health", category: "mental-health" },
  { phrase: "womens health", category: "womens-health" },
  { phrase: "women health", category: "womens-health" },
  { phrase: "personal finance", category: "personal-finance" },
  { phrase: "business and finance", category: "business" },
  { phrase: "protein gummies", category: "health" },
  { phrase: "stock market", category: "investing" },
  { phrase: "index funds", category: "investing" },
  { phrase: "strength training", category: "fitness" },
  { phrase: "home workout", category: "fitness" },
  { phrase: "gym workout", category: "fitness" },
  { phrase: "supplements", category: "health" },
  { phrase: "supplement", category: "health" },
  { phrase: "wellness", category: "health" },
  { phrase: "wellbeing", category: "health" },
  { phrase: "protein", category: "health" },
  { phrase: "gummies", category: "health" },
  { phrase: "gummy", category: "health" },
  { phrase: "vitamin", category: "health" },
  { phrase: "healthy", category: "health" },
  { phrase: "health", category: "health" },
  { phrase: "fitness", category: "fitness" },
  { phrase: "workout", category: "fitness" },
  { phrase: "gym", category: "fitness" },
  { phrase: "lifestyle", category: "lifestyle" },
  { phrase: "vlog", category: "lifestyle" },
  { phrase: "nutrition", category: "nutrition" },
  { phrase: "dietitian", category: "nutrition" },
  { phrase: "womens", category: "womens-health" },
  { phrase: "menopause", category: "womens-health" },
  { phrase: "hormones", category: "womens-health" },
  { phrase: "anxiety", category: "mental-health" },
  { phrase: "therapy", category: "mental-health" },
  { phrase: "mindfulness", category: "mental-health" },
  { phrase: "finance", category: "personal-finance" },
  { phrase: "budgeting", category: "personal-finance" },
  { phrase: "debt", category: "personal-finance" },
  { phrase: "investing", category: "investing" },
  { phrase: "investment", category: "investing" },
  { phrase: "stocks", category: "investing" },
  { phrase: "portfolio", category: "investing" },
  { phrase: "entrepreneurship", category: "business" },
  { phrase: "entrepreneur", category: "business" },
  { phrase: "startup", category: "business" },
  { phrase: "founder", category: "business" },
  { phrase: "business", category: "business" },
  { phrase: "technology", category: "tech" },
  { phrase: "software", category: "tech" },
  { phrase: "gadget", category: "tech" },
  { phrase: "tech", category: "tech" },
  { phrase: "esports", category: "gaming" },
  { phrase: "gaming", category: "gaming" },
  { phrase: "parenting", category: "parenting" },
  { phrase: "motherhood", category: "parenting" },
  { phrase: "cooking", category: "food" },
  { phrase: "recipes", category: "food" },
  { phrase: "baking", category: "food" },
  { phrase: "skincare", category: "beauty" },
  { phrase: "makeup", category: "beauty" },
  { phrase: "beauty", category: "beauty" },
  { phrase: "hiking", category: "outdoors" },
  { phrase: "camping", category: "outdoors" },
  { phrase: "outdoor", category: "outdoors" },
  { phrase: "true crime", category: "true-crime" },
  { phrase: "comedy", category: "comedy" },
  { phrase: "education", category: "education" },
  { phrase: "woodworking", category: "home" },
  { phrase: "renovation", category: "home" },
  { phrase: "electric vehicles", category: "cars" },
  { phrase: "athlete", category: "sports" },
  { phrase: "athletes", category: "sports" },
  { phrase: "sports", category: "sports" },
];

/**
 * Niche-tag names from the taxonomy, plus the same names a ring might use.
 * Entertainment, music, and politics have no library category.
 */
const TAG_TO_CATEGORIES: Record<string, readonly string[]> = {
  "Health & Wellness": ["health"],
  Technology: ["tech"],
  "Business & Finance": ["business", "personal-finance"],
  Sports: ["sports"],
  "Parenting & Family": ["parenting"],
  Education: ["education"],
  "True Crime": ["true-crime"],
  Comedy: ["comedy"],
  "Self-Improvement": ["lifestyle"],
  "Food & Cooking": ["food"],
  Travel: ["outdoors"],
  Gaming: ["gaming"],
  "Fashion & Beauty": ["beauty", "lifestyle"],
  Science: ["education"],
};

const TOP_LEVEL_FALLBACK: Record<string, readonly string[]> = {
  "health and wellness": ["health"],
  "health & wellness": ["health"],
  health: ["health"],
  wellness: ["health"],
  "business and finance": ["personal-finance"],
  "business & finance": ["personal-finance"],
  finance: ["personal-finance"],
  business: ["business"],
  technology: ["tech"],
  tech: ["tech"],
  sports: ["sports"],
  "parenting and family": ["parenting"],
  parenting: ["parenting"],
  education: ["education"],
  "true crime": ["true-crime"],
  comedy: ["comedy"],
  "self improvement": ["lifestyle"],
  "food and cooking": ["food"],
  food: ["food"],
  travel: ["outdoors"],
  gaming: ["gaming"],
  "fashion and beauty": ["beauty"],
  beauty: ["beauty"],
  science: ["education"],
  fitness: ["fitness"],
  nutrition: ["nutrition"],
  lifestyle: ["lifestyle"],
};

function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function phraseHits(text: string, phrase: string): boolean {
  const normPhrase = normalize(phrase);
  if (!normPhrase || !text) return false;
  const escaped = normPhrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^| )${escaped}(?: |$)`).test(text);
}

export function orderCategories(ids: Iterable<string>): LibraryCategory[] {
  const found = new Set<string>();
  for (const id of ids) {
    if (CATEGORY_SET.has(id)) found.add(id);
  }
  return LIBRARY_CATEGORY_ORDER.filter((id): id is LibraryCategory => found.has(id));
}

/** Categories named by one blob of ring, interest, or source text. */
export function matchCategoryText(text: string): LibraryCategory[] {
  const norm = normalize(text);
  if (!norm) return [];
  const found = new Set<string>();
  for (const set of YOUTUBE_CATEGORY_SETS) {
    if (set.phrases.some((phrase) => phraseHits(norm, phrase))) found.add(set.id);
  }
  for (const syn of SYNONYMS) {
    if (phraseHits(norm, syn.phrase)) found.add(syn.category);
  }
  for (const [tag, cats] of Object.entries(TAG_TO_CATEGORIES)) {
    if (phraseHits(norm, tag)) {
      for (const cat of cats) found.add(cat);
    }
  }
  return orderCategories(found);
}

function matchTexts(texts: string[]): LibraryCategory[] {
  const found = new Set<string>();
  for (const text of texts) {
    for (const cat of matchCategoryText(text)) found.add(cat);
  }
  return orderCategories(found);
}

function fallbackCategory(category: string): LibraryCategory[] {
  const key = normalize(category);
  if (!key) return [];
  const mapped = TOP_LEVEL_FALLBACK[key];
  if (mapped) return orderCategories(mapped);
  return matchCategoryText(category);
}

/**
 * Primary categories the ring text, its interests, and the brief category
 * hit. Adjacent categories come from the fixed table. A ring that hits
 * nothing uses the brief's top-level category.
 */
export function mapRingToCategories(input: RingCategoryInput): RingCategoryMatch {
  const terms = input.terms ?? [];
  const interests = input.interests ?? [];
  const fromRing = matchTexts([...terms, ...interests]);
  const fromCategory = matchTexts([input.category ?? ""]);
  let primary = fromRing.length > 0 ? orderCategories([...fromRing, ...fromCategory]) : fromCategory;
  if (primary.length === 0) primary = fallbackCategory(input.category ?? "");
  const adjacent = new Set<string>();
  for (const cat of primary) {
    for (const next of ADJACENT[cat] ?? []) {
      if (!primary.includes(next as LibraryCategory)) adjacent.add(next);
    }
  }
  return { primary, adjacent: orderCategories(adjacent) };
}

export interface ChannelCategorySource {
  niche_tags?: string[] | null;
  source_query?: string | null;
}

/**
 * Library categories a stored channel belongs to. Niche tags use the
 * taxonomy map. The source query is the pull phrase (or a discovery
 * query) and is matched like ring text.
 */
export function channelLibraryCategories(row: ChannelCategorySource): LibraryCategory[] {
  const found = new Set<string>();
  for (const tag of row.niche_tags ?? []) {
    const cats = TAG_TO_CATEGORIES[tag.trim()];
    if (!cats) continue;
    for (const cat of cats) found.add(cat);
  }
  for (const cat of matchCategoryText(row.source_query ?? "")) found.add(cat);
  return orderCategories(found);
}
