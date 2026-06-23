// ============================================================
// CONVICTION DISCOVERY ORCHESTRATOR (Wave 14 Phase 2B — Layer 3)
//
// Wires the pure Layer 2 scorer (scoreShowConviction) into a live discovery
// run. For a campaign whose brief has been interpreted and whose rings the
// brand has confirmed (2A), this:
//   1. loads the campaign_pattern + confirmed rings,
//   2. discovers candidate shows (Podscan; YouTube when a brief opts in),
//   3. HARD-excludes Sleep / Meditation / ASMR before scoring (§11),
//   4. folds simulcast (podcast + YouTube) records into one (inert today),
//   5. fills audience_purchase_power in-memory from categories
//      ("Layer 3 fills, Layer 2 strict" — keeps PP live regardless of
//      persistence),
//   6. scores every candidate against every confirmed ring,
//   7. keeps every show that hits `medium` band or above on ANY ring
//      (more results, not fewer — filter/paginate is downstream),
//   8. generates per-ring reasoning prose IN PASS (Layer 4 — one LLM call per
//      ring, concurrent, fail-soft to a template) and attaches it to each kept
//      entry,
//   9. persists kept shows (createShow → real UUID + Layer 1 PP auto-fill,
//      idempotent by slug) and records one conviction_scores row per
//      (show, ring) — reasoning included — fail-soft,
//  10. emits `conviction.scored`.
//
// No /campaigns/[id] view (Layer 5), no test/scale tier split (2C). Reasoning
// is delegated to ./conviction-reasoning (injected dep) so the scorer itself
// stays LLM-free and the orchestration is testable without a live DB, Podscan,
// or model.
// ============================================================

import type {
  Show,
  Platform,
  RingHypothesisRow,
  CampaignPatternRow,
  ConvictionBand,
} from "@/lib/data/types";
import {
  discoverShows,
  excludeExcludedGenres,
  mergeSimulcasts,
  type DiscoveryBrief,
  type DiscoveryResult,
} from "./discover-shows";
import { scoreShowConviction, type ConvictionScore } from "@/lib/scoring/conviction";
import { generateGroupReasoning } from "./conviction-reasoning";
import { categoriesToPurchasePowerScore } from "@/lib/scoring/purchase-power";
import { getCampaignById, createShow } from "@/lib/data/queries";
import {
  getLatestCampaignPatternForCampaign,
  getConfirmedRings,
  clearConvictionScores,
  recordConvictionScore,
  type RecordConvictionScoreInput,
} from "@/lib/data/reasoning-log";
import { logEvent, type LogEventInput } from "@/lib/data/events";

// ---- Public result types ----

export interface ScoredShowEntry {
  show: Show;
  score: ConvictionScore;
  /** Real shows.id after persistence; null if createShow failed/was skipped. */
  persistedShowId: string | null;
  /** Layer 4 reasoning prose; null until generateGroupReasoning fills it
   *  (LLM prose or templated fallback). Persisted onto the conviction_scores
   *  row's `reasoning` column. */
  reasoning: string | null;
}

export interface ScoredRingGroup {
  ring: RingHypothesisRow;
  /** Shows scoring `medium`+ on this ring, composite descending. */
  shows: ScoredShowEntry[];
}

export interface ConvictionDiscoveryResult {
  campaignId: string;
  campaignPatternId: string | null;
  /** One group per confirmed ring; primary first (rings come slot-ordered). */
  rings: ScoredRingGroup[];
  /** Candidates after genre exclusion + simulcast merge. */
  candidateCount: number;
  /** Distinct (show, ring) conviction_scores rows recorded. */
  scoredCount: number;
  /** Distinct shows kept (medium+ on ≥1 ring). */
  keptShowCount: number;
  errors: string[];
}

// ---- Injected dependencies (default to the real implementations) ----

export interface ConvictionDiscoveryDeps {
  discover: (brief: DiscoveryBrief) => Promise<DiscoveryResult>;
  loadCampaign: (id: string) => Promise<{ platforms: Platform[] } | null>;
  loadPattern: (campaignId: string) => Promise<CampaignPatternRow | null>;
  loadConfirmedRings: (patternId: string) => Promise<RingHypothesisRow[]>;
  persistShow: (
    input: Partial<Show> & { name: string; platform: Platform }
  ) => Promise<Show | null>;
  clearScores: (patternId: string) => Promise<boolean>;
  recordScore: (input: RecordConvictionScoreInput) => Promise<void>;
  /** Layer 4: attach reasoning prose to each kept entry in place (LLM per ring,
   *  fail-soft to a template). Injected so the orchestrator stays testable
   *  without a live model. */
  generateReasoning: (
    campaignId: string,
    groups: ScoredRingGroup[],
    pattern: CampaignPatternRow
  ) => Promise<void>;
  emit: (input: LogEventInput) => Promise<unknown>;
}

const defaultDeps: ConvictionDiscoveryDeps = {
  discover: discoverShows,
  loadCampaign: getCampaignById,
  loadPattern: getLatestCampaignPatternForCampaign,
  loadConfirmedRings: getConfirmedRings,
  persistShow: createShow,
  clearScores: clearConvictionScores,
  recordScore: recordConvictionScore,
  generateReasoning: generateGroupReasoning,
  emit: logEvent,
};

// ---- Band helpers ----

const BAND_RANK: Record<ConvictionBand, number> = {
  speculative: 0,
  low: 1,
  medium: 2,
  high: 3,
};

/** The "more results, not fewer" inclusion floor: `medium` band or above. */
export function isMediumOrAbove(band: ConvictionBand): boolean {
  return BAND_RANK[band] >= BAND_RANK.medium;
}

/**
 * DAI / aggregator-format down-weight seam (§11). Returns a multiplier in
 * [0,1] applied to the composite. **1.0 today — a deliberate no-op.** The only
 * network/publisher signal on a Show is free-text `network` (Podscan
 * publisher_name); there is no clean DAI/format flag, and inventing a
 * publisher→DAI mapping is exactly what §11 says not to do. When a curated
 * aggregator-network list or a real format signal lands, return <1 here AND
 * re-derive the band — `score.band` currently reflects Layer 2's un-modified
 * composite, so a real down-weight must recompute the band too.
 */
export function daiModifier(show: Show): number {
  void show; // reserved signal (network/publisher); unused until a curated list lands
  return 1.0;
}

// ---- Pure PP fill (in-memory, before scoring) ----

/**
 * Attach audience_purchase_power from categories to any candidate missing it
 * (the "Layer 3 fills, Layer 2 strict" decision). Mutates in place — candidates
 * are freshly discovered, throwaway objects. After this, Layer 2 reads PP as a
 * real column value (source:'column') for every candidate.
 */
export function fillPurchasePower(shows: Show[]): void {
  for (const show of shows) {
    if (show.audience_purchase_power == null) {
      show.audience_purchase_power = categoriesToPurchasePowerScore(show.categories);
    }
  }
}

// ---- Pure scoring core (no I/O) ----

/**
 * Score every candidate against every ring; keep, per ring, the shows at
 * `medium` band or above, sorted by composite descending. Pure — no DB, no
 * network. `persistedShowId` is left null here; the orchestrator fills it after
 * persistence.
 */
export function scoreCandidatesAgainstRings(
  candidates: Show[],
  rings: RingHypothesisRow[],
  pattern: CampaignPatternRow
): ScoredRingGroup[] {
  return rings.map((ring) => {
    const shows: ScoredShowEntry[] = [];
    for (const show of candidates) {
      const raw = scoreShowConviction(show, ring, pattern);
      // Apply the (no-op) DAI seam to the composite. With modifier 1.0 the
      // composite and band are unchanged; see daiModifier() for the contract
      // when a real value lands.
      const composite = clamp100(Math.round(raw.composite * daiModifier(show)));
      const score: ConvictionScore = { ...raw, composite };
      if (isMediumOrAbove(score.band)) {
        shows.push({ show, score, persistedShowId: null, reasoning: null });
      }
    }
    shows.sort((a, b) => b.score.composite - a.score.composite);
    return { ring, shows };
  });
}

// ---- Orchestration ----

export async function runConvictionDiscovery(
  campaignId: string,
  deps: ConvictionDiscoveryDeps = defaultDeps
): Promise<ConvictionDiscoveryResult> {
  const errors: string[] = [];
  const empty = (
    patternId: string | null
  ): ConvictionDiscoveryResult => ({
    campaignId,
    campaignPatternId: patternId,
    rings: [],
    candidateCount: 0,
    scoredCount: 0,
    keptShowCount: 0,
    errors,
  });

  // Loaders are wrapped (callSafe) so a thrown read never propagates to the
  // caller — INV-1 fail-soft holds even before scoring starts. A throw is
  // treated as "no data" (undefined), which the guards below handle.
  const pattern = await callSafe("loadPattern", () => deps.loadPattern(campaignId));
  if (!pattern) {
    errors.push("No campaign pattern — interpret the brief before discovery.");
    return empty(null);
  }

  const rings =
    (await callSafe("loadConfirmedRings", () =>
      deps.loadConfirmedRings(pattern.id)
    )) ?? [];
  if (rings.length === 0) {
    errors.push("No confirmed rings — confirm the interpretation before discovery.");
    return empty(pattern.id);
  }

  const campaign =
    (await callSafe("loadCampaign", () => deps.loadCampaign(campaignId))) ?? null;
  const platforms: Platform[] =
    campaign?.platforms && campaign.platforms.length > 0
      ? campaign.platforms
      : ["podcast"];

  const brief = buildDiscoveryBrief(pattern, rings, platforms);
  let discovery: DiscoveryResult;
  try {
    discovery = await deps.discover(brief);
  } catch (err) {
    errors.push(
      `Discovery failed: ${err instanceof Error ? err.message : "unknown error"}`
    );
    return empty(pattern.id);
  }
  errors.push(...discovery.errors);

  // §11 hard genre filter BEFORE scoring → fold simulcasts → fill PP.
  const candidates = mergeSimulcasts(excludeExcludedGenres(discovery.discovered));
  fillPurchasePower(candidates);

  const groups = scoreCandidatesAgainstRings(candidates, rings, pattern);

  // Layer 4: attach reasoning prose to each kept entry IN PASS — the in-memory
  // groups carry the Layer 2 drivers + full Show objects (neither persisted),
  // which is exactly what the prose needs to name a real driver without
  // fabricating one. Wrapped in callSafe + internally fail-soft: a reasoning
  // failure leaves entry.reasoning null (or a template) and never aborts the
  // scoring run.
  await callSafe("generateReasoning", () =>
    deps.generateReasoning(campaignId, groups, pattern)
  );

  // Replace prior scores for this pattern (re-run safety: no unique constraint
  // on conviction_scores, and the surface sorts by composite). Wrapped so a
  // throw can't abort the run; undefined (threw) or false both surface the note.
  const cleared = await callSafe("clearScores", () => deps.clearScores(pattern.id));
  if (!cleared) {
    errors.push(
      "Could not clear prior conviction scores — a re-run may duplicate rows."
    );
  }

  // Persist each kept show once — a show kept on multiple rings is written one
  // time and its UUID reused across its ring rows. `writtenPairs` then dedups
  // the actual writes by (real show id, ring): two distinct candidates that
  // share a name collapse to the same row via createShow's slug dedup, so this
  // guards against a double-listed (show, ring) conviction_scores row.
  const persistedIdByShow = new Map<string, string | null>();
  const writtenPairs = new Set<string>();
  let scoredCount = 0;
  for (const group of groups) {
    for (const entry of group.shows) {
      let showId = persistedIdByShow.get(entry.show.id);
      if (showId === undefined) {
        showId = await persistCandidate(entry.show, deps);
        persistedIdByShow.set(entry.show.id, showId);
      }
      entry.persistedShowId = showId;
      // Persistence failed → keep the in-memory score in the response, but skip
      // the FK-bound conviction_scores write (show_id must reference shows.id).
      if (!showId) continue;
      const pairKey = `${showId}::${group.ring.id}`;
      if (writtenPairs.has(pairKey)) continue;
      writtenPairs.add(pairKey);
      // Guarded so a thrown write skips this row but never aborts the run; only
      // count a row that didn't throw at the call boundary.
      try {
        await deps.recordScore({
          campaignPatternId: pattern.id,
          showId,
          ringHypothesisId: group.ring.id,
          audienceFitScore: entry.score.audienceFit,
          topicalRelevanceScore: entry.score.topicalRelevance,
          purchasePowerScore: entry.score.purchasePower,
          compositeScore: entry.score.composite,
          convictionBand: entry.score.band,
          reasoning: entry.reasoning, // Layer 4 (LLM prose or template); null if it failed soft.
          // tier → 2C; null here.
        });
        scoredCount++;
      } catch (err) {
        console.warn(
          "[conviction-discovery] recordScore threw:",
          err instanceof Error ? err.message : err
        );
      }
    }
  }

  // Distinct shows kept: collapse the slug-dedup case (two ephemeral candidates
  // resolving to one real UUID count once) while still counting a kept show
  // whose persist failed (ephemeral id, no UUID) — see Finding 4.
  const keptShowCount = new Set(
    Array.from(persistedIdByShow.entries(), ([ephId, realId]) => realId ?? ephId)
  ).size;
  await callSafe("emit", () =>
    deps.emit({
      eventType: "conviction.scored",
      entityType: "campaign",
      entityId: campaignId,
      payload: {
        campaign_pattern_id: pattern.id,
        ring_count: rings.length,
        candidate_count: candidates.length,
        kept_show_count: keptShowCount,
        scored_count: scoredCount,
      },
    })
  );

  return {
    campaignId,
    campaignPatternId: pattern.id,
    rings: groups,
    candidateCount: candidates.length,
    scoredCount,
    keptShowCount,
    errors,
  };
}

// ---- Helpers ----

/**
 * Run a dependency call, swallowing any throw to honor the fail-soft contract
 * (INV-1: the orchestrator must never throw to its caller). Returns the
 * dependency's value, or undefined if it threw; the failure is logged. Used for
 * every I/O dependency so a misbehaving (or future) dep can't abort the run.
 */
async function callSafe<T>(
  label: string,
  fn: () => Promise<T>
): Promise<T | undefined> {
  try {
    return await fn();
  } catch (err) {
    console.warn(
      `[conviction-discovery] ${label} threw:`,
      err instanceof Error ? err.message : err
    );
    return undefined;
  }
}

/**
 * Persist a discovered show (idempotent by slug; createShow returns the
 * existing row on slug collision and auto-fills audience_purchase_power via
 * Layer 1). Returns the real UUID, or null on failure — fail-soft so one bad
 * insert never aborts the scoring run.
 */
async function persistCandidate(
  show: Show,
  deps: ConvictionDiscoveryDeps
): Promise<string | null> {
  try {
    const saved = await deps.persistShow({
      name: show.name,
      platform: show.platform,
      description: show.description,
      image_url: show.image_url,
      categories: show.categories ?? [],
      audience_interests: show.audience_interests ?? [],
      tags: show.tags ?? [],
      network: show.network,
      contact: show.contact,
      audience_size: show.audience_size,
      demographics: show.demographics,
      audience_purchase_power: show.audience_purchase_power,
      rate_card: show.rate_card,
      price_type: show.price_type,
      ad_formats: show.ad_formats,
      current_sponsors: show.current_sponsors ?? [],
      apple_id: show.apple_id,
      spotify_id: show.spotify_id,
      youtube_channel_id: show.youtube_channel_id,
      rss_url: show.rss_url,
      surfaces: show.surfaces,
      data_sources: show.data_sources ?? ["discovery"],
      is_claimed: false,
      is_verified: false,
    });
    return saved?.id ?? null;
  } catch (err) {
    console.warn(
      `[conviction-discovery] persist failed for "${show.name}":`,
      err instanceof Error ? err.message : err
    );
    return null;
  }
}

/**
 * Maps free-text product/ring topics onto Podscan interest buckets. Priority
 * order: the first ten are PRIMARY buckets (category-ID targeting + per-interest
 * search terms); the last two ("Science", "Food & Cooking") are search-terms-
 * only (extra breadth, no category IDs). Every `interest` here MUST be a
 * byte-for-byte key in category-mapping.ts (INTEREST_TO_PODSCAN /
 * INTEREST_SEARCH_TERMS) — a near-miss silently maps to nothing and reproduces
 * the empty-query bug. The guard test in conviction-discovery.test.ts asserts
 * this via isKnownPodscanInterest, so a typo fails CI loudly.
 */
export const INTEREST_TOPIC_RULES: Array<{ interest: string; pattern: RegExp }> = [
  { interest: "Health & Wellness", pattern: /\b(health|wellness|wellbeing|fitness|nutrition|protein|supplement|supplements|diet|dietary|recovery|biohack|biohacking|workout|gym|weight|calorie|sugar|collagen|whey|vitamin|fasting|gut|longevity|hydration|electrolyte|probiotic|keto|vegan|organic|snack|snacks|functional food|skincare|beauty|mental health|glp)\b/i },
  { interest: "Business & Finance", pattern: /\b(business|finance|financial|invest|investing|investment|money|entrepreneur|entrepreneurship|startup|founder|marketing|sales|ecommerce|e-commerce|saas|crypto|real estate|wealth|b2b)\b/i },
  { interest: "Technology", pattern: /\b(tech|technology|software|hardware|ai|artificial intelligence|gadget|gadgets|developer|programming|cyber|robotics)\b/i },
  { interest: "Self-Improvement", pattern: /\b(self.?improvement|motivation|motivational|mindset|productivity|habit|habits|personal development|personal growth|discipline|coaching)\b/i },
  { interest: "Sports", pattern: /\b(sport|sports|athlete|athletic|running|runner|cycling|basketball|football|soccer|golf|tennis|endurance|marathon|crossfit|strength training)\b/i },
  { interest: "Parenting & Family", pattern: /\b(parent|parents|parenting|family|kid|kids|mom|mother|motherhood|dad|father|fatherhood|baby|toddler|pregnancy|newborn)\b/i },
  { interest: "Education", pattern: /\b(education|educational|learning|teaching|student|academic|knowledge)\b/i },
  { interest: "Comedy", pattern: /\b(comedy|comedian|humor|funny|stand.?up)\b/i },
  { interest: "True Crime", pattern: /\b(true crime|murder|detective|forensic|forensics)\b/i },
  { interest: "Entertainment", pattern: /\b(entertainment|tv show|tv shows|film|movie|movies|celebrity|pop culture|gaming)\b/i },
  { interest: "Science", pattern: /\b(science|scientific|research|neuroscience|biology|physics|chemistry)\b/i },
  { interest: "Food & Cooking", pattern: /\b(cooking|recipe|recipes|chef|culinary)\b/i },
];

/**
 * Map combined product + ring topic text onto Podscan interest buckets (in
 * priority order, capped) so category-ID targeting + per-interest queries fire —
 * the breadth that turns a 0-candidate query into a real pool. Empty when no
 * topic matches (the brief then falls back to keyword-only discovery).
 */
export function mapTopicsToInterests(topicText: string): string[] {
  const t = topicText.toLowerCase();
  return INTEREST_TOPIC_RULES.filter((r) => r.pattern.test(t))
    .map((r) => r.interest)
    .slice(0, 3); // cap per-interest fan-out + category-ID breadth
}

/**
 * Build the discovery brief from the confirmed interpretation. Two parts:
 *  - keywords: short product terms from the CATEGORY only (split on / & , ;),
 *    deduped. The verbose key_attributes are deliberately NOT used — they are
 *    sentence-like ("subscription model (Subscribe & Save 20%)") and poison
 *    Podscan's text search.
 *  - target_interests: product + ring topics mapped to Podscan buckets, so
 *    category-ID filtering and per-interest queries fire (without this the
 *    single keyword query returns ~nothing for most briefs).
 */
export function buildDiscoveryBrief(
  pattern: CampaignPatternRow,
  rings: RingHypothesisRow[],
  platforms: Platform[]
): DiscoveryBrief {
  const attrs = (pattern.product_attributes ?? {}) as Record<string, unknown>;
  const category = typeof attrs.category === "string" ? attrs.category : "";
  const keyAttributes = Array.isArray(attrs.key_attributes)
    ? attrs.key_attributes.filter((x): x is string => typeof x === "string")
    : [];
  const ringLabels = rings.map((r) => r.label).filter((l): l is string => !!l);

  const keywords = dedupeStrings(category.split(/[/&,;]+/)).slice(0, 6);

  const topicText = [category, ...keyAttributes, ...ringLabels].join(" ");
  const target_interests = mapTopicsToInterests(topicText);

  return {
    target_interests,
    keywords,
    platforms: platforms as string[],
  };
}

function dedupeStrings(items: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    const v = (item ?? "").trim();
    if (!v) continue;
    const key = v.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(v);
  }
  return out;
}

function clamp100(n: number): number {
  return Math.round(Math.max(0, Math.min(100, n)));
}
