// Enumerate Podscan search hits. query is required, so every call
// sends a OR b OR ... OR z. Slices stay under the 10,000 result cap
// by audience band, then by category. A category that is still at
// the cap is logged and paged up to the cap. The run keeps going.

import type { PodscanPodcast, PodscanSearchResponse } from "@/lib/podscan/types";

export const SEARCH_QUERY = "abcdefghijklmnopqrstuvwxyz".split("").join(" OR ");
export const RESULT_CAP = 10_000;
export const PAGE_SIZE = 50;
export const LOWEST_FLOOR = 1000;

const AUDIENCE_EDGES = [0, 1000, 2500, 5000, 10_000, 25_000, 50_000, 100_000, 250_000, 500_000, 1_000_000];

export type PassName = "sponsored" | "unsponsored";

export interface CatalogCandidate {
  podcastId: string;
  name: string;
  itunesId: string | null;
  rssUrl: string | null;
  hasSponsors: boolean | null;
  audienceSize: number | null;
  podscanEmail: string | null;
  language: string | null;
  region: string | null;
  categories: string[];
  lastPostedAt: string | null;
  episodeCount: number | null;
  listenerEngagement: unknown | null;
  pass: PassName;
}

export interface Slice {
  pass: PassName;
  hasSponsors: boolean;
  minAudience: number | null;
  maxAudience: number | null;
  categoryId: string | null;
  audienceSplit: boolean;
}

export interface CappedSlice {
  pass: PassName;
  minAudience: number | null;
  maxAudience: number | null;
  categoryId: string | null;
  total: number;
  sampled: boolean;
}

export interface SearchState {
  started: boolean;
  complete: boolean;
  queue: Slice[];
  rows: CatalogCandidate[];
  passCounts: Record<PassName, number>;
  cappedSlices: CappedSlice[];
}

export function emptySearchState(): SearchState {
  return {
    started: false,
    complete: false,
    queue: [],
    rows: [],
    passCounts: { sponsored: 0, unsponsored: 0 },
    cappedSlices: [],
  };
}

export function activeSince(now: Date, activeDays: number): string {
  return new Date(now.getTime() - activeDays * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export function audienceBands(
  min: number | null,
  max: number | null
): Array<{ min: number; max: number | null }> {
  const bands: Array<{ min: number; max: number | null }> = [];
  for (let i = 0; i < AUDIENCE_EDGES.length; i += 1) {
    const lo = AUDIENCE_EDGES[i];
    const hi = i + 1 < AUDIENCE_EDGES.length ? AUDIENCE_EDGES[i + 1] - 1 : null;
    if (min != null && hi != null && hi < min) continue;
    if (max != null && lo > max) continue;
    const bandMin = min != null ? Math.max(lo, min) : lo;
    let bandMax = hi;
    if (max != null) bandMax = bandMax == null ? max : Math.min(bandMax, max);
    if (bandMax != null && bandMin > bandMax) continue;
    bands.push({ min: bandMin, max: bandMax });
  }
  return bands;
}

export function searchParams(
  slice: Slice,
  page: number,
  opts: { language: string; region: string | null; since: string }
): Record<string, string | number | boolean> {
  const params: Record<string, string | number | boolean> = {
    query: SEARCH_QUERY,
    per_page: PAGE_SIZE,
    page,
    order_by: "audience_size",
    order_dir: "desc",
    language: opts.language,
    has_sponsors: slice.hasSponsors,
    min_last_episode_posted_at: opts.since,
  };
  if (opts.region) params.region = opts.region;
  if (slice.minAudience != null) params.min_audience_size = slice.minAudience;
  if (slice.maxAudience != null) params.max_audience_size = slice.maxAudience;
  if (slice.categoryId) params.category_ids = slice.categoryId;
  return params;
}

export function categoryIdsFrom(body: unknown): string[] {
  const list = Array.isArray(body)
    ? body
    : isRecord(body) && Array.isArray(body.categories)
      ? body.categories
      : isRecord(body) && Array.isArray(body.data)
        ? body.data
        : [];
  const ids: string[] = [];
  for (const item of list) {
    if (typeof item === "string" && item) ids.push(item);
    else if (isRecord(item) && typeof item.category_id === "string" && item.category_id) {
      ids.push(item.category_id);
    } else if (isRecord(item) && typeof item.id === "string" && item.id) ids.push(item.id);
  }
  return [...new Set(ids)];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function toCandidate(podcast: PodscanPodcast, pass: PassName): CatalogCandidate | null {
  if (!podcast.podcast_id || podcast.is_duplicate) return null;
  if (!/^[A-Za-z0-9_-]+$/.test(podcast.podcast_id)) return null;
  const categories: string[] = [];
  for (const category of podcast.podcast_categories ?? []) {
    if (typeof category === "string" && category) categories.push(category);
    else if (typeof category === "object" && category) {
      const name = category.category_name || category.category_id;
      if (name) categories.push(name);
    }
  }
  const email = podcast.reach?.email?.trim() || null;
  return {
    podcastId: podcast.podcast_id,
    name: podcast.podcast_name?.trim() || podcast.podcast_id,
    itunesId: podcast.podcast_itunes_id ? String(podcast.podcast_itunes_id) : null,
    rssUrl: podcast.rss_url ?? null,
    hasSponsors: podcast.podcast_has_sponsors ?? null,
    audienceSize: normalizeAudience(podcast.reach?.audience_size),
    podscanEmail: email,
    language: podcast.language ?? null,
    region: podcast.region ?? null,
    categories,
    lastPostedAt: podcast.last_posted_at ?? null,
    episodeCount:
      typeof podcast.episode_count === "number" && Number.isFinite(podcast.episode_count)
        ? Math.trunc(podcast.episode_count)
        : null,
    listenerEngagement:
      podcast.listener_engagement != null && typeof podcast.listener_engagement === "object"
        ? podcast.listener_engagement
        : null,
    pass,
  };
}

function normalizeAudience(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  const rounded = Math.round(value);
  if (rounded > 2_147_483_647) return null;
  return rounded;
}

function rootSlice(pass: PassName): Slice {
  if (pass === "sponsored") {
    return {
      pass,
      hasSponsors: true,
      minAudience: null,
      maxAudience: null,
      categoryId: null,
      audienceSplit: false,
    };
  }
  return {
    pass,
    hasSponsors: false,
    minAudience: LOWEST_FLOOR,
    maxAudience: null,
    categoryId: null,
    audienceSplit: false,
  };
}

function describe(slice: Slice, total: number, sampled: boolean): CappedSlice {
  return {
    pass: slice.pass,
    minAudience: slice.minAudience,
    maxAudience: slice.maxAudience,
    categoryId: slice.categoryId,
    total,
    sampled,
  };
}

function absorb(
  state: SearchState,
  seen: Set<string>,
  podcasts: PodscanPodcast[],
  pass: PassName,
  sample: number | null
): void {
  for (const podcast of podcasts) {
    if (sample != null && state.passCounts[pass] >= sample) return;
    const row = toCandidate(podcast, pass);
    if (!row || seen.has(row.podcastId)) continue;
    seen.add(row.podcastId);
    state.rows.push(row);
    state.passCounts[pass] += 1;
  }
}

export async function collectCandidates(input: {
  search: (params: Record<string, string | number | boolean>) => Promise<PodscanSearchResponse>;
  categories: () => Promise<string[]>;
  language: string;
  region: string | null;
  since: string;
  sample: number | null;
  resume?: SearchState | null;
  onProgress?: (state: SearchState) => void;
}): Promise<SearchState> {
  const state = input.resume ?? emptySearchState();
  if (state.complete) return state;
  const seen = new Set(state.rows.map((row) => row.podcastId));
  if (!state.started) {
    state.started = true;
    state.queue = [rootSlice("sponsored"), rootSlice("unsponsored")];
  }
  const opts = { language: input.language, region: input.region, since: input.since };
  let categories: string[] | null = null;

  while (state.queue.length > 0) {
    const slice = state.queue[0];
    if (!slice) break;
    if (input.sample != null && state.passCounts[slice.pass] >= input.sample) {
      state.queue.shift();
      continue;
    }
    const first = await input.search(searchParams(slice, 1, opts));
    const total = first.pagination?.total ?? first.podcasts.length;

    if (input.sample != null) {
      if (total >= RESULT_CAP) state.cappedSlices.push(describe(slice, total, true));
      absorb(state, seen, first.podcasts, slice.pass, input.sample);
      await pageRest(state, seen, slice, total, first.podcasts.length, input, opts);
      state.queue.shift();
      input.onProgress?.(state);
      continue;
    }

    if (total >= RESULT_CAP && !slice.categoryId) {
      if (!slice.audienceSplit) {
        const bands = audienceBands(slice.minAudience, slice.maxAudience);
        if (bands.length > 1) {
          state.queue.shift();
          for (const band of bands) {
            state.queue.push({
              ...slice,
              minAudience: band.min,
              maxAudience: band.max,
              audienceSplit: true,
            });
          }
          input.onProgress?.(state);
          continue;
        }
      }
      if (categories == null) categories = await input.categories();
      if (categories.length > 0) {
        state.queue.shift();
        for (const categoryId of categories) {
          state.queue.push({ ...slice, categoryId, audienceSplit: true });
        }
        input.onProgress?.(state);
        continue;
      }
    }

    if (total >= RESULT_CAP) state.cappedSlices.push(describe(slice, total, false));
    absorb(state, seen, first.podcasts, slice.pass, null);
    await pageRest(state, seen, slice, total, first.podcasts.length, input, opts);
    state.queue.shift();
    input.onProgress?.(state);
  }

  state.complete = true;
  input.onProgress?.(state);
  return state;
}

async function pageRest(
  state: SearchState,
  seen: Set<string>,
  slice: Slice,
  total: number,
  firstCount: number,
  input: {
    search: (params: Record<string, string | number | boolean>) => Promise<PodscanSearchResponse>;
    sample: number | null;
  },
  opts: { language: string; region: string | null; since: string }
): Promise<void> {
  if (input.sample != null && state.passCounts[slice.pass] >= input.sample) return;
  const cappedTotal = Math.min(total, RESULT_CAP);
  const pages = Math.min(200, Math.max(1, Math.ceil(cappedTotal / PAGE_SIZE)));
  if (firstCount < PAGE_SIZE) return;
  for (let page = 2; page <= pages; page += 1) {
    if (input.sample != null && state.passCounts[slice.pass] >= input.sample) return;
    const res = await input.search(searchParams(slice, page, opts));
    if (res.podcasts.length === 0) return;
    absorb(state, seen, res.podcasts, slice.pass, input.sample);
    if (res.podcasts.length < PAGE_SIZE) return;
  }
}
