import { describe, it, expect, vi } from "vitest";

// The module statically imports the real event logger (default emit) and LLM
// client, which transitively construct the admin Supabase client at import
// time. Tests inject fakes for callLLM / emit / loadSystemPrompt, so the reals
// never run — stub the admin module so import doesn't require live env. Matches
// the convention in conviction-discovery.test.ts.
vi.mock("@/lib/supabase/admin", () => ({ supabaseAdmin: { from: vi.fn() } }));

import Anthropic from "@anthropic-ai/sdk";
import {
  generateGroupReasoning,
  buildReasoningUserContent,
  templateReasoning,
  REASONING_TOP_N,
  type ReasoningDeps,
} from "./conviction-reasoning";
import type { CallLLMInput } from "@/lib/llm/client";
import type { LogEventInput } from "@/lib/data/events";
import type { ConvictionScore } from "@/lib/scoring/conviction";
import type {
  CampaignPatternRow,
  ConvictionBand,
  RingHypothesisRow,
  Show,
} from "@/lib/data/types";
import type {
  ScoredRingGroup,
  ScoredShowEntry,
} from "./conviction-discovery";

// ---- Fixtures ----

interface DriverOverrides {
  audienceDegraded?: boolean;
  topicalDegraded?: boolean;
  purchaseDegraded?: boolean;
}

function makeScore(
  overrides: Partial<Omit<ConvictionScore, "drivers">> = {},
  drivers: DriverOverrides = {}
): ConvictionScore {
  return {
    audienceFit: 50,
    topicalRelevance: 85,
    purchasePower: 80,
    composite: 70,
    band: "medium",
    weights: { audienceFit: 0.5, topicalRelevance: 0.5, purchasePower: 0 },
    drivers: {
      audienceFit: { degraded: drivers.audienceDegraded ?? true, coverage: 0 },
      topicalRelevance: { degraded: drivers.topicalDegraded ?? false },
      purchasePower: {
        degraded: drivers.purchaseDegraded ?? false,
        source: drivers.purchaseDegraded ? "absent" : "column",
      },
    },
    ...overrides,
  };
}

// Minimal Show — the module reads only id/name/categories/audience_interests.
function makeShow(id: string, overrides: Partial<Show> = {}): Show {
  return {
    id,
    name: `Show ${id}`,
    categories: ["recovery"],
    audience_interests: ["recovery"],
    ...overrides,
  } as unknown as Show;
}

function makeEntry(
  id: string,
  score: ConvictionScore = makeScore(),
  show: Partial<Show> = {}
): ScoredShowEntry {
  return {
    show: makeShow(id, show),
    score,
    persistedShowId: null,
    reasoning: null,
  };
}

function makeRing(overrides: Partial<RingHypothesisRow> = {}): RingHypothesisRow {
  return {
    id: "ring-1",
    campaign_pattern_id: "cp-1",
    label: "protocol-driven recovery",
    reasoning: "host runs recovery protocols personally",
    confidence: "high" as ConvictionBand,
    ...overrides,
  } as unknown as RingHypothesisRow;
}

function makeGroup(
  ring: RingHypothesisRow,
  entries: ScoredShowEntry[]
): ScoredRingGroup {
  return { ring, shows: entries };
}

function makePattern(overrides: Record<string, unknown> = {}): CampaignPatternRow {
  return {
    id: "cp-1",
    campaign_id: "camp-1",
    customer_id: "cust-1",
    created_at: "2026-01-01T00:00:00.000Z",
    product_attributes: { customer_summary: "affluent recovery buyers", ...overrides },
    customer_description: null,
    aov_bucket: "high",
    scoring_weights: null,
  };
}

function llmMessage(text: string, stopReason = "end_turn"): Anthropic.Message {
  return {
    stop_reason: stopReason,
    content: [{ type: "text", text }],
  } as unknown as Anthropic.Message;
}

// ---- DI harness ----

interface ReasoningHarness {
  deps: Partial<ReasoningDeps>;
  calls: CallLLMInput[];
  events: LogEventInput[];
}

function makeDeps(opts: {
  llm?: (input: CallLLMInput) => Promise<Anthropic.Message>;
  topN?: number;
} = {}): ReasoningHarness {
  const calls: CallLLMInput[] = [];
  const events: LogEventInput[] = [];
  const deps: Partial<ReasoningDeps> = {
    callLLM: async (input) => {
      calls.push(input);
      if (opts.llm) return opts.llm(input);
      return llmMessage("{}");
    },
    loadSystemPrompt: () => "system prompt",
    emit: async (e) => {
      events.push(e);
      return null;
    },
    topN: opts.topN,
  };
  return { deps, calls, events };
}

// A response that reasons over a fixed superset of ids; extra keys are ignored
// by the mapper, so one mock covers any subset of these shows.
function sharpResponse(ids: string[]): string {
  const obj: Record<string, string> = {};
  for (const id of ids) obj[id] = `Strong fit for ${id} — covers recovery.`;
  return JSON.stringify(obj);
}

// Substrings that would mean the prose fabricated an audience/demographic claim.
const AUDIENCE_CLAIM =
  /\b(audience|demographic|demographics|age|gender|men|women|male|female|skews?|over[- ]?index|affluen|disposable income)\b/i;

// ============================================================
// Templated fallback (pure)
// ============================================================

describe("templateReasoning", () => {
  it("names the measured drivers (topical + purchase power)", () => {
    const out = templateReasoning(makeEntry("s1"));
    expect(out).toMatch(/topical/i);
    expect(out).toMatch(/purchase power/i);
    expect(out.length).toBeGreaterThan(0);
  });

  it("launch-shape honesty: NEVER asserts an audience claim when audience is degraded", () => {
    // audience degraded (the launch default), topical + PP real.
    const entry = makeEntry(
      "s1",
      makeScore({ band: "high", topicalRelevance: 85, purchasePower: 80 })
    );
    const out = templateReasoning(entry);
    // Mentions the dimensions that DO have signal...
    expect(out).toMatch(/topical/i);
    expect(out).toMatch(/purchase power/i);
    // ...and contains NO fabricated audience/demographic claim.
    expect(out).not.toMatch(AUDIENCE_CLAIM);
  });

  it("references the ring GENERICALLY — the raw label never reaches the template", () => {
    const out = templateReasoning(makeEntry("s1"));
    expect(out).toContain("this ring");
  });

  it("omits a degraded dimension entirely (purchase power UNMEASURED → not named)", () => {
    const entry = makeEntry(
      "s1",
      makeScore({ topicalRelevance: 85 }, { topicalDegraded: false, purchaseDegraded: true })
    );
    const out = templateReasoning(entry);
    expect(out).toMatch(/topical/i);
    expect(out).not.toMatch(/purchase power/i);
  });

  it("falls back to an honest no-signal line when every dimension is degraded", () => {
    const entry = makeEntry(
      "s1",
      makeScore({ band: "speculative" }, { topicalDegraded: true, purchaseDegraded: true })
    );
    const out = templateReasoning(entry);
    expect(out).toMatch(/limited signal/i);
    expect(out).not.toMatch(AUDIENCE_CLAIM);
  });

  it("never throws and degrades to the no-signal line when score.drivers is missing", () => {
    // Defensive: scoreShowConviction always populates drivers, but the
    // fail-soft contract is "never throws" for any input shape.
    const malformed = {
      show: makeShow("s1"),
      score: { band: "low" } as unknown as ConvictionScore, // no drivers
      persistedShowId: null,
      reasoning: null,
    } satisfies ScoredShowEntry;
    expect(() => templateReasoning(malformed)).not.toThrow();
    expect(templateReasoning(malformed)).toMatch(/limited signal/i);
  });
});

// ============================================================
// User-content builder
// ============================================================

describe("buildReasoningUserContent", () => {
  it("includes the ring framing, the show categories, and the MEASURED/UNMEASURED driver flags", () => {
    const entry = makeEntry("s1", makeScore(), { categories: ["recovery", "fitness"] });
    const content = buildReasoningUserContent(
      makeRing(),
      "affluent recovery buyers",
      [entry]
    );
    expect(content).toContain("RING: protocol-driven recovery");
    expect(content).toContain("host runs recovery protocols personally"); // framing
    expect(content).toContain("affluent recovery buyers"); // customer summary
    expect(content).toContain("recovery, fitness"); // categories
    expect(content).toContain("topical relevance 85 MEASURED");
    expect(content).toContain("audience fit UNMEASURED"); // the degraded flag is passed through
    expect(content).toContain("id: s1");
  });
});

// ============================================================
// generateGroupReasoning — happy path
// ============================================================

describe("generateGroupReasoning", () => {
  it("attaches one reasoning string per show from a single batched call", async () => {
    const entries = [makeEntry("a"), makeEntry("b"), makeEntry("c")];
    const group = makeGroup(makeRing(), entries);
    const { deps, calls } = makeDeps({
      llm: async () => llmMessage(sharpResponse(["a", "b", "c"])),
    });

    await generateGroupReasoning("camp-1", [group], makePattern(), deps);

    expect(calls).toHaveLength(1); // ONE call for the ring, not three
    expect(entries[0].reasoning).toBe("Strong fit for a — covers recovery.");
    expect(entries[1].reasoning).toBe("Strong fit for b — covers recovery.");
    expect(entries[2].reasoning).toBe("Strong fit for c — covers recovery.");
  });

  it("calls the LLM once PER RING, not per show", async () => {
    const ringA = makeGroup(makeRing({ id: "ring-a" }), [makeEntry("a1"), makeEntry("a2")]);
    const ringB = makeGroup(makeRing({ id: "ring-b" }), [makeEntry("b1"), makeEntry("b2")]);
    const { deps, calls } = makeDeps({
      llm: async () => llmMessage(sharpResponse(["a1", "a2", "b1", "b2"])),
    });

    await generateGroupReasoning("camp-1", [ringA, ringB], makePattern(), deps);

    expect(calls).toHaveLength(2); // two rings → two calls (not four shows → four)
  });

  it("emits reasoning_generated on success and includes the show metadata in the prompt", async () => {
    const entry = makeEntry("a", makeScore(), { categories: ["recovery"] });
    const group = makeGroup(makeRing(), [entry]);
    const { deps, calls, events } = makeDeps({
      llm: async () => llmMessage(sharpResponse(["a"])),
    });

    await generateGroupReasoning("camp-1", [group], makePattern(), deps);

    expect(entry.reasoning).toBe("Strong fit for a — covers recovery.");
    // Prompt carried the real drivers (degraded flags) + categories.
    expect(calls[0].userContent).toContain("audience fit UNMEASURED");
    expect(calls[0].userContent).toContain("recovery");
    expect(events.map((e) => e.eventType)).toContain("conviction.reasoning_generated");
  });

  it("templates every show in the ring when the LLM THROWS — scores intact, no throw", async () => {
    const entries = [makeEntry("a"), makeEntry("b")];
    const group = makeGroup(makeRing(), entries);
    const { deps, events } = makeDeps({
      llm: async () => {
        throw new Error("network down");
      },
    });

    await expect(
      generateGroupReasoning("camp-1", [group], makePattern(), deps)
    ).resolves.toBeUndefined();

    for (const entry of entries) {
      expect(entry.reasoning).toBeTruthy();
      expect(entry.reasoning).toMatch(/topical/i); // templated from the components
      expect(entry.reasoning).not.toMatch(AUDIENCE_CLAIM);
      expect(entry.score.topicalRelevance).toBe(85); // scores untouched
    }
    expect(events.map((e) => e.eventType)).toContain("conviction.reasoning_failed");
  });

  it("unconditional honesty: a demographically-worded ring label NEVER leaks into the template fallback", async () => {
    // The label carries explicit demographics. On the LLM-down path every show
    // templates — and the template must still be clean of any audience claim,
    // proving the guarantee holds for ANY ring label, not just clean fixtures.
    const ring = makeRing({
      label: "affluent women 35-44, high disposable income recovery buyers",
    });
    const entries = [makeEntry("a"), makeEntry("b")];
    const group = makeGroup(ring, entries);
    const { deps } = makeDeps({
      llm: async () => {
        throw new Error("model down");
      },
    });

    await generateGroupReasoning("camp-1", [group], makePattern(), deps);

    for (const entry of entries) {
      expect(entry.reasoning).toMatch(/topical/i);
      expect(entry.reasoning).not.toMatch(AUDIENCE_CLAIM); // label did not leak
      expect(entry.reasoning).toContain("this ring");
    }
  });

  it("templates on MALFORMED JSON, no throw", async () => {
    const entry = makeEntry("a");
    const group = makeGroup(makeRing(), [entry]);
    const { deps } = makeDeps({ llm: async () => llmMessage("not json {{{") });

    await generateGroupReasoning("camp-1", [group], makePattern(), deps);

    expect(entry.reasoning).toMatch(/topical/i);
  });

  it("templates on a REFUSAL stop_reason (fallback already exhausted), no throw", async () => {
    const entry = makeEntry("a");
    const group = makeGroup(makeRing(), [entry]);
    const { deps } = makeDeps({ llm: async () => llmMessage("", "refusal") });

    await generateGroupReasoning("camp-1", [group], makePattern(), deps);

    expect(entry.reasoning).toMatch(/topical/i);
  });

  it("templates a show MISSING from the response while keeping the ones present", async () => {
    const present = makeEntry("a");
    const missing = makeEntry("b");
    const group = makeGroup(makeRing(), [present, missing]);
    const { deps } = makeDeps({
      llm: async () => llmMessage(sharpResponse(["a"])), // only 'a' keyed
    });

    await generateGroupReasoning("camp-1", [group], makePattern(), deps);

    expect(present.reasoning).toBe("Strong fit for a — covers recovery.");
    expect(missing.reasoning).toMatch(/topical/i); // templated, not left null
    expect(missing.reasoning).not.toMatch(AUDIENCE_CLAIM);
  });

  it("sends only the top-N to the model and templates the tail", async () => {
    const entries = [makeEntry("a"), makeEntry("b"), makeEntry("c"), makeEntry("d")];
    const group = makeGroup(makeRing(), entries);
    const { deps, calls } = makeDeps({
      topN: 2,
      llm: async () => llmMessage(sharpResponse(["a", "b", "c", "d"])),
    });

    await generateGroupReasoning("camp-1", [group], makePattern(), deps);

    expect(calls).toHaveLength(1);
    // Head (first 2) got LLM prose...
    expect(entries[0].reasoning).toBe("Strong fit for a — covers recovery.");
    expect(entries[1].reasoning).toBe("Strong fit for b — covers recovery.");
    // ...tail (beyond N) got the template, and was NOT sent to the model.
    expect(entries[2].reasoning).toMatch(/topical/i);
    expect(entries[3].reasoning).toMatch(/topical/i);
    expect(calls[0].userContent).toContain("id: a");
    expect(calls[0].userContent).toContain("id: b");
    expect(calls[0].userContent).not.toContain("id: c");
    expect(calls[0].userContent).not.toContain("id: d");
  });

  it("makes NO call and NO event for an empty ring, and does not throw", async () => {
    const group = makeGroup(makeRing(), []);
    const { deps, calls, events } = makeDeps();

    await expect(
      generateGroupReasoning("camp-1", [group], makePattern(), deps)
    ).resolves.toBeUndefined();

    expect(calls).toHaveLength(0);
    expect(events).toHaveLength(0);
  });

  it("defaults to REASONING_TOP_N when no topN is injected", () => {
    expect(REASONING_TOP_N).toBeGreaterThan(0);
  });

  // The contract you must be able to trust: EVERY failure mode routes to a
  // non-empty templated string and NOTHING throws — across all rings at once.
  it("every failure mode (throw, refusal, malformed, missing key, beyond-top-N) routes to a template; no path throws", async () => {
    const throwRing = makeGroup(makeRing({ id: "r-throw" }), [makeEntry("t1")]);
    const refusalRing = makeGroup(makeRing({ id: "r-refusal" }), [makeEntry("r1")]);
    const malformedRing = makeGroup(makeRing({ id: "r-malformed" }), [makeEntry("m1")]);
    const missingRing = makeGroup(makeRing({ id: "r-missing" }), [
      makeEntry("k1"),
      makeEntry("k2"),
    ]);
    const tailRing = makeGroup(makeRing({ id: "r-tail" }), [
      makeEntry("n1"),
      makeEntry("n2"),
      makeEntry("n3"),
    ]);

    const deps: Partial<ReasoningDeps> = {
      loadSystemPrompt: () => "system prompt",
      emit: async () => null,
      topN: 1, // forces a templated tail on tailRing
      callLLM: async (input) => {
        if (input.userContent.includes("id: t1")) throw new Error("boom");
        if (input.userContent.includes("id: r1")) return llmMessage("", "refusal");
        if (input.userContent.includes("id: m1")) return llmMessage("}{ broken");
        if (input.userContent.includes("id: k1")) return llmMessage("{}"); // no keys → all missing
        return llmMessage(sharpResponse(["n1"])); // tailRing head only
      },
    };

    const groups = [throwRing, refusalRing, malformedRing, missingRing, tailRing];
    await expect(
      generateGroupReasoning("camp-1", groups, makePattern(), deps)
    ).resolves.toBeUndefined();

    // Every entry across every ring ended with a non-empty reasoning string —
    // nothing left null, nothing threw.
    for (const group of groups) {
      for (const entry of group.shows) {
        expect(typeof entry.reasoning).toBe("string");
        expect((entry.reasoning ?? "").length).toBeGreaterThan(0);
      }
    }
  });
});
