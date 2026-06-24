// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  cleanup,
  fireEvent,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import type {
  ConvictionScoreRow,
  RingHypothesisRow,
  Show,
} from "@/lib/data/types";
import type {
  ConvictionUniverse,
  ConvictionUniverseGroup,
  ConvictionUniverseShow,
} from "@/lib/data/reasoning-log";
import ConvictionDiscoveryView from "./conviction-discovery-view";

const { mockPush, mockRefresh } = vi.hoisted(() => ({
  mockPush: vi.fn(),
  mockRefresh: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, refresh: mockRefresh }),
}));

// ---- Fixture builders ----

function ring(over: Partial<RingHypothesisRow> = {}): RingHypothesisRow {
  return {
    id: "ring-1",
    campaign_pattern_id: "pat-1",
    created_at: "2026-06-01T00:00:00Z",
    kind: "primary",
    label: "Recovery & cold exposure",
    reasoning: "recovery-minded listeners",
    confidence: "high",
    confidence_score: 80,
    brand_confirmed: true,
    brand_decision: "confirmed",
    slot_position: 0,
    ...over,
  };
}

function score(over: Partial<ConvictionScoreRow> = {}): ConvictionScoreRow {
  return {
    id: "cs-1",
    campaign_pattern_id: "pat-1",
    show_id: "show-1",
    ring_hypothesis_id: "ring-1",
    created_at: "2026-06-01T00:00:00Z",
    audience_fit_score: 50,
    topical_relevance_score: 85,
    purchase_power_score: 70,
    composite_score: 67,
    conviction_band: "medium",
    reasoning: "Probable fit — strong topical overlap with this ring.",
    tier: null,
    ...over,
  };
}

function show(over: Record<string, unknown> = {}): Show {
  return {
    id: "show-1",
    name: "The Recovery Lab",
    categories: ["Health & Wellness", "Recovery"],
    ...over,
  } as unknown as Show;
}

function entry(
  s: ConvictionScoreRow,
  sh: Show | null = show()
): ConvictionUniverseShow {
  return { score: s, show: sh };
}

function universe(
  groups: ConvictionUniverseGroup[],
  hasScores = true
): ConvictionUniverse {
  return { rings: groups.map((g) => g.ring), groups, hasScores };
}

function renderView(over: {
  universe: ConvictionUniverse;
  discoveryRan?: boolean;
}) {
  return render(
    <ConvictionDiscoveryView
      campaignId="camp-1"
      campaignName="Sauna Box Q3"
      budgetTotal={30000}
      universe={over.universe}
      discoveryRan={over.discoveryRan ?? true}
    />
  );
}

beforeEach(() => {
  mockPush.mockReset();
  mockRefresh.mockReset();
  // Default: fetch resolves ok. Trigger tests override.
  global.fetch = vi.fn(async () => ({
    ok: true,
    json: async () => ({ ok: true }),
  })) as unknown as typeof fetch;
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// ============================================================

describe("ConvictionDiscoveryView — scored universe", () => {
  it("renders scored shows grouped by ring, primary first", () => {
    const u = universe([
      { ring: ring(), shows: [entry(score())] },
      {
        ring: ring({ id: "ring-2", kind: "lateral", label: "Home gym builders", slot_position: 1 }),
        shows: [entry(score({ id: "cs-2", show_id: "show-2", ring_hypothesis_id: "ring-2" }), show({ id: "show-2", name: "Garage Gains" }))],
      },
    ]);
    renderView({ universe: u });

    expect(screen.getAllByTestId("ring-group")).toHaveLength(2);
    const headings = screen.getAllByRole("heading", { level: 2 });
    // Primary (slot 0) renders before the lateral (slot 1).
    expect(headings[0]).toHaveTextContent("Recovery & cold exposure");
    expect(headings[1]).toHaveTextContent("Home gym builders");
  });

  it("renders all three sub-scores with audience shown as Unmeasured (no fake bar)", () => {
    renderView({ universe: universe([{ ring: ring(), shows: [entry(score())] }]) });

    const subs = screen.getAllByTestId("sub-score");
    expect(subs).toHaveLength(3);
    expect(screen.getByText("Audience fit")).toBeInTheDocument();
    expect(screen.getByText("Topical relevance")).toBeInTheDocument();
    expect(screen.getByText("Purchase power")).toBeInTheDocument();
    // Audience is unmeasured at launch — rendered as such, not as a 50.
    expect(screen.getByText("Unmeasured")).toBeInTheDocument();
    // Topical + purchase power render their real values.
    expect(screen.getByText("85")).toBeInTheDocument();
    expect(screen.getByText("70")).toBeInTheDocument();
  });

  it("renders conviction band badges", () => {
    const u = universe([
      {
        ring: ring(),
        shows: [
          entry(score({ id: "cs-1", conviction_band: "medium" })),
          entry(
            score({ id: "cs-2", show_id: "show-2", conviction_band: "speculative" }),
            show({ id: "show-2", name: "Late Night Static" })
          ),
        ],
      },
    ]);
    renderView({ universe: u });

    const badges = screen.getAllByTestId("band-badge");
    const texts = badges.map((b) => b.textContent);
    expect(texts).toContain("Medium conviction");
    expect(texts).toContain("Speculative");
  });

  it("filters by ring", async () => {
    const u = universe([
      { ring: ring(), shows: [entry(score())] },
      {
        ring: ring({ id: "ring-2", kind: "lateral", label: "Home gym builders", slot_position: 1 }),
        shows: [entry(score({ id: "cs-2", show_id: "show-2", ring_hypothesis_id: "ring-2" }), show({ id: "show-2", name: "Garage Gains" }))],
      },
    ]);
    renderView({ universe: u });
    expect(screen.getByText("The Recovery Lab")).toBeInTheDocument();
    expect(screen.getByText("Garage Gains")).toBeInTheDocument();

    await userEvent.click(
      screen.getByRole("button", { name: /Home gym builders/ })
    );

    expect(screen.queryByText("The Recovery Lab")).not.toBeInTheDocument();
    expect(screen.getByText("Garage Gains")).toBeInTheDocument();
  });

  it("filters by conviction band", async () => {
    const u = universe([
      {
        ring: ring(),
        shows: [
          entry(score({ id: "cs-1", conviction_band: "medium" })),
          entry(
            score({ id: "cs-2", show_id: "show-2", conviction_band: "speculative" }),
            show({ id: "show-2", name: "Late Night Static" })
          ),
        ],
      },
    ]);
    renderView({ universe: u });
    expect(screen.getByText("The Recovery Lab")).toBeInTheDocument();
    expect(screen.getByText("Late Night Static")).toBeInTheDocument();

    // Band filter chip (a button), not the badge (a span).
    await userEvent.click(screen.getByRole("button", { name: "Speculative" }));

    expect(screen.queryByText("The Recovery Lab")).not.toBeInTheDocument();
    expect(screen.getByText("Late Night Static")).toBeInTheDocument();
  });

  it("renders reasoning prose and a templated fallback the same way", () => {
    const u = universe([
      {
        ring: ring(),
        shows: [
          entry(score({ id: "cs-1", reasoning: "Host personally cold-plunges daily." })),
          entry(
            score({
              id: "cs-2",
              show_id: "show-2",
              // The Layer 4 templated fallback shape.
              reasoning: "Probable fit — strong topical overlap with this ring, high purchase power for this price point.",
            }),
            show({ id: "show-2", name: "Garage Gains" })
          ),
        ],
      },
    ]);
    renderView({ universe: u });

    expect(
      screen.getByText("Host personally cold-plunges daily.")
    ).toBeInTheDocument();
    expect(
      screen.getByText(/strong topical overlap with this ring/)
    ).toBeInTheDocument();
  });

  it("shows softened copy when every show is speculative", () => {
    const u = universe([
      {
        ring: ring({ confidence: "speculative" }),
        shows: [entry(score({ conviction_band: "speculative" }))],
      },
    ]);
    renderView({ universe: u });

    expect(screen.getByText(/still speculative/i)).toBeInTheDocument();
  });

  it("renders a brand-safety notice WITHOUT applying any score penalty (§11)", () => {
    const flagged = entry(
      score({ composite_score: 67, topical_relevance_score: 85, purchase_power_score: 70 }),
      show({ brand_safety: { level: "medium", note: "Explicit language." } })
    );
    renderView({ universe: universe([{ ring: ring(), shows: [flagged] }]) });

    // Notice is surfaced…
    expect(screen.getByTestId("brand-safety-notice")).toBeInTheDocument();
    expect(
      screen.getByText(/does not affect the conviction score/i)
    ).toBeInTheDocument();
    // …and the composite + sub-scores are exactly the row's values, unpenalized.
    expect(screen.getByTestId("composite-score")).toHaveTextContent("67");
    expect(screen.getByText("85")).toBeInTheDocument();
    expect(screen.getByText("70")).toBeInTheDocument();
  });
});

// ============================================================

describe("ConvictionDiscoveryView — not-yet-scored states", () => {
  it("shows an empty state (no re-fire) when discovery ran but kept nothing", () => {
    renderView({
      universe: universe([{ ring: ring(), shows: [] }], false),
      discoveryRan: true,
    });

    expect(
      screen.getByText(/No shows cleared the bar/i)
    ).toBeInTheDocument();
    // Critically, it must NOT auto-fire a fresh 60s run for a known-empty result.
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("auto-fires discovery once on first landing (never run, no scores)", async () => {
    renderView({
      universe: universe([{ ring: ring(), shows: [] }], false),
      discoveryRan: false,
    });

    expect(screen.getByTestId("discovering-state")).toBeInTheDocument();
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
    expect(global.fetch).toHaveBeenCalledWith(
      "/api/campaigns/camp-1/discover",
      expect.objectContaining({ method: "POST" })
    );
  });
});

// ============================================================

describe("ConvictionDiscoveryView — concurrent fire guard", () => {
  it("two synchronous re-run clicks fire discovery only ONCE (in-flight latch)", () => {
    // Deferred fetch that never resolves during the test, so both clicks land
    // while the first POST is still in flight — the concurrent case. A useState
    // guard would let the second click through (stale `false`); the synchronous
    // ref latch must not.
    const fetchMock = vi.fn(() => new Promise(() => {}));
    global.fetch = fetchMock as unknown as typeof fetch;

    renderView({
      universe: universe([{ ring: ring(), shows: [entry(score())] }]),
      discoveryRan: true,
    });

    const button = screen.getByRole("button", { name: /Re-run discovery/i });
    fireEvent.click(button);
    fireEvent.click(button);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
