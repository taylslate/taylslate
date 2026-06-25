import { describe, it, expect, vi } from "vitest";

// The orchestrator statically imports the real DB modules for its default
// deps (queries / reasoning-log / events), which transitively construct the
// admin Supabase client at import time. Tests inject fakes, so the real client
// is never used — stub the module so import doesn't require live env. Matches
// the convention in pattern-library-retrieval.test.ts.
vi.mock("@/lib/supabase/admin", () => ({ supabaseAdmin: { from: vi.fn() } }));

import {
  runConvictionDiscovery,
  scoreCandidatesAgainstRings,
  fillPurchasePower,
  isMediumOrAbove,
  daiModifier,
  buildDiscoveryBrief,
  mapTopicsToInterests,
  INTEREST_TOPIC_RULES,
  type ConvictionDiscoveryDeps,
} from "./conviction-discovery";
import {
  excludeExcludedGenres,
  isExcludedGenre,
  mergeSimulcasts,
  type DiscoveryResult,
} from "./discover-shows";
import { isKnownPodscanInterest } from "./category-mapping";
import { PURCHASE_POWER_SCORE } from "@/lib/scoring/purchase-power";
import type {
  Show,
  ShowDemographics,
  RingHypothesisRow,
  CampaignPatternRow,
  Platform,
  AovBucket,
  BrandDecision,
} from "@/lib/data/types";
import type { RecordConvictionScoreInput } from "@/lib/data/reasoning-log";
import type { LogEventInput } from "@/lib/data/events";

// ---- Fixture factories ----

function makeShow(overrides: Partial<Show> = {}): Show {
  const base = {
    id: "discovered-podscan-x",
    name: "Test Show",
    platform: "podcast" as Platform,
    description: "",
    categories: [] as string[],
    tags: [] as string[],
    contact: { name: "", email: "", method: "email" as const },
    audience_size: 50000,
    demographics: {} as ShowDemographics,
    audience_interests: [] as string[],
    rate_card: { midroll_cpm: 25 },
    price_type: "cpm" as const,
    ad_formats: ["host_read" as const],
    episode_cadence: "weekly" as const,
    avg_episode_length_min: 45,
    current_sponsors: [] as string[],
    is_claimed: false,
    is_verified: false,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  };
  return { ...base, ...overrides } as Show;
}

function makeRing(overrides: Partial<RingHypothesisRow> = {}): RingHypothesisRow {
  return {
    id: "ring-1",
    campaign_pattern_id: "cp-1",
    created_at: "2026-01-01T00:00:00.000Z",
    kind: "primary",
    label: "protocol-driven recovery and biohacking",
    reasoning: "host runs recovery protocols personally",
    confidence: "high",
    confidence_score: 80,
    brand_confirmed: true,
    brand_decision: "confirmed",
    slot_position: 0,
    ...overrides,
  };
}

function makePattern(
  aov: AovBucket | null = "mid",
  productAttributes: Record<string, unknown> = {}
): CampaignPatternRow {
  return {
    id: "cp-1",
    campaign_id: "camp-1",
    customer_id: "cust-1",
    created_at: "2026-01-01T00:00:00.000Z",
    product_attributes: {
      category: "recovery hardware",
      key_attributes: ["cold plunge", "sauna"],
      ...productAttributes,
    },
    customer_description: null,
    aov_bucket: aov,
    scoring_weights: null,
  };
}

// A show whose category directly matches the ring → topical 85; with default
// (empty) demographics audience-fit degrades to neutral. "business" lifts
// purchase power to the high anchor. Net band = medium.
function recoveryShow(overrides: Partial<Show> = {}): Show {
  return makeShow({
    id: "discovered-podscan-recovery",
    name: "Recovery Lab",
    categories: ["business", "recovery"],
    audience_interests: ["recovery"],
    ...overrides,
  });
}

// A show with no topical overlap and no demographics → band low → excluded.
function offTopicShow(overrides: Partial<Show> = {}): Show {
  return makeShow({
    id: "discovered-podscan-offtopic",
    name: "Gardening Hour",
    categories: ["gardening"],
    audience_interests: ["gardening"],
    ...overrides,
  });
}

// ---- DI harness ----

interface DepsHarness {
  deps: ConvictionDiscoveryDeps;
  recordCalls: RecordConvictionScoreInput[];
  events: LogEventInput[];
  persistCalls: Array<Partial<Show>>;
  reasoningCalls: number;
  clearCalls: () => number;
  /** Pattern ids passed to the Phase 2C tier pass, in call order. */
  tierCalls: string[];
}

function makeDeps(opts: {
  discovered?: Show[];
  rings?: RingHypothesisRow[];
  pattern?: CampaignPatternRow | null;
  platforms?: Platform[];
  persistShow?: ConvictionDiscoveryDeps["persistShow"];
  discover?: ConvictionDiscoveryDeps["discover"];
  generateReasoning?: ConvictionDiscoveryDeps["generateReasoning"];
  tierPortfolio?: ConvictionDiscoveryDeps["tierPortfolio"];
} = {}): DepsHarness {
  const recordCalls: RecordConvictionScoreInput[] = [];
  const events: LogEventInput[] = [];
  const persistCalls: Array<Partial<Show>> = [];
  const tierCalls: string[] = [];
  const harness = { reasoningCalls: 0 };
  let clearCount = 0;
  let seq = 0;

  // One persist path: count every call, then delegate to the override (which
  // may return null to simulate a write failure) or the default UUID minter.
  const persistShow: ConvictionDiscoveryDeps["persistShow"] = async (input) => {
    persistCalls.push(input);
    if (opts.persistShow) return opts.persistShow(input);
    return { ...(input as Show), id: `uuid-${++seq}` };
  };

  const deps: ConvictionDiscoveryDeps = {
    discover:
      opts.discover ??
      (async (): Promise<DiscoveryResult> => ({
        discovered: opts.discovered ?? [],
        sources: { podscan: 0, youtube: 0 },
        errors: [],
      })),
    loadCampaign: async () => ({ platforms: opts.platforms ?? ["podcast"] }),
    loadPattern: async () =>
      opts.pattern === undefined ? makePattern("mid") : opts.pattern,
    loadConfirmedRings: async () => opts.rings ?? [makeRing()],
    persistShow,
    clearScores: async () => {
      clearCount++;
      return true;
    },
    recordScore: async (input) => {
      recordCalls.push(input);
    },
    // Default: a no-op stand-in for the real Layer 4 module (the orchestrator's
    // job is to call it and persist whatever reasoning it attaches — the LLM
    // behavior is exercised in conviction-reasoning.test.ts). Tests that assert
    // the wiring inject their own.
    generateReasoning:
      opts.generateReasoning ??
      (async () => {
        harness.reasoningCalls++;
      }),
    emit: async (e) => {
      events.push(e);
      return null;
    },
    // Phase 2C Layer 3: capture the pattern id the orchestrator hands the tier
    // pass. Default returns a clean result; tests inject a throwing/erroring
    // override to exercise the fail-soft guard.
    tierPortfolio:
      opts.tierPortfolio ??
      (async (patternId) => {
        tierCalls.push(patternId);
        return {
          campaignPatternId: patternId,
          testCount: 0,
          scaleCount: 0,
          droppedCount: 0,
          testUnderfilled: true,
          showsClassified: 0,
          persisted: 0,
          errors: [],
        };
      }),
  };

  return {
    deps,
    recordCalls,
    events,
    persistCalls,
    tierCalls,
    get reasoningCalls() {
      return harness.reasoningCalls;
    },
    clearCalls: () => clearCount,
  };
}

// ============================================================
// Pure helpers
// ============================================================

describe("genre exclusion (§11)", () => {
  it("excludes sleep / meditation / asmr by category", () => {
    expect(isExcludedGenre(makeShow({ categories: ["Sleep"] }))).toBe(true);
    expect(
      isExcludedGenre(makeShow({ categories: ["Meditation & Mindfulness"] }))
    ).toBe(true);
    expect(isExcludedGenre(makeShow({ categories: ["ASMR"] }))).toBe(true);
  });

  it("excludes a sleep cast by name even with a generic category", () => {
    expect(
      isExcludedGenre(makeShow({ name: "Get Sleepy", categories: ["Kids & Family"] }))
    ).toBe(true);
  });

  it("keeps a normal business show", () => {
    expect(
      isExcludedGenre(makeShow({ name: "Business Wars", categories: ["Business"] }))
    ).toBe(false);
  });

  it("exempts clinical sleep-medicine shows but still excludes sleep-aid casts", () => {
    expect(
      isExcludedGenre(
        makeShow({ name: "The Sleep Apnea Podcast", categories: ["Health & Fitness"] })
      )
    ).toBe(false);
    expect(
      isExcludedGenre(makeShow({ name: "Sleep Medicine Weekly", categories: ["Medicine"] }))
    ).toBe(false);
    // No clinical signal → still a sleep-aid genre show → excluded.
    expect(
      isExcludedGenre(makeShow({ name: "Get Sleepy", categories: ["Kids & Family"] }))
    ).toBe(true);
  });

  it("excludeExcludedGenres drops only the excluded genres", () => {
    const shows = [
      recoveryShow(),
      makeShow({ id: "s-sleep", name: "Sleep Sounds", categories: ["Sleep"] }),
      makeShow({ id: "s-asmr", name: "Tingle Time", categories: ["ASMR"] }),
    ];
    const kept = excludeExcludedGenres(shows);
    expect(kept.map((s) => s.id)).toEqual(["discovered-podscan-recovery"]);
  });
});

describe("simulcast merge", () => {
  it("folds a podcast + YouTube of the same name into one record with both surfaces", () => {
    const shows = [
      makeShow({ id: "pod-1", name: "Huberman Lab", platform: "podcast", rss_url: "rss" }),
      makeShow({
        id: "yt-1",
        name: "Huberman Lab",
        platform: "youtube",
        youtube_channel_id: "UC123",
      }),
    ];
    const merged = mergeSimulcasts(shows);
    expect(merged).toHaveLength(1);
    expect(merged[0].platform).toBe("podcast");
    expect(merged[0].surfaces?.podcast?.rss_url).toBe("rss");
    expect(merged[0].surfaces?.youtube?.youtube_channel_id).toBe("UC123");
  });

  it("is inert for podcast-only input (no surfaces attached)", () => {
    const shows = [recoveryShow(), offTopicShow()];
    const merged = mergeSimulcasts(shows);
    expect(merged).toHaveLength(2);
    expect(merged.every((s) => s.surfaces === undefined)).toBe(true);
  });

  it("does not mutate the input shows", () => {
    const pod = makeShow({ id: "pod-1", name: "Same", platform: "podcast" });
    const yt = makeShow({ id: "yt-1", name: "Same", platform: "youtube" });
    mergeSimulcasts([pod, yt]);
    expect(pod.surfaces).toBeUndefined();
  });
});

describe("fillPurchasePower (Layer 3 fills, Layer 2 strict)", () => {
  it("fills from categories when absent", () => {
    const shows = [makeShow({ categories: ["business"] })];
    fillPurchasePower(shows);
    expect(shows[0].audience_purchase_power).toBe(PURCHASE_POWER_SCORE.high);
  });

  it("does not clobber an existing value", () => {
    const shows = [makeShow({ categories: ["business"], audience_purchase_power: 12 })];
    fillPurchasePower(shows);
    expect(shows[0].audience_purchase_power).toBe(12);
  });
});

describe("inclusion floor + DAI seam", () => {
  it("isMediumOrAbove: high/medium in, low/speculative out", () => {
    expect(isMediumOrAbove("high")).toBe(true);
    expect(isMediumOrAbove("medium")).toBe(true);
    expect(isMediumOrAbove("low")).toBe(false);
    expect(isMediumOrAbove("speculative")).toBe(false);
  });

  it("daiModifier is a no-op (1.0) — no invented down-weight", () => {
    expect(daiModifier(recoveryShow())).toBe(1.0);
  });
});

describe("scoreCandidatesAgainstRings (pure)", () => {
  it("keeps only medium+ shows, sorted by composite desc", () => {
    const candidates = [recoveryShow(), offTopicShow()];
    fillPurchasePower(candidates);
    const groups = scoreCandidatesAgainstRings(candidates, [makeRing()], makePattern("mid"));
    expect(groups).toHaveLength(1);
    const ids = groups[0].shows.map((s) => s.show.id);
    expect(ids).toContain("discovered-podscan-recovery");
    expect(ids).not.toContain("discovered-podscan-offtopic");
    groups[0].shows.forEach((s) => expect(isMediumOrAbove(s.score.band)).toBe(true));
  });
});

describe("buildDiscoveryBrief", () => {
  it("derives keywords from the CATEGORY only — drops sentence-like attributes + ring labels", () => {
    const brief = buildDiscoveryBrief(
      makePattern("mid"), // category "recovery hardware", key_attributes ["cold plunge","sauna"]
      [makeRing({ label: "endurance athletes" })],
      ["podcast"]
    );
    expect(brief.platforms).toEqual(["podcast"]);
    expect(brief.keywords).toContain("recovery hardware");
    expect(brief.keywords).not.toContain("cold plunge"); // key_attribute → dropped
    expect(brief.keywords).not.toContain("endurance athletes"); // ring label → dropped
    expect(brief.keywords.length).toBeLessThanOrEqual(6);
  });

  it("splits a delimited category (/ & , ;) into clean keyword fragments", () => {
    const brief = buildDiscoveryBrief(
      makePattern("mid", { category: "protein snacks / functional food", key_attributes: [] }),
      [],
      ["podcast"]
    );
    expect(brief.keywords).toEqual(["protein snacks", "functional food"]);
  });

  it("maps product + ring topics into target_interests so category targeting fires", () => {
    const brief = buildDiscoveryBrief(
      makePattern("mid", { category: "protein snacks", key_attributes: [] }),
      [makeRing({ label: "busy parents & family convenience" })],
      ["podcast"]
    );
    expect(brief.target_interests).toContain("Health & Wellness"); // protein
    expect(brief.target_interests).toContain("Parenting & Family"); // parents/family ring
    // every emitted interest is a real Podscan bucket (no near-miss keys)
    for (const i of brief.target_interests) expect(isKnownPodscanInterest(i)).toBe(true);
  });
});

describe("mapTopicsToInterests", () => {
  it("matches buckets by topic keyword, in priority order, capped at 3", () => {
    const got = mapTopicsToInterests(
      "protein nutrition for entrepreneurs and busy parents who love running and cooking"
    );
    expect(got).toContain("Health & Wellness");
    expect(got.length).toBeLessThanOrEqual(3);
    expect(got[0]).toBe("Health & Wellness"); // highest-priority match leads
  });

  it("returns [] when no topic matches (keyword-only fallback)", () => {
    expect(mapTopicsToInterests("zxqw blorptide kelvinate")).toEqual([]);
  });

  it("every rule bucket resolves byte-for-byte in category-mapping (no silent near-miss)", () => {
    for (const rule of INTEREST_TOPIC_RULES) {
      expect(isKnownPodscanInterest(rule.interest), rule.interest).toBe(true);
    }
  });
});

// ============================================================
// Orchestration
// ============================================================

describe("runConvictionDiscovery", () => {
  it("scores a universe across multiple confirmed rings and records one row per (show, ring)", async () => {
    const rings = [
      makeRing({ id: "ring-a", slot_position: 0 }),
      makeRing({ id: "ring-b", slot_position: 1, label: "recovery and cold plunge" }),
    ];
    const { deps, recordCalls, persistCalls, events } = makeDeps({
      discovered: [recoveryShow()],
      rings,
    });

    const result = await runConvictionDiscovery("camp-1", deps);

    // medium+ on both rings → one conviction_scores row per ring.
    expect(recordCalls).toHaveLength(2);
    expect(new Set(recordCalls.map((r) => r.ringHypothesisId))).toEqual(
      new Set(["ring-a", "ring-b"])
    );
    // Show persisted exactly once and the UUID reused across both rings.
    expect(persistCalls).toHaveLength(1);
    expect(new Set(recordCalls.map((r) => r.showId)).size).toBe(1);
    expect(result.keptShowCount).toBe(1);
    expect(result.scoredCount).toBe(2);
    expect(events.map((e) => e.eventType)).toContain("conviction.scored");
  });

  it("honors the medium+ inclusion rule (medium in, below-floor excluded)", async () => {
    const { deps, recordCalls } = makeDeps({
      discovered: [recoveryShow(), offTopicShow()],
      rings: [makeRing()],
    });
    const result = await runConvictionDiscovery("camp-1", deps);

    expect(result.candidateCount).toBe(2); // both discovered, both scored
    const scoredIds = recordCalls.map((r) => r.showId);
    expect(scoredIds).toHaveLength(1); // only the recovery show cleared medium
    const ringShows = result.rings[0].shows.map((s) => s.show.id);
    expect(ringShows).toContain("discovered-podscan-recovery");
    expect(ringShows).not.toContain("discovered-podscan-offtopic");
  });

  it("excludes Sleep / Meditation / ASMR before scoring", async () => {
    const sleep = makeShow({ id: "s-sleep", name: "Sleep With Me", categories: ["Sleep"] });
    const { deps, recordCalls } = makeDeps({
      discovered: [recoveryShow(), sleep],
      rings: [makeRing()],
    });
    const result = await runConvictionDiscovery("camp-1", deps);

    expect(result.candidateCount).toBe(1); // sleep dropped pre-scoring
    expect(recordCalls.every((r) => r.showId !== undefined)).toBe(true);
    const allShownIds = result.rings.flatMap((g) => g.shows.map((s) => s.show.id));
    expect(allShownIds).not.toContain("s-sleep");
  });

  it("dedups a simulcast into one candidate carrying both surfaces", async () => {
    const pod = recoveryShow({ id: "pod-1", name: "Recovery Lab", platform: "podcast" });
    const yt = recoveryShow({
      id: "yt-1",
      name: "Recovery Lab",
      platform: "youtube",
      youtube_channel_id: "UCabc",
    });
    const { deps } = makeDeps({ discovered: [pod, yt], rings: [makeRing()] });
    const result = await runConvictionDiscovery("camp-1", deps);

    expect(result.candidateCount).toBe(1);
    const merged = result.rings[0].shows[0].show;
    expect(merged.surfaces?.youtube?.youtube_channel_id).toBe("UCabc");
  });

  it("returns a response when persistence fails, skipping the score write", async () => {
    const { deps, recordCalls } = makeDeps({
      discovered: [recoveryShow()],
      rings: [makeRing()],
      persistShow: async () => null, // every persist fails
    });
    const result = await runConvictionDiscovery("camp-1", deps);

    expect(recordCalls).toHaveLength(0); // no FK-bound write without a real id
    expect(result.scoredCount).toBe(0); // nothing persisted
    expect(result.keptShowCount).toBe(1); // still kept (medium+) in-memory
    // The in-memory score still surfaces for the brand.
    expect(result.rings[0].shows[0].persistedShowId).toBeNull();
    expect(result.rings[0].shows[0].show.id).toBe("discovered-podscan-recovery");
  });

  it("scores added-by-brand rings (and only the rings the reader returns)", async () => {
    const rings = [
      makeRing({ id: "ring-primary", brand_decision: "confirmed" as BrandDecision }),
      makeRing({
        id: "ring-added",
        brand_decision: "added_by_brand" as BrandDecision,
        slot_position: 1,
      }),
    ];
    const { deps, recordCalls } = makeDeps({ discovered: [recoveryShow()], rings });
    await runConvictionDiscovery("camp-1", deps);
    expect(new Set(recordCalls.map((r) => r.ringHypothesisId))).toEqual(
      new Set(["ring-primary", "ring-added"])
    );
  });

  it("dedups the write when two same-name candidates resolve to one real id (slug collision)", async () => {
    // Two distinct discovered candidates sharing a name → createShow's slug
    // dedup returns the SAME row for both. Only one (show, ring) row must be
    // written, not two.
    const a = recoveryShow({ id: "discovered-podscan-a", name: "Recovery Lab" });
    const b = recoveryShow({ id: "discovered-podscan-b", name: "Recovery Lab" });
    const { deps, recordCalls } = makeDeps({
      discovered: [a, b],
      rings: [makeRing()],
      persistShow: async () => ({ ...(a as Show), id: "uuid-shared" }), // slug collision
    });
    const result = await runConvictionDiscovery("camp-1", deps);
    const rows = recordCalls.filter((r) => r.showId === "uuid-shared");
    expect(rows).toHaveLength(1); // one (show, ring) row, not two
    expect(result.keptShowCount).toBe(1); // collapsed to one distinct real id
  });

  it("generates reasoning in pass and persists it onto the conviction_scores row", async () => {
    // Inject a Layer 4 stand-in that stamps each kept entry the way the real
    // module would (mutate-in-place), and assert the prose reaches recordScore.
    const generateReasoning: ConvictionDiscoveryDeps["generateReasoning"] = async (
      _campaignId,
      groups
    ) => {
      for (const group of groups) {
        for (const entry of group.shows) {
          entry.reasoning = `reasoned:${entry.show.id}:${group.ring.id}`;
        }
      }
    };
    const { deps, recordCalls } = makeDeps({
      discovered: [recoveryShow()],
      rings: [makeRing({ id: "ring-a" })],
      generateReasoning,
    });

    await runConvictionDiscovery("camp-1", deps);

    expect(recordCalls).toHaveLength(1);
    expect(recordCalls[0].reasoning).toBe("reasoned:discovered-podscan-recovery:ring-a");
  });

  it("persists null reasoning when Layer 4 fails soft (left every entry null)", async () => {
    // The real module is fail-soft, but defense-in-depth: even a generator that
    // throws must not abort the run, and the row still writes with null prose.
    const generateReasoning: ConvictionDiscoveryDeps["generateReasoning"] = async () => {
      throw new Error("reasoning blew up");
    };
    const { deps, recordCalls } = makeDeps({
      discovered: [recoveryShow()],
      rings: [makeRing()],
      generateReasoning,
    });

    const result = await runConvictionDiscovery("camp-1", deps);

    expect(result.scoredCount).toBe(1);
    expect(recordCalls).toHaveLength(1);
    expect(recordCalls[0].reasoning).toBeNull();
  });

  it("no regression: a single-ring campaign scores correctly", async () => {
    const { deps, recordCalls } = makeDeps({
      discovered: [recoveryShow()],
      rings: [makeRing()],
    });
    const result = await runConvictionDiscovery("camp-1", deps);
    expect(recordCalls).toHaveLength(1);
    expect(result.rings).toHaveLength(1);
  });

  it("fills purchase power in-memory before scoring (column source, not degraded neutral)", async () => {
    const { deps, recordCalls } = makeDeps({
      discovered: [recoveryShow()], // categories include "business" → high anchor
      rings: [makeRing()],
    });
    await runConvictionDiscovery("camp-1", deps);
    expect(recordCalls[0].purchasePowerScore).toBe(PURCHASE_POWER_SCORE.high);
  });

  it("guards: no pattern → empty result with an error, nothing scored", async () => {
    const { deps, recordCalls } = makeDeps({
      discovered: [recoveryShow()],
      pattern: null,
    });
    const result = await runConvictionDiscovery("camp-1", deps);
    expect(result.campaignPatternId).toBeNull();
    expect(result.rings).toHaveLength(0);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(recordCalls).toHaveLength(0);
  });

  it("guards: no confirmed rings → empty result with an error", async () => {
    const { deps } = makeDeps({ discovered: [recoveryShow()], rings: [] });
    const result = await runConvictionDiscovery("camp-1", deps);
    expect(result.rings).toHaveLength(0);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  // ---- Phase 2C Layer 3: tier-pass wiring ----

  it("runs the tier pass once with the pattern id after scoring persists", async () => {
    const { deps, tierCalls } = makeDeps({
      discovered: [recoveryShow()],
      rings: [makeRing()],
    });
    const result = await runConvictionDiscovery("camp-1", deps);

    expect(result.scoredCount).toBeGreaterThan(0);
    expect(tierCalls).toEqual(["cp-1"]); // exactly once, with pattern.id
  });

  it("skips the tier pass when nothing scored", async () => {
    // offTopic alone never clears medium → scoredCount 0 → no rows to tier.
    const { deps, tierCalls } = makeDeps({
      discovered: [offTopicShow()],
      rings: [makeRing()],
    });
    const result = await runConvictionDiscovery("camp-1", deps);

    expect(result.scoredCount).toBe(0);
    expect(tierCalls).toHaveLength(0);
  });

  it("fail-soft: a throwing tier pass never aborts the scored universe", async () => {
    const { deps } = makeDeps({
      discovered: [recoveryShow()],
      rings: [makeRing()],
      tierPortfolio: async () => {
        throw new Error("tiering blew up");
      },
    });
    // callSafe guards the throw — the run still returns the scored universe.
    const result = await runConvictionDiscovery("camp-1", deps);
    expect(result.scoredCount).toBeGreaterThan(0);
    expect(result.rings.length).toBeGreaterThan(0);
  });

  it("surfaces tier-pass soft errors on the result without aborting", async () => {
    const { deps } = makeDeps({
      discovered: [recoveryShow()],
      rings: [makeRing()],
      tierPortfolio: async (patternId) => ({
        campaignPatternId: patternId,
        testCount: 0,
        scaleCount: 0,
        droppedCount: 0,
        testUnderfilled: true,
        showsClassified: 1,
        persisted: 0,
        errors: ["persist returned false for show x."],
      }),
    });
    const result = await runConvictionDiscovery("camp-1", deps);
    expect(result.scoredCount).toBeGreaterThan(0);
    expect(result.errors).toContain("persist returned false for show x.");
  });
});
