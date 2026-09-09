import { describe, it, expect, vi } from "vitest";

// hydrate-demographics statically imports queries for its default deps, which
// constructs the admin Supabase client at import time. Tests inject fakes —
// stub the module so import doesn't require live env (same convention as
// conviction-discovery.test.ts).
vi.mock("@/lib/supabase/admin", () => ({ supabaseAdmin: { from: vi.fn() } }));

import {
  hydrateCandidateDemographics,
  hasDemographics,
  type HydrateDemographicsDeps,
} from "./hydrate-demographics";
import { PodscanError, type PodscanDemographics } from "@/lib/enrichment/podscan";
import type { Show, ShowDemographics, Platform } from "@/lib/data/types";

// ---- Fixtures ----

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

const STORED_DEMO: ShowDemographics = { age_25_34: 60, male: 55, female: 45 };

const API_PAYLOAD: PodscanDemographics = {
  age_distribution: [
    { age: "25-34", percentage: 70 },
    { age: "35-44", percentage: 30 },
  ],
  gender_skew: "balanced",
};

function makeDeps(opts: {
  rows?: Array<Show & { slug: string }>;
  fetch?: HydrateDemographicsDeps["fetchDemographics"];
  lookupThrows?: boolean;
}) {
  const fetchCalls: string[] = [];
  const deps: HydrateDemographicsDeps = {
    lookupBySlugs: async () => {
      if (opts.lookupThrows) throw new Error("db down");
      return opts.rows ?? [];
    },
    fetchDemographics: async (podscanId) => {
      fetchCalls.push(podscanId);
      if (opts.fetch) return opts.fetch(podscanId);
      return API_PAYLOAD;
    },
  };
  return { deps, fetchCalls };
}

// ---- hasDemographics ----

describe("hasDemographics", () => {
  it("treats {} (the discovered-show default), null, and undefined as empty", () => {
    expect(hasDemographics({})).toBe(false);
    expect(hasDemographics(null)).toBe(false);
    expect(hasDemographics(undefined)).toBe(false);
    expect(hasDemographics({ age_25_34: 60 })).toBe(true);
  });
});

// ---- hydrateCandidateDemographics ----

describe("hydrateCandidateDemographics", () => {
  it("DB-first: a slug-matched row with demographics fills the candidate, no API call", async () => {
    const candidate = makeShow({ name: "Recovery Lab", podscan_id: "pd_1" });
    const { deps, fetchCalls } = makeDeps({
      rows: [
        {
          ...makeShow({ name: "Recovery Lab", demographics: STORED_DEMO }),
          slug: "recovery-lab",
        },
      ],
    });
    const result = await hydrateCandidateDemographics([candidate], deps);
    expect(candidate.demographics).toEqual(STORED_DEMO);
    expect(result.fromDb).toBe(1);
    expect(result.fromApi).toBe(0);
    expect(fetchCalls).toHaveLength(0);
  });

  it("copies a stored podscan_id onto a candidate that lacks one", async () => {
    const candidate = makeShow({ name: "Recovery Lab" });
    const { deps } = makeDeps({
      rows: [
        {
          ...makeShow({
            name: "Recovery Lab",
            podscan_id: "pd_stored",
            demographics: STORED_DEMO,
          }),
          slug: "recovery-lab",
        },
      ],
    });
    await hydrateCandidateDemographics([candidate], deps);
    expect(candidate.podscan_id).toBe("pd_stored");
  });

  it("a stored row with {} demographics does NOT count as DB data — falls through to the API", async () => {
    const candidate = makeShow({ name: "Recovery Lab", podscan_id: "pd_1" });
    const { deps, fetchCalls } = makeDeps({
      rows: [
        { ...makeShow({ name: "Recovery Lab", demographics: {} }), slug: "recovery-lab" },
      ],
    });
    const result = await hydrateCandidateDemographics([candidate], deps);
    expect(fetchCalls).toEqual(["pd_1"]);
    expect(result.fromApi).toBe(1);
    expect(candidate.demographics.age_25_34).toBe(70);
  });

  it("dedups fetches when two candidates share a podscan_id, hydrating both", async () => {
    const a = makeShow({ id: "a", name: "Show A", podscan_id: "pd_shared" });
    const b = makeShow({ id: "b", name: "Show B", podscan_id: "pd_shared" });
    const { deps, fetchCalls } = makeDeps({});
    const result = await hydrateCandidateDemographics([a, b], deps);
    expect(fetchCalls).toEqual(["pd_shared"]);
    expect(result.fromApi).toBe(2);
    expect(a.demographics.age_25_34).toBe(70);
    expect(b.demographics.age_25_34).toBe(70);
  });

  it("skips candidates without a podscan_id and non-podcast platforms", async () => {
    const noId = makeShow({ id: "no-id", name: "No Id" });
    const yt = makeShow({
      id: "yt",
      name: "YT Show",
      platform: "youtube",
      podscan_id: "pd_yt",
    });
    const { deps, fetchCalls } = makeDeps({});
    const result = await hydrateCandidateDemographics([noId, yt], deps);
    expect(fetchCalls).toHaveLength(0);
    expect(result.skipped).toBe(2);
  });

  it("null fetch result (no key / 404) is a skip, not an error", async () => {
    const candidate = makeShow({ podscan_id: "pd_1" });
    const { deps } = makeDeps({ fetch: async () => null });
    const result = await hydrateCandidateDemographics([candidate], deps);
    expect(result.errors).toHaveLength(0);
    expect(result.skipped).toBe(1);
    expect(candidate.demographics).toEqual({});
  });

  it("a payload with no usable sections leaves the candidate unhydrated", async () => {
    const candidate = makeShow({ podscan_id: "pd_1" });
    const { deps } = makeDeps({
      fetch: async () => ({ age_distribution: null, gender_skew: null }),
    });
    const result = await hydrateCandidateDemographics([candidate], deps);
    expect(result.fromApi).toBe(0);
    expect(result.skipped).toBe(1);
  });

  it("circuit-breaks on a 429: one error note, remaining queue unfetched", async () => {
    const candidates = Array.from({ length: 8 }, (_, i) =>
      makeShow({ id: `s${i}`, name: `Show ${i}`, podscan_id: `pd_${i}` })
    );
    const { deps, fetchCalls } = makeDeps({
      fetch: async () => {
        throw new PodscanError("rate limited", 429);
      },
    });
    const result = await hydrateCandidateDemographics(candidates, deps);
    // At most one batch of in-flight workers issued before the break.
    expect(fetchCalls.length).toBeLessThanOrEqual(5);
    expect(fetchCalls.length).toBeLessThan(8);
    expect(
      result.errors.filter((e) => e.includes("rate limit"))
    ).toHaveLength(1);
  });

  it("non-429 fetch failures aggregate into one error note and don't stop the queue", async () => {
    const candidates = Array.from({ length: 3 }, (_, i) =>
      makeShow({ id: `s${i}`, name: `Show ${i}`, podscan_id: `pd_${i}` })
    );
    const { deps, fetchCalls } = makeDeps({
      fetch: async () => {
        throw new Error("boom");
      },
    });
    const result = await hydrateCandidateDemographics(candidates, deps);
    expect(fetchCalls).toHaveLength(3); // every podcast still attempted
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("3 podcast(s)");
    expect(result.errors[0]).toContain("boom");
  });

  it("a throwing DB lookup degrades to API-only hydration with an error note", async () => {
    const candidate = makeShow({ podscan_id: "pd_1" });
    const { deps, fetchCalls } = makeDeps({ lookupThrows: true });
    const result = await hydrateCandidateDemographics([candidate], deps);
    expect(result.errors.some((e) => e.includes("DB lookup failed"))).toBe(true);
    expect(fetchCalls).toEqual(["pd_1"]);
    expect(result.fromApi).toBe(1);
  });

  it("empty candidate pool is a clean no-op", async () => {
    const { deps, fetchCalls } = makeDeps({});
    const result = await hydrateCandidateDemographics([], deps);
    expect(result).toEqual({ fromDb: 0, fromApi: 0, skipped: 0, errors: [] });
    expect(fetchCalls).toHaveLength(0);
  });
});
