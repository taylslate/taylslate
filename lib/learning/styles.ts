// Closed vocabulary for read style and placement on the learning review.
// Unknown strings are dropped. They are not turned into a new bucket.

export const READER_KEYS = ["host_read", "producer_read", "guest_read"] as const;
export const PLACEMENT_KEYS = ["pre-roll", "mid-roll", "post-roll"] as const;

export type ReaderKey = (typeof READER_KEYS)[number];
export type PlacementKey = (typeof PLACEMENT_KEYS)[number];

const READER_SET = new Set<string>(READER_KEYS);
const PLACEMENT_SET = new Set<string>(PLACEMENT_KEYS);

export const STYLE_KEYS = new Set<string>([...READER_KEYS, ...PLACEMENT_KEYS]);

export function styleOptions(): { key: string; label: string }[] {
  return [...STYLE_KEYS].map((key) => ({ key, label: styleLabel(key) }));
}

const READER_LABEL: Record<ReaderKey, string> = {
  host_read: "Host-read",
  producer_read: "Producer-read",
  guest_read: "Guest-read",
};

const PLACEMENT_LABEL: Record<PlacementKey, string> = {
  "pre-roll": "Pre-roll",
  "mid-roll": "Mid-roll",
  "post-roll": "Post-roll",
};

export function normalizeReader(raw: string | null | undefined): ReaderKey | null {
  if (!raw) return null;
  const key = raw.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (key === "produced" || key === "producer_read") return "producer_read";
  if (READER_SET.has(key)) return key as ReaderKey;
  return null;
}

export function normalizePlacement(
  raw: string | null | undefined
): PlacementKey | null {
  if (!raw) return null;
  const key = raw.trim().toLowerCase().replace(/[\s_]+/g, "-");
  if (key === "preroll") return "pre-roll";
  if (key === "midroll") return "mid-roll";
  if (key === "postroll") return "post-roll";
  if (PLACEMENT_SET.has(key)) return key as PlacementKey;
  return null;
}

export function styleLabel(key: string): string {
  if (key in READER_LABEL) return READER_LABEL[key as ReaderKey];
  if (key in PLACEMENT_LABEL) return PLACEMENT_LABEL[key as PlacementKey];
  return key;
}
