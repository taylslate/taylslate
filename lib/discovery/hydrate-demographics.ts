// ============================================================
// PRE-SCORING DEMOGRAPHICS HYDRATION (audience-fit live)
//
// Conviction scoring runs on IN-MEMORY candidates built from fresh Podscan
// search responses, BEFORE persistence — demographics sitting on shows rows
// never reach the scorer on their own. This step fills candidate.demographics
// in place, right before scoring:
//
//   1. DB-first: one batched slug lookup (the createShow dedup key) copies
//      stored demographics + podscan_id onto matching candidates — zero API
//      spend. This is how backfilled shows reach the scorer.
//   2. Podscan fetch (GET /podcasts/{id}/demographics, Premium+) for podcast
//      candidates that have a podscan_id and still-empty demographics.
//
// Fail-soft like tierPortfolio: collects its own error notes, never throws.
// Any candidate left unhydrated scores audience fit exactly as today
// (NEUTRAL_DEGRADED_SCORE, degraded) — partial hydration is fine because the
// scorer evaluates each show's demographics in isolation.
//
// No preemptive per-run fetch cap: the pool is naturally bounded by the
// candidate count, and fromApi/fromDb counts are surfaced in the result (and
// the conviction.scored event) so the spend is a reported number.
// ============================================================

import type { Show, ShowDemographics } from "@/lib/data/types";
import { generateSlug, getShowsBySlugs } from "@/lib/data/queries";
import {
  getPodscanClientSafe,
  PodscanError,
  type PodscanDemographics,
} from "@/lib/enrichment/podscan";
import { podscanDemographicsToShowDemographics } from "./format-discovered-show";

// ---- Injected dependencies (default to the real implementations) ----

export interface HydrateDemographicsDeps {
  /** Batched stored-show lookup keyed on the createShow slug identity. */
  lookupBySlugs: (slugs: string[]) => Promise<Array<Show & { slug: string }>>;
  /**
   * One demographics fetch. Null means "no data" (no API key configured, or
   * Podscan 404 = podcast has no demographics) — a skip, not an error.
   */
  fetchDemographics: (podscanId: string) => Promise<PodscanDemographics | null>;
}

const defaultDeps: HydrateDemographicsDeps = {
  lookupBySlugs: getShowsBySlugs,
  fetchDemographics: async (podscanId) => {
    const client = getPodscanClientSafe();
    if (!client) return null;
    return client.getPodcastDemographics(podscanId);
  },
};

export interface HydrateDemographicsResult {
  /** Candidates hydrated from stored shows rows (no API spend). */
  fromDb: number;
  /** Candidates hydrated from a live Podscan demographics fetch. */
  fromApi: number;
  /** Candidates still without demographics after both passes. */
  skipped: number;
  errors: string[];
}

/** `{}` (the discovered-show default) counts as empty. */
export function hasDemographics(d: ShowDemographics | undefined | null): boolean {
  return !!d && Object.keys(d).length > 0;
}

// Half the Podscan Premium concurrent-request cap (10) — leaves headroom for
// anything else talking to Podscan while a discovery run is in flight.
const FETCH_CONCURRENCY = 5;

/**
 * Fill candidate demographics in place (mirrors fillPurchasePower's
 * mutate-in-place contract). Never throws.
 */
export async function hydrateCandidateDemographics(
  candidates: Show[],
  deps: HydrateDemographicsDeps = defaultDeps
): Promise<HydrateDemographicsResult> {
  const result: HydrateDemographicsResult = {
    fromDb: 0,
    fromApi: 0,
    skipped: 0,
    errors: [],
  };
  if (candidates.length === 0) return result;

  // ---- Pass 1: DB-first, one batched query ----
  const slugOf = new Map<Show, string>();
  for (const c of candidates) slugOf.set(c, generateSlug(c.name));

  let rows: Array<Show & { slug: string }> = [];
  try {
    rows = await deps.lookupBySlugs([...new Set(slugOf.values())]);
  } catch (err) {
    result.errors.push(
      `Demographics DB lookup failed (${errMsg(err)}) — API-only hydration this run.`
    );
  }
  const rowBySlug = new Map(rows.map((r) => [r.slug, r]));

  for (const c of candidates) {
    const row = rowBySlug.get(slugOf.get(c)!);
    if (!row) continue;
    if (!c.podscan_id && row.podscan_id) c.podscan_id = row.podscan_id;
    if (!hasDemographics(c.demographics) && hasDemographics(row.demographics)) {
      c.demographics = row.demographics;
      result.fromDb++;
    }
  }

  // ---- Pass 2: Podscan fetch, deduped by podscan_id ----
  // (slug dedup can land the same podcast in the pool twice)
  const byPodscanId = new Map<string, Show[]>();
  for (const c of candidates) {
    if (c.platform !== "podcast") continue;
    if (!c.podscan_id || hasDemographics(c.demographics)) continue;
    const list = byPodscanId.get(c.podscan_id) ?? [];
    list.push(c);
    byPodscanId.set(c.podscan_id, list);
  }

  const queue = [...byPodscanId.entries()];
  let rateLimited = false;
  let failCount = 0;
  let firstFailure = "";

  const worker = async (): Promise<void> => {
    while (queue.length > 0 && !rateLimited) {
      const [podscanId, shows] = queue.shift()!;
      try {
        const payload = await deps.fetchDemographics(podscanId);
        if (!payload) continue; // no key configured, or 404 (no data) — skip
        const demo = podscanDemographicsToShowDemographics(payload);
        if (!hasDemographics(demo)) continue; // payload had no usable sections
        for (const s of shows) {
          s.demographics = demo;
          result.fromApi++;
        }
      } catch (err) {
        if (err instanceof PodscanError && err.status === 429) {
          // The client already retried with backoff — a 429 here means the
          // budget is really gone. Circuit-break the rest of this run; only
          // the first worker to trip it writes the note (concurrent in-flight
          // 429s would duplicate it).
          if (!rateLimited) {
            rateLimited = true;
            result.errors.push(
              `Podscan rate limit during demographics hydration — ${queue.length + 1} podcast(s) left unhydrated this run.`
            );
          }
          return;
        }
        failCount++;
        if (!firstFailure) firstFailure = errMsg(err);
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(FETCH_CONCURRENCY, queue.length) }, worker)
  );

  if (failCount > 0) {
    result.errors.push(
      `Demographics fetch failed for ${failCount} podcast(s) (first: ${firstFailure}).`
    );
  }

  result.skipped = candidates.filter(
    (c) => !hasDemographics(c.demographics)
  ).length;
  return result;
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
