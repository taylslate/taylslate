// ============================================================
// PRE-SCORING DEMOGRAPHICS HYDRATION (audience-fit live)
//
// Conviction scoring runs on IN-MEMORY candidates built from fresh Podscan
// search responses, BEFORE persistence — demographics sitting on shows rows
// never reach the scorer on their own. This step fills candidate.demographics
// in place, right before scoring:
//
//   1. DB-first: one batched slug lookup (the createShow dedup key) copies
//      stored demographics + podscan_id + current_sponsors onto matching
//      candidates — zero API spend. This is how backfilled shows reach the
//      scorer (sponsors are prompt/display data only, never scored).
//   2. Podscan fetch (GET /podcasts/{id}/demographics, Premium+) for podcast
//      candidates that have a podscan_id and still-empty demographics.
//
// Fail-soft like tierPortfolio: collects its own error notes, never throws.
// Any candidate left unhydrated scores audience fit exactly as today
// (NEUTRAL_DEGRADED_SCORE, degraded) — partial hydration is fine because the
// scorer evaluates each show's demographics in isolation.
//
// Pass 2 has a wall-clock budget (default 45s, injectable on deps). When it
// elapses, workers stop taking new podcast ids and the rest stay unhydrated.
// fromApi and fromDb counts are still reported on the result.
// ============================================================

import type { Show, ShowDemographics } from "@/lib/data/types";
import { generateSlug, getShowsBySlugs } from "@/lib/data/queries";
import {
  geographyForIdentity,
  getVerifiedAudienceGeography,
  type ShowGeoIdentity,
  type VerifiedGeography,
} from "@/lib/shows/apply-geography";
import {
  hasAudienceGeography,
  mergeGeographyIntoDemographics,
} from "@/lib/shows/media-kit-geo";
import {
  getPodscanClientSafe,
  PodscanError,
  type PodscanDemographics,
} from "@/lib/enrichment/podscan";
import { PodscanApiError } from "@/lib/podscan/client";
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
  /**
   * Wall-clock budget for the Podscan demographics pass. Default 45s.
   * When it elapses, workers stop taking new ids. In-flight fetches finish.
   * The rest of the queue stays unhydrated.
   */
  pass2BudgetMs?: number;
  /** Clock for the pass 2 budget. Tests inject one. Default is Date.now. */
  now?: () => number;
  /**
   * Media-kit country shares from show_profiles that have a verified tie
   * to a catalog show (a deal, or a show_owner email). Omitted → skip.
   * A shared name or show_profiles.podscan_id is not a tie. The podscanId
   * on the identity is the catalog shows.podscan_id, used for the Podscan
   * demographics fetch, and is not a profile join. Fills country keys the
   * candidate doesn't already have.
   */
  lookupGeography?: (identities: ShowGeoIdentity[]) => Promise<VerifiedGeography[]>;
}

const defaultDeps: HydrateDemographicsDeps = {
  lookupBySlugs: getShowsBySlugs,
  fetchDemographics: async (podscanId) => {
    const client = getPodscanClientSafe();
    if (!client) return null;
    return client.getPodcastDemographics(podscanId);
  },
  lookupGeography: getVerifiedAudienceGeography,
};

export interface HydrateDemographicsResult {
  /** Candidates hydrated from stored shows rows (no API spend). */
  fromDb: number;
  /** Candidates hydrated from a live Podscan demographics fetch. */
  fromApi: number;
  /** Candidates still without demographics after both passes. */
  skipped: number;
  /** Candidates whose current_sponsors were copied from stored rows
   *  (DB-only — sponsors have no API pass; the backfill script covers the
   *  catalog). Display/prompt data, never a scoring input. */
  sponsorsFromDb: number;
  errors: string[];
}

/** `{}` (the discovered-show default) counts as empty. */
export function hasDemographics(d: ShowDemographics | undefined | null): boolean {
  return !!d && Object.keys(d).length > 0;
}

// Half the Podscan Premium concurrent-request cap (10). Leaves headroom for
// anything else talking to Podscan while a discovery run is in flight.
const FETCH_CONCURRENCY = 5;

/** Stop pass 2 after this long so a slow Podscan cannot hold discovery. */
export const DEMOGRAPHICS_PASS2_BUDGET_MS = 45_000;

/** Catalog `shows.id`. Discovery ids (`discovered-podscan-…`) are not ties. */
const CATALOG_SHOW_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function catalogShowId(id: string | undefined): string | undefined {
  return id && CATALOG_SHOW_ID.test(id) ? id : undefined;
}

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
    sponsorsFromDb: 0,
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
    // Sponsors ride the same DB-first pass (candidates are built with []).
    // Not a scoring input — this feeds the Layer 4 prompt + outreach only.
    if (
      (c.current_sponsors?.length ?? 0) === 0 &&
      (row.current_sponsors?.length ?? 0) > 0
    ) {
      c.current_sponsors = row.current_sponsors;
      result.sponsorsFromDb++;
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
  let budgetNoted = false;
  let failCount = 0;
  let firstFailure = "";
  const budgetMs = resolvePass2BudgetMs(deps.pass2BudgetMs);
  const now = deps.now ?? Date.now;
  const startedAt = now();

  const budgetElapsed = (): boolean => now() - startedAt >= budgetMs;

  const worker = async (): Promise<void> => {
    while (queue.length > 0 && !rateLimited) {
      if (budgetElapsed()) {
        // Stop taking new ids. In-flight fetches still finish. One note.
        if (!budgetNoted) {
          budgetNoted = true;
          result.errors.push(
            `Demographics hydration time budget elapsed. ${queue.length} podcast(s) left unhydrated this run.`
          );
        }
        return;
      }
      const [podscanId, shows] = queue.shift()!;
      try {
        const payload = await deps.fetchDemographics(podscanId);
        if (!payload) continue; // no key configured, or 404 (no data). Skip.
        const demo = podscanDemographicsToShowDemographics(payload);
        if (!hasDemographics(demo)) continue; // payload had no usable sections
        for (const s of shows) {
          s.demographics = demo;
          result.fromApi++;
        }
      } catch (err) {
        if (isPodscanRateLimit(err)) {
          // A 429 here means the client gave up: a Retry-After over 10s
          // throws immediately, and a short retry that still fails throws
          // too. Stop the rest of this run. Only the first worker writes
          // the note (concurrent in-flight 429s would duplicate it).
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

  if (deps.lookupGeography) {
    try {
      const identityOf = new Map<Show, ShowGeoIdentity>();
      for (const candidate of candidates) {
        // The catalog id is the candidate's own id when this show is already
        // a shows row. A slug from the name is not a tie.
        identityOf.set(candidate, {
          showId: catalogShowId(candidate.id),
          podscanId: candidate.podscan_id || undefined,
          contactEmail: candidate.contact?.email || undefined,
          dataSources: candidate.data_sources,
        });
      }
      const geoRows = await deps.lookupGeography([...identityOf.values()]);
      for (const candidate of candidates) {
        const geography = geographyForIdentity(identityOf.get(candidate)!, geoRows);
        if (!hasAudienceGeography(geography)) continue;
        // onlyMissing: a share already on the show (DB or an earlier kit
        // write) wins over the profile copy.
        candidate.demographics = mergeGeographyIntoDemographics(
          candidate.demographics,
          geography,
          { onlyMissing: true }
        );
      }
    } catch (err) {
      result.errors.push(
        `Audience geography lookup failed (${errMsg(err)}) — scoring without media-kit country shares.`
      );
    }
  }

  result.skipped = candidates.filter(
    (c) => !hasDemographics(c.demographics)
  ).length;
  return result;
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function resolvePass2BudgetMs(value: number | undefined): number {
  if (value == null || !Number.isFinite(value) || value < 0) return DEMOGRAPHICS_PASS2_BUDGET_MS;
  return value;
}

/** Either Podscan client. A 429 stops the rest of the pass. */
function isPodscanRateLimit(err: unknown): boolean {
  if (err instanceof PodscanError || err instanceof PodscanApiError) {
    return err.status === 429;
  }
  return false;
}
