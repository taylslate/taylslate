// Made-for-kids gate for the YouTube library.
// status.madeForKids true fails closed. A null flag (row not refreshed
// yet, or migration 095 not applied) fails only on a narrow topic or
// niche phrase that already exists on the row. A false flag wins, so a
// channel YouTube has marked as not made for kids stays eligible even
// when a topic string also matches.

const KIDS_PHRASES = ["childrens music", "kids music", "nursery rhyme", "nursery rhymes"] as const;

function normalizeKidsText(value: string): string {
  let text = value.trim();
  if (!text) return "";
  try {
    text = decodeURIComponent(text.replace(/\+/g, " "));
  } catch {
    // Keep the raw text when it is not valid percent-encoding.
  }
  return text
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function hasKidsPhrase(value: string): boolean {
  const text = normalizeKidsText(value);
  if (!text) return false;
  return KIDS_PHRASES.some((phrase) => {
    const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(?:^| )${escaped}(?: |$)`).test(text);
  });
}

/**
 * True when the channel is made for kids.
 * `madeForKids` true always matches. False never falls through to topics.
 * Null and undefined use topic categories and niche tags only.
 */
export function channelIsMadeForKids(input: {
  madeForKids?: boolean | null;
  topicCategories?: readonly string[] | null;
  nicheTags?: readonly string[] | null;
}): boolean {
  if (input.madeForKids === true) return true;
  if (input.madeForKids === false) return false;
  const topics = input.topicCategories ?? [];
  const tags = input.nicheTags ?? [];
  return topics.some((value) => hasKidsPhrase(value)) || tags.some((value) => hasKidsPhrase(value));
}

export function libraryRowIsMadeForKids(row: {
  made_for_kids?: boolean | null;
  topic_categories?: readonly string[] | null;
  niche_tags?: readonly string[] | null;
}): boolean {
  return channelIsMadeForKids({
    madeForKids: row.made_for_kids,
    topicCategories: row.topic_categories,
    nicheTags: row.niche_tags,
  });
}
