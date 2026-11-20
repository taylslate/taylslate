// Apple iTunes Lookup for feed URLs. Ids only. Never a name match.
// Batch up to 50. If a multi-id call misses a feed that a single-id
// call returns, the rest of the run uses one id per call.

import { withAppleRetries, type HostLimiter } from "./rate-limit";

export const APPLE_LOOKUP = "https://itunes.apple.com/lookup";
export const APPLE_BATCH = 50;

export function isItunesId(value: string | null | undefined): value is string {
  return typeof value === "string" && /^[0-9]+$/.test(value);
}

interface AppleResult {
  collectionId?: number | string;
  feedUrl?: string;
  wrapperType?: string;
  kind?: string;
}

interface AppleBody {
  resultCount?: number;
  results?: AppleResult[];
}

export class AppleStatusError extends Error {
  readonly status: number;

  constructor(status: number) {
    super("apple");
    this.name = "AppleStatusError";
    this.status = status;
  }
}

export async function lookupAppleFeeds(
  itunesIds: readonly string[],
  deps: {
    fetchImpl?: typeof fetch;
    limiter: HostLimiter;
    sleepFn?: (ms: number) => Promise<void>;
    rng?: () => number;
  }
): Promise<{ feeds: Map<string, string | null>; batched: boolean }> {
  const ids = [...new Set(itunesIds.filter(isItunesId))];
  const feeds = new Map<string, string | null>();
  if (ids.length === 0) return { feeds, batched: true };

  const fetchImpl = deps.fetchImpl ?? fetch;
  const load = (batch: string[]) => fetchBatch(batch, fetchImpl, deps);

  if (ids.length === 1) {
    const found = await load(ids);
    copyFeeds(feeds, ids, found);
    return { feeds, batched: true };
  }

  const probe = ids.slice(0, Math.min(APPLE_BATCH, ids.length));
  const probed = await load(probe);
  const singles = await Promise.all([load([probe[0]]), load([probe[1]])]);
  const missed =
    feedOf(singles[0], probe[0]) !== feedOf(probed, probe[0]) ||
    feedOf(singles[1], probe[1]) !== feedOf(probed, probe[1]);

  if (missed) {
    for (const id of ids) {
      const one = id === probe[0] ? singles[0] : id === probe[1] ? singles[1] : await load([id]);
      copyFeeds(feeds, [id], one);
    }
    return { feeds, batched: false };
  }

  copyFeeds(feeds, probe, probed);
  let offset = probe.length;
  while (offset < ids.length) {
    const batch = ids.slice(offset, offset + APPLE_BATCH);
    const found = await load(batch);
    copyFeeds(feeds, batch, found);
    offset += batch.length;
  }
  return { feeds, batched: true };
}

function feedOf(found: Map<string, string | null>, id: string): string | null {
  return found.get(id) ?? null;
}

function copyFeeds(
  target: Map<string, string | null>,
  ids: string[],
  found: Map<string, string | null>
): void {
  for (const id of ids) target.set(id, found.get(id) ?? null);
}

async function fetchBatch(
  ids: string[],
  fetchImpl: typeof fetch,
  deps: {
    limiter: HostLimiter;
    sleepFn?: (ms: number) => Promise<void>;
    rng?: () => number;
  }
): Promise<Map<string, string | null>> {
  const url = `${APPLE_LOOKUP}?id=${ids.map(encodeURIComponent).join(",")}&entity=podcast`;
  const res = await withAppleRetries(
    async () => {
      const response = await fetchImpl(url, { headers: { Accept: "application/json" } });
      if (response.status === 403 || response.status === 429) throw new AppleStatusError(response.status);
      if (!response.ok) throw new AppleStatusError(response.status);
      return response;
    },
    { limiter: deps.limiter, sleepFn: deps.sleepFn, rng: deps.rng }
  );
  const body = (await res.json()) as AppleBody;
  const found = new Map<string, string | null>();
  for (const id of ids) found.set(id, null);
  for (const result of body.results ?? []) {
    if (result.collectionId == null || !result.feedUrl) continue;
    const id = String(result.collectionId);
    if (!found.has(id)) continue;
    found.set(id, result.feedUrl);
  }
  return found;
}
