// Demographics plus listener data. A 404 is empty data. The detail
// call is skipped when the search hit already has listener_engagement.

export function isNotFound(err: unknown): boolean {
  return !!err && typeof err === "object" && (err as { status?: unknown }).status === 404;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function listenerFromDetail(body: unknown): unknown | null {
  if (!isRecord(body)) return null;
  if (isRecord(body.listener_engagement)) return body.listener_engagement;
  if (isRecord(body.podcast) && isRecord(body.podcast.listener_engagement)) {
    return body.podcast.listener_engagement;
  }
  return null;
}

export function hasListener(value: unknown): boolean {
  return isRecord(value);
}

export async function enrichShow(
  podcastId: string,
  listenerOnSearch: unknown | null,
  get: (path: string) => Promise<unknown>
): Promise<{ demographics: unknown; listener: unknown }> {
  let demographics: unknown = null;
  try {
    demographics = await get(`/podcasts/${podcastId}/demographics`);
  } catch (err) {
    if (!isNotFound(err)) throw err;
  }
  if (hasListener(listenerOnSearch)) {
    return { demographics, listener: listenerOnSearch };
  }
  let listener: unknown = null;
  try {
    listener = listenerFromDetail(await get(`/podcasts/${podcastId}`));
  } catch (err) {
    if (!isNotFound(err)) throw err;
  }
  return { demographics, listener };
}

export interface EnrichGate {
  minAudience: number | null;
  minPanelListeners: number | null;
}

export function panelListenersOf(listener: unknown): number | null {
  if (!isRecord(listener)) return null;
  const value = listener.total_listeners;
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === "string" && /^[0-9]+$/.test(value)) return Number(value);
  return null;
}

// Kept, and (audience >= N or panel listeners >= M). A flag that is
// unset does not qualify a show by itself. Neither flag means every
// kept show qualifies.
export function qualifiesForEnrich(
  show: { kept: boolean; audienceSize: number | null; listenerEngagement: unknown },
  gate: EnrichGate
): boolean {
  if (!show.kept) return false;
  if (gate.minAudience == null && gate.minPanelListeners == null) return true;
  const audienceOk =
    gate.minAudience != null && show.audienceSize != null && show.audienceSize >= gate.minAudience;
  const panel = panelListenersOf(show.listenerEngagement);
  const panelOk = gate.minPanelListeners != null && panel != null && panel >= gate.minPanelListeners;
  return audienceOk || panelOk;
}

export function analysisFetched(entry: object | null | undefined): boolean {
  return !!entry && Object.prototype.hasOwnProperty.call(entry, "sponsorHistory");
}

export function enrichCallsRemaining(
  listenerEngagement: unknown,
  entry: { demographics?: unknown; listener?: unknown; sponsorHistory?: unknown } | undefined
): number {
  if (analysisFetched(entry)) return 0;
  let calls = 0;
  if (!entry) {
    calls += 1;
    if (!hasListener(listenerEngagement)) calls += 1;
  }
  calls += 1;
  return calls;
}

export async function fetchSponsorHistory(
  podcastId: string,
  get: (path: string) => Promise<unknown>
): Promise<unknown> {
  try {
    return sponsorHistoryFrom(await get(`/podcasts/${podcastId}/analysis`));
  } catch (err) {
    if (!isNotFound(err)) throw err;
    return null;
  }
}

export function sponsorHistoryFrom(body: unknown): {
  sponsors: Array<{ name: string; episode_count: number | null }>;
  episode_counts: Record<string, number>;
} | null {
  if (!isRecord(body)) return null;
  const sponsors: Array<{ name: string; episode_count: number | null }> = [];
  const list = Array.isArray(body.sponsors) ? body.sponsors : [];
  for (const item of list) {
    if (!isRecord(item) || typeof item.name !== "string") continue;
    const name = item.name.trim();
    if (!name) continue;
    const count = item.episode_count;
    sponsors.push({
      name,
      episode_count: typeof count === "number" && Number.isFinite(count) ? Math.trunc(count) : null,
    });
  }
  const episode_counts: Record<string, number> = {};
  for (const [key, value] of Object.entries(body)) {
    if (!/episode/i.test(key)) continue;
    if (typeof value === "number" && Number.isFinite(value)) episode_counts[key] = Math.trunc(value);
  }
  return { sponsors, episode_counts };
}

// One podcast object, top level or under podcast. Search hits and
// GET /podcasts/{id} use the same object, which carries both fields.
export function scoringFromPodcastBody(body: unknown): { reachScore: number | null; brandSafety: unknown | null } {
  const nested = isRecord(body) && isRecord(body.podcast) ? body.podcast : null;
  const source =
    [body, nested].find(
      (row) => isRecord(row) && ("podcast_reach_score" in row || "brand_safety" in row)
    ) ?? (isRecord(body) ? body : null);
  if (!isRecord(source)) return { reachScore: null, brandSafety: null };
  return {
    reachScore: scoreNumber(source.podcast_reach_score),
    brandSafety: safetyObject(source.brand_safety),
  };
}

function scoreNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && /^-?[0-9]+(\.[0-9]+)?$/.test(value)) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function safetyObject(value: unknown): unknown | null {
  if (!value || typeof value !== "object") return null;
  try {
    return JSON.parse(JSON.stringify(value)) as unknown;
  } catch {
    return null;
  }
}
