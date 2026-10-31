// Niche tags stay inside the genre and interest names discovery already
// uses (category-mapping.ts). Step A maps topic labels and keywords.
// Step B asks the existing LLM, in batches, and drops anything outside
// that list. LLM_MAX_RETRIES stays 0: the call passes maxRetries 0.

import { redactSecretParams } from "@/lib/discovery/redact-secrets";
import { callLLMWithFallback } from "@/lib/llm/client";
import { mapLimit, withTimeout } from "./pull";

export const NICHE_TAGS_VERSION = 1;
export const TAG_BATCH_SIZE = 50;
export const TAG_DAILY_CAP = 400;
/** One tag call may not run longer than this, and never longer than the time still left. */
const TAG_CALL_MS = 40_000;
/** Do not start a call that cannot finish. */
const TAG_MIN_REMAINING_MS = 15_000;
const TAG_SAVE_CONCURRENCY = 4;

/** Selectable interests plus the removed buckets discovery still searches. */
export const NICHE_TAXONOMY = [
  "Health & Wellness",
  "Technology",
  "Business & Finance",
  "Entertainment",
  "Sports",
  "Parenting & Family",
  "Education",
  "True Crime",
  "Comedy",
  "Self-Improvement",
  "Food & Cooking",
  "Travel",
  "Gaming",
  "Fashion & Beauty",
  "Politics & News",
  "Science",
  "Music",
] as const;

export type NicheTag = (typeof NICHE_TAXONOMY)[number];

const TAXONOMY_SET = new Set<string>(NICHE_TAXONOMY);

/** Longer phrases first so "mental health" wins as one health tag, not a partial. */
const ALIASES: { phrase: string; tag: NicheTag }[] = [
  { phrase: "business and finance", tag: "Business & Finance" },
  { phrase: "parenting and family", tag: "Parenting & Family" },
  { phrase: "food and cooking", tag: "Food & Cooking" },
  { phrase: "fashion and beauty", tag: "Fashion & Beauty" },
  { phrase: "politics and news", tag: "Politics & News" },
  { phrase: "self improvement", tag: "Self-Improvement" },
  { phrase: "health and wellness", tag: "Health & Wellness" },
  { phrase: "personal finance", tag: "Business & Finance" },
  { phrase: "mental health", tag: "Health & Wellness" },
  { phrase: "womens health", tag: "Health & Wellness" },
  { phrase: "true crime", tag: "True Crime" },
  { phrase: "video games", tag: "Gaming" },
  { phrase: "lets play", tag: "Gaming" },
  { phrase: "stand up", tag: "Comedy" },
  { phrase: "standup", tag: "Comedy" },
  { phrase: "physical fitness", tag: "Health & Wellness" },
  { phrase: "entrepreneurship", tag: "Business & Finance" },
  { phrase: "investing", tag: "Business & Finance" },
  { phrase: "investment", tag: "Business & Finance" },
  { phrase: "stock market", tag: "Business & Finance" },
  { phrase: "index funds", tag: "Business & Finance" },
  { phrase: "budgeting", tag: "Business & Finance" },
  { phrase: "finance", tag: "Business & Finance" },
  { phrase: "business", tag: "Business & Finance" },
  { phrase: "marketing", tag: "Business & Finance" },
  { phrase: "fitness", tag: "Health & Wellness" },
  { phrase: "workout", tag: "Health & Wellness" },
  { phrase: "wellness", tag: "Health & Wellness" },
  { phrase: "nutrition", tag: "Health & Wellness" },
  { phrase: "dietitian", tag: "Health & Wellness" },
  { phrase: "biohacking", tag: "Health & Wellness" },
  { phrase: "longevity", tag: "Health & Wellness" },
  { phrase: "supplements", tag: "Health & Wellness" },
  { phrase: "medicine", tag: "Health & Wellness" },
  { phrase: "recovery", tag: "Health & Wellness" },
  { phrase: "health", tag: "Health & Wellness" },
  { phrase: "yoga", tag: "Health & Wellness" },
  { phrase: "running", tag: "Health & Wellness" },
  { phrase: "technology", tag: "Technology" },
  { phrase: "software", tag: "Technology" },
  { phrase: "gadgets", tag: "Technology" },
  { phrase: "gadget", tag: "Technology" },
  { phrase: "tech", tag: "Technology" },
  { phrase: "entertainment", tag: "Entertainment" },
  { phrase: "pop culture", tag: "Entertainment" },
  { phrase: "celebrity", tag: "Entertainment" },
  { phrase: "movies", tag: "Entertainment" },
  { phrase: "sports", tag: "Sports" },
  { phrase: "athletics", tag: "Sports" },
  { phrase: "athlete", tag: "Sports" },
  { phrase: "football", tag: "Sports" },
  { phrase: "basketball", tag: "Sports" },
  { phrase: "parenting", tag: "Parenting & Family" },
  { phrase: "motherhood", tag: "Parenting & Family" },
  { phrase: "fatherhood", tag: "Parenting & Family" },
  { phrase: "family", tag: "Parenting & Family" },
  { phrase: "education", tag: "Education" },
  { phrase: "learning", tag: "Education" },
  { phrase: "teaching", tag: "Education" },
  { phrase: "tutorial", tag: "Education" },
  { phrase: "history", tag: "Education" },
  { phrase: "forensics", tag: "True Crime" },
  { phrase: "forensic", tag: "True Crime" },
  { phrase: "investigation", tag: "True Crime" },
  { phrase: "mystery", tag: "True Crime" },
  { phrase: "crime", tag: "True Crime" },
  { phrase: "comedy", tag: "Comedy" },
  { phrase: "humor", tag: "Comedy" },
  { phrase: "funny", tag: "Comedy" },
  { phrase: "motivation", tag: "Self-Improvement" },
  { phrase: "productivity", tag: "Self-Improvement" },
  { phrase: "mindset", tag: "Self-Improvement" },
  { phrase: "habits", tag: "Self-Improvement" },
  { phrase: "cooking", tag: "Food & Cooking" },
  { phrase: "recipes", tag: "Food & Cooking" },
  { phrase: "recipe", tag: "Food & Cooking" },
  { phrase: "baking", tag: "Food & Cooking" },
  { phrase: "food", tag: "Food & Cooking" },
  { phrase: "chef", tag: "Food & Cooking" },
  { phrase: "meal prep", tag: "Food & Cooking" },
  { phrase: "backpacking", tag: "Travel" },
  { phrase: "adventure", tag: "Travel" },
  { phrase: "destinations", tag: "Travel" },
  { phrase: "camping", tag: "Travel" },
  { phrase: "hiking", tag: "Travel" },
  { phrase: "fishing", tag: "Travel" },
  { phrase: "outdoor", tag: "Travel" },
  { phrase: "travel", tag: "Travel" },
  { phrase: "esports", tag: "Gaming" },
  { phrase: "gaming", tag: "Gaming" },
  { phrase: "skincare", tag: "Fashion & Beauty" },
  { phrase: "makeup", tag: "Fashion & Beauty" },
  { phrase: "fashion", tag: "Fashion & Beauty" },
  { phrase: "beauty", tag: "Fashion & Beauty" },
  { phrase: "hair", tag: "Fashion & Beauty" },
  { phrase: "politics", tag: "Politics & News" },
  { phrase: "news", tag: "Politics & News" },
  { phrase: "neuroscience", tag: "Science" },
  { phrase: "biology", tag: "Science" },
  { phrase: "physics", tag: "Science" },
  { phrase: "science", tag: "Science" },
  { phrase: "space", tag: "Science" },
  { phrase: "musician", tag: "Music" },
  { phrase: "music", tag: "Music" },
  { phrase: "songs", tag: "Music" },
];

function normalizeTerm(value: string): string {
  return value
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function phraseHits(text: string, phrase: string): boolean {
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^| )${escaped}(?: |$)`).test(text);
}

/** Step A. Topic labels and channel keywords, taxonomy names only. */
export function deterministicNicheTags(input: {
  topicCategories?: string[] | null;
  keywords?: string[] | null;
}): NicheTag[] {
  const texts = [...(input.topicCategories ?? []), ...(input.keywords ?? [])]
    .map((term) => normalizeTerm(term))
    .filter(Boolean);
  const found = new Set<NicheTag>();
  for (const text of texts) {
    for (const alias of ALIASES) {
      if (phraseHits(text, alias.phrase)) found.add(alias.tag);
    }
  }
  return NICHE_TAXONOMY.filter((tag) => found.has(tag));
}

/** Drop unknown names. Keep taxonomy order. */
export function filterNicheTags(tags: string[]): NicheTag[] {
  const found = new Set<string>();
  for (const tag of tags) {
    const trimmed = tag.trim();
    if (TAXONOMY_SET.has(trimmed)) found.add(trimmed);
  }
  return NICHE_TAXONOMY.filter((tag) => found.has(tag));
}

export interface TagChannelInput {
  channel_id: string;
  title: string | null;
  description: string | null;
  topic_categories: string[];
  keywords: string[];
}

const TAG_SYSTEM = [
  "You tag YouTube channels for a podcast and YouTube advertising catalog.",
  "Return JSON only, no markdown.",
  'Shape: {"channels":[{"channel_id":"...","tags":["..."]}]}',
  "tags must be chosen only from this list:",
  NICHE_TAXONOMY.join(", "),
  "Use one to four tags. If none fit, return an empty tags array.",
  "Do not invent tag names.",
].join(" ");

function slimChannel(channel: TagChannelInput) {
  return {
    channel_id: channel.channel_id,
    title: (channel.title ?? "").slice(0, 200),
    description: (channel.description ?? "").slice(0, 400),
    topics: channel.topic_categories.slice(0, 12),
    keywords: channel.keywords.slice(0, 20),
  };
}

export function parseTagResponse(text: string, allowedIds: Set<string>): Map<string, NicheTag[]> {
  const out = new Map<string, NicheTag[]>();
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return out;
  }
  const channels = (parsed as { channels?: unknown }).channels;
  if (!Array.isArray(channels)) return out;
  for (const row of channels) {
    if (!row || typeof row !== "object") continue;
    const id = (row as { channel_id?: unknown }).channel_id;
    const tags = (row as { tags?: unknown }).tags;
    if (typeof id !== "string" || !allowedIds.has(id) || !Array.isArray(tags)) continue;
    const names = tags.filter((tag): tag is string => typeof tag === "string");
    out.set(id, filterNicheTags(names));
  }
  return out;
}

export async function defaultTagComplete(channels: TagChannelInput[]): Promise<string> {
  const message = await callLLMWithFallback({
    system: TAG_SYSTEM,
    userContent: JSON.stringify({ channels: channels.map(slimChannel) }),
    maxTokens: 4096,
    maxRetries: 0,
  });
  const block = message.content.find((item) => item.type === "text");
  return block && block.type === "text" ? block.text : "";
}

export interface TagBatchResult {
  channels: number;
  calls: number;
  stopped: "cap" | "empty" | "llm_error" | "time" | null;
}

/**
 * Step B. Untagged or old-version rows, TAG_BATCH_SIZE per call, stop at
 * the daily cap. A failed call does not mark those rows tagged.
 */
export async function runNicheTagBatches(input: {
  load: (limit: number) => Promise<TagChannelInput[]>;
  save: (channelId: string, tags: string[]) => Promise<void>;
  complete?: (channels: TagChannelInput[]) => Promise<string>;
  cap?: number;
  batchSize?: number;
  log?: (line: string) => void;
  /** Stop before a call that would run past this epoch ms. Omit for no clock. */
  deadlineMs?: number;
  clock?: () => number;
}): Promise<TagBatchResult> {
  const cap = input.cap ?? TAG_DAILY_CAP;
  const batchSize = input.batchSize ?? TAG_BATCH_SIZE;
  const complete = input.complete ?? defaultTagComplete;
  const log = input.log ?? ((line: string) => console.log(line));
  const clock = input.clock ?? Date.now;
  const remaining = () => (input.deadlineMs == null ? Number.POSITIVE_INFINITY : input.deadlineMs - clock());
  let tagged = 0;
  let calls = 0;

  while (tagged < cap) {
    if (remaining() < TAG_MIN_REMAINING_MS) {
      return { channels: tagged, calls, stopped: "time" };
    }
    const take = Math.min(batchSize, cap - tagged);
    const rows = await input.load(take);
    if (rows.length === 0) {
      return { channels: tagged, calls, stopped: tagged > 0 ? null : "empty" };
    }
    const left = remaining();
    if (left < TAG_MIN_REMAINING_MS) {
      return { channels: tagged, calls, stopped: "time" };
    }
    calls++;
    let parsed: Map<string, NicheTag[]>;
    try {
      const budgetMs = Math.min(left, TAG_CALL_MS);
      const text =
        input.deadlineMs == null ? await complete(rows) : await withTimeout(complete(rows), budgetMs);
      parsed = parseTagResponse(text, new Set(rows.map((row) => row.channel_id)));
    } catch (err) {
      const message = err instanceof Error ? err.message : "llm error";
      log(`[youtube-library] tag call failed: ${redactSecretParams(message).slice(0, 200)}`);
      const timedOut = /timed out/i.test(message);
      return { channels: tagged, calls, stopped: timedOut ? "time" : "llm_error" };
    }
    await mapLimit(rows, TAG_SAVE_CONCURRENCY, async (row) => {
      const tags = parsed.get(row.channel_id) ?? [];
      await input.save(row.channel_id, tags);
    });
    tagged += rows.length;
    log(`[youtube-library] tag call=${calls} channels=${rows.length}`);
    if (rows.length < take) break;
  }

  return { channels: tagged, calls, stopped: tagged >= cap ? "cap" : null };
}
