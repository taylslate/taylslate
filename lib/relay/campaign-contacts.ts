// Drop show contact keys before a campaign JSON write.
// The key is removed. It is not set to null or an empty string.
// Pure. Safe to call twice.

const LEGACY_KEYS = [
  "recommendations",
  "youtube_recommendations",
  "expansion_opportunities",
] as const;

type CampaignContactFields = {
  scored_shows?: unknown;
  recommendations?: unknown;
  youtube_recommendations?: unknown;
  expansion_opportunities?: unknown;
};

export function stripCampaignContactKeys<T extends CampaignContactFields>(fields: T): T {
  const out = { ...fields };
  if ("scored_shows" in fields) {
    out.scored_shows = stripKey(fields.scored_shows, "contactEmail");
  }
  for (const key of LEGACY_KEYS) {
    if (key in fields) out[key] = stripKey(fields[key], "contact_email");
  }
  return out;
}

function stripKey(value: unknown, key: string): unknown {
  if (!Array.isArray(value)) return value;
  return value.map((element) => {
    if (!element || typeof element !== "object" || Array.isArray(element)) return element;
    if (!Object.prototype.hasOwnProperty.call(element, key)) return element;
    const copy = { ...(element as Record<string, unknown>) };
    delete copy[key];
    return copy;
  });
}
