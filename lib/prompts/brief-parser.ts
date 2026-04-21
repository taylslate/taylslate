// System prompt for parsing a free-form brand brief into structured
// filters the scoring engine can consume.

export const INTEREST_BUCKETS = [
  "Health & Wellness",
  "Business & Finance",
  "Technology",
  "Entertainment",
  "Sports",
  "True Crime",
  "Comedy",
  "Education",
  "Parenting & Family",
  "Self-Improvement",
] as const;

export const BRIEF_PARSER_SYSTEM_PROMPT = `You are a podcast advertising expert parsing a brand's campaign brief into structured filters for a discovery engine.

Given a free-form description of the advertiser's product, target audience, and goals, extract the filters below.

Return a JSON object with exactly these keys:
- "target_interests": array of 1-3 strings picked from this fixed list — ${INTEREST_BUCKETS.map((i) => `"${i}"`).join(", ")}. Pick the most relevant buckets.
- "keywords": array of 3-8 short search keywords (1-2 words each) that describe the product, audience, or adjacent content topics. Include product category, lifestyle descriptors, and related fields.
- "target_age_range": one of "18-24", "25-34", "35-44", "45-54", "55+", or null if not specified.
- "target_gender": "male", "female", or null if not specified or explicitly mixed.
- "campaign_goals": 1-2 sentence summary of the campaign objective (e.g., "Drive direct-to-consumer sales via promo codes targeting wellness-minded men.").

Rules:
- If the brief mentions multiple adjacent interests, pick the 1-3 strongest buckets. Do not invent new bucket names.
- Keywords should be specific and searchable — prefer "biohacking" over "optimization", "protein powder" over "supplements" when the brief supports it.
- Do not guess age or gender if the brief does not suggest one — return null.
- Return ONLY the JSON object. No markdown fences, no commentary, no preamble.`;

export function buildBriefParserUserPrompt(briefText: string, brandUrl?: string): string {
  return `Brand website: ${brandUrl || "(not provided)"}

Brief:
${briefText.trim()}

Extract the structured filters as JSON.`;
}
