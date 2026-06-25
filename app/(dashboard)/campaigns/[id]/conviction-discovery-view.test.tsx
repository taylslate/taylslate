// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  cleanup,
  fireEvent,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import type { RingHypothesisRow, ConvictionScoreRow, Show } from "@/lib/data/types";
import type {
  ConvictionUniverse,
  ConvictionUniverseGroup,
  ConvictionUniverseShow,
} from "@/lib/data/reasoning-log";
import type { TieredShow, TieredUniverse } from "@/lib/discovery/tiered-universe";
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

function show(over: Record<string, unknown> = {}): Show {
  return {
    id: "show-1",
    name: "The Recovery Lab",
    categories: ["Health & Wellness", "Recovery"],
    ...over,
  } as unknown as Show;
}

function tieredShow(over: Partial<TieredShow> = {}): TieredShow {
  return {
    showId: "show-1",
    show: show(),
    ringHypothesisId: "ring-1",
    band: "medium",
    audienceFit: 50,
    topicalRelevance: 85,
    purchasePower: 70,
    composite: 67,
    reasoning: "Probable fit — strong topical overlap with this ring.",
    tier: "test",
    perSpotCents: 88_000, // $880/spot
    threeSpotCents: 264_000, // $2,640 / 3 spots
    cpmUsedCents: 2_200,
    costBasis: "derived",
    isEstimate: true,
    needsQuote: false,
    budgetDeltaCents: null,
    brandSaved: false,
    brandDismissed: false,
    computedOnRead: false,
    ...over,
  };
}

function tieredUniverse(over: Partial<TieredUniverse> = {}): TieredUniverse {
  return {
    test: [],
    scale: [],
    bench: [],
    testBudgetCents: 3_000_000, // $30,000
    testUnderfilled: false,
    hasScores: true,
    ...over,
  };
}

function scoredConvictionUniverse(
  rings: RingHypothesisRow[] = [ring()]
): ConvictionUniverse {
  return { rings, groups: [], hasScores: true };
}

function renderTiered(
  t: Partial<TieredUniverse> = {},
  opts: { selectedShowIds?: string[]; rings?: RingHypothesisRow[] } = {}
) {
  return render(
    <ConvictionDiscoveryView
      campaignId="camp-1"
      campaignName="Sauna Box Q3"
      budgetTotal={30000}
      universe={scoredConvictionUniverse(opts.rings)}
      tiered={tieredUniverse(t)}
      discoveryRan={true}
      selectedShowIds={opts.selectedShowIds ?? []}
    />
  );
}

// ---- not-yet-scored fixtures (unchanged behavior) ----

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
    reasoning: "Probable fit.",
    tier: null,
    per_spot_cents: null,
    three_spot_cents: null,
    cpm_used_cents: null,
    cost_basis: null,
    cost_is_estimate: null,
    needs_quote: null,
    brand_saved: null,
    brand_dismissed: null,
    ...over,
  };
}

function entry(
  s: ConvictionScoreRow,
  sh: Show | null = show()
): ConvictionUniverseShow {
  return { score: s, show: sh };
}

function legacyUniverse(
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

describe("ConvictionDiscoveryView — tiered dual output", () => {
  it("renders test, scale, and bench sections from the partitions", async () => {
    renderTiered({
      test: [tieredShow({ showId: "t1", show: show({ id: "t1", name: "Test Show" }) })],
      scale: [
        tieredShow({
          showId: "s1",
          tier: "scale",
          show: show({ id: "s1", name: "Scale Show" }),
          threeSpotCents: 3_600_000,
          budgetDeltaCents: 2_850_000,
        }),
      ],
      bench: [
        tieredShow({
          showId: "b1",
          tier: "dropped",
          composite: 30,
          band: "speculative",
          show: show({ id: "b1", name: "Bench Show" }),
        }),
      ],
    });

    expect(screen.getByTestId("tier-test")).toBeInTheDocument();
    expect(screen.getByTestId("tier-scale")).toBeInTheDocument();
    expect(screen.getByTestId("tier-bench")).toBeInTheDocument();
    expect(screen.getByText("Test Show")).toBeInTheDocument();
    expect(screen.getByText("Scale Show")).toBeInTheDocument();

    // Bench is collapsed — its shows appear only after expanding.
    expect(screen.queryByText("Bench Show")).not.toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("button", { name: /Other matches \(1\)/ })
    );
    expect(screen.getByText("Bench Show")).toBeInTheDocument();
  });

  it("makes test shows selectable but not scale shows", () => {
    renderTiered({
      test: [tieredShow({ showId: "t1", show: show({ id: "t1", name: "Test Show" }) })],
      scale: [
        tieredShow({ showId: "s1", tier: "scale", show: show({ id: "s1", name: "Scale Show" }) }),
      ],
    });
    // Only the test show carries a checkbox; the scale card has none.
    expect(screen.getAllByRole("checkbox")).toHaveLength(1);
  });

  it("sums selected derived shows in the budget meter and warns when over, excluding flat_fee", () => {
    renderTiered(
      {
        test: [
          tieredShow({ showId: "t1", show: show({ id: "t1", name: "Derived Show" }) }), // $2,640
          tieredShow({
            showId: "t2",
            show: show({ id: "t2", name: "YouTube Show" }),
            costBasis: "flat_fee",
            cpmUsedCents: null,
            perSpotCents: 500_000,
            threeSpotCents: 1_500_000,
          }),
        ],
        testBudgetCents: 200_000, // $2,000 — derived alone ($2,640) blows it
      },
      { selectedShowIds: ["t1", "t2"] }
    );

    const meter = screen.getByTestId("budget-meter");
    // flat_fee is excluded, so the spend is the derived show only.
    expect(within(meter).getByText("$2,640")).toBeInTheDocument();
    expect(screen.getByTestId("budget-warning")).toBeInTheDocument();
  });

  it("promotes a scale show to the test cart with a budget-impact warning", () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    renderTiered({
      scale: [
        tieredShow({
          showId: "s1",
          tier: "scale",
          show: show({ id: "s1", name: "Scale Show" }),
          threeSpotCents: 3_600_000,
          budgetDeltaCents: 2_850_000,
        }),
      ],
    });

    fireEvent.click(screen.getByRole("button", { name: /Move to test/i }));

    expect(confirmSpy).toHaveBeenCalledTimes(1);
    // Fires the promote intent and reflects the cart state.
    expect(global.fetch).toHaveBeenCalledWith(
      "/api/campaigns/camp-1/scale-watchlist",
      expect.objectContaining({ method: "POST" })
    );
    expect(screen.getByText(/Added to test/i)).toBeInTheDocument();
  });

  it("removes a promoted scale show from the cart when it is dismissed", () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    renderTiered({
      scale: [
        tieredShow({ showId: "s1", tier: "scale", show: show({ id: "s1", name: "Scale Show" }) }),
      ],
    });
    const meter = screen.getByTestId("budget-meter");

    fireEvent.click(screen.getByRole("button", { name: /Move to test/i }));
    expect(within(meter).getByText(/1 selected/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /^Dismiss$/i }));
    // Pulled from the cart (count back to 0) and out of the active scale list.
    expect(within(meter).getByText(/0 selected/)).toBeInTheDocument();
    expect(screen.queryByText(/Added to test/i)).not.toBeInTheDocument();
  });

  it("resyncs the cart from props after a refresh (re-run discovery)", () => {
    const { rerender } = renderTiered(
      {
        test: [tieredShow({ showId: "t1", show: show({ id: "t1", name: "Test One" }) })],
      },
      { selectedShowIds: [] }
    );
    expect(screen.getByRole("checkbox")).not.toBeChecked();

    // router.refresh() re-renders the mounted component with fresh server props.
    rerender(
      <ConvictionDiscoveryView
        campaignId="camp-1"
        campaignName="Sauna Box Q3"
        budgetTotal={30000}
        universe={scoredConvictionUniverse()}
        tiered={tieredUniverse({
          test: [tieredShow({ showId: "t1", show: show({ id: "t1", name: "Test One" }) })],
        })}
        discoveryRan={true}
        selectedShowIds={["t1"]}
      />
    );
    expect(screen.getByRole("checkbox")).toBeChecked();
  });

  it("does NOT promote when the brand cancels the warning", () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    renderTiered({
      scale: [
        tieredShow({ showId: "s1", tier: "scale", show: show({ id: "s1", name: "Scale Show" }) }),
      ],
    });
    fireEvent.click(screen.getByRole("button", { name: /Move to test/i }));
    expect(screen.queryByText(/Added to test/i)).not.toBeInTheDocument();
  });

  it("marks derived costs estimated and flat_fee as a quote-to-confirm range", () => {
    renderTiered({
      test: [
        tieredShow({ showId: "t1", show: show({ id: "t1", name: "Derived Show" }) }),
        tieredShow({
          showId: "t2",
          show: show({ id: "t2", name: "YouTube Show" }),
          costBasis: "flat_fee",
          cpmUsedCents: null,
          perSpotCents: 500_000,
          threeSpotCents: 1_500_000,
        }),
      ],
    });

    expect(screen.getByText("estimated")).toBeInTheDocument(); // derived
    expect(screen.getByText("quote to confirm")).toBeInTheDocument(); // flat_fee
    // The flat-fee number is a range, not a precise figure.
    expect(screen.getByText(/~\$.*–\$/)).toBeInTheDocument();
  });

  it("renders the budget delta on scale shows", () => {
    renderTiered({
      scale: [
        tieredShow({
          showId: "s1",
          tier: "scale",
          show: show({ id: "s1", name: "Scale Show" }),
          threeSpotCents: 3_600_000,
          budgetDeltaCents: 2_850_000,
        }),
      ],
    });
    const delta = screen.getByTestId("budget-delta");
    expect(delta).toHaveTextContent(/over the per-show test ceiling/i);
    expect(delta).toHaveTextContent("$28,500");
  });

  it("disables the CTA at 0 selection and enables it once a test show is picked", async () => {
    renderTiered({
      test: [tieredShow({ showId: "t1", show: show({ id: "t1", name: "Test Show" }) })],
    });
    const cta = screen.getByRole("button", { name: /media plan/i });
    expect(cta).toBeDisabled();

    await userEvent.click(screen.getByRole("checkbox"));
    expect(cta).toBeEnabled();
  });

  it("hands off only the selected test ids then navigates to the plan", async () => {
    renderTiered(
      {
        test: [
          tieredShow({ showId: "t1", show: show({ id: "t1", name: "Test One" }) }),
          tieredShow({ showId: "t2", show: show({ id: "t2", name: "Test Two" }) }),
        ],
      },
      { selectedShowIds: ["t1"] }
    );

    await userEvent.click(screen.getByRole("button", { name: /media plan/i }));

    await waitFor(() =>
      expect(mockPush).toHaveBeenCalledWith("/campaigns/camp-1/plan")
    );
    const call = (global.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.find(
      (c) => String(c[0]).endsWith("/plan-handoff")
    );
    expect(call).toBeTruthy();
    expect(JSON.parse((call![1] as RequestInit).body as string)).toEqual({
      showIds: ["t1"],
    });
  });

  it("shows needs_quote bench shows with a 'cost unknown' note, never hidden", async () => {
    renderTiered({
      bench: [
        tieredShow({
          showId: "b1",
          tier: "dropped",
          needsQuote: true,
          costBasis: null,
          perSpotCents: null,
          threeSpotCents: null,
          cpmUsedCents: null,
          show: show({ id: "b1", name: "No Reach Show" }),
        }),
      ],
    });
    await userEvent.click(
      screen.getByRole("button", { name: /Other matches \(1\)/ })
    );
    expect(screen.getByTestId("needs-quote")).toHaveTextContent(
      /cost unknown — quote at outreach/i
    );
  });

  it("renders the tight-budget copy when the test is underfilled", () => {
    // Realistic underfilled: shows scored, but the budget pushed them all to
    // scale (too expensive for a 3-spot test) — so the primary section is empty
    // and the tight-budget copy renders in its place.
    renderTiered({
      test: [],
      testUnderfilled: true,
      scale: [
        tieredShow({ showId: "s1", tier: "scale", show: show({ id: "s1", name: "Pricey Show" }) }),
      ],
    });
    expect(screen.getByTestId("test-underfilled")).toBeInTheDocument();
    expect(screen.getByText(/tight for a full 3-spot test/i)).toBeInTheDocument();
  });

  it("surfaces a brand-safety notice WITHOUT penalizing the score (§11)", () => {
    renderTiered({
      test: [
        tieredShow({
          showId: "t1",
          composite: 67,
          show: show({
            id: "t1",
            name: "Edgy Show",
            brand_safety: { level: "medium", note: "Explicit language." },
          }),
        }),
      ],
    });
    expect(screen.getByTestId("brand-safety-notice")).toBeInTheDocument();
    expect(screen.getByTestId("composite-score")).toHaveTextContent("67");
  });
});

// ============================================================

describe("ConvictionDiscoveryView — not-yet-scored states", () => {
  it("shows an empty state (no re-fire) when discovery ran but kept nothing", () => {
    renderView({
      universe: legacyUniverse([{ ring: ring(), shows: [] }], false),
      discoveryRan: true,
    });

    expect(screen.getByText(/No shows cleared the bar/i)).toBeInTheDocument();
    // Critically, it must NOT auto-fire a fresh 60s run for a known-empty result.
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("auto-fires discovery once on first landing (never run, no scores)", async () => {
    renderView({
      universe: legacyUniverse([{ ring: ring(), shows: [] }], false),
      discoveryRan: false,
    });

    expect(screen.getByTestId("discovering-state")).toBeInTheDocument();
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
    expect(global.fetch).toHaveBeenCalledWith(
      "/api/campaigns/camp-1/discover",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("shows a soft notice (no re-fire) when the server returns 409 (another tab running)", async () => {
    global.fetch = vi.fn(async () => ({
      ok: false,
      status: 409,
      json: async () => ({ code: "discovery_in_progress" }),
    })) as unknown as typeof fetch;

    renderView({
      universe: legacyUniverse([{ ring: ring(), shows: [] }], false),
      discoveryRan: false,
    });

    await waitFor(() =>
      expect(screen.getByText(/may be open in another tab/i)).toBeInTheDocument()
    );
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});

// ============================================================

describe("ConvictionDiscoveryView — concurrent fire guard", () => {
  it("two synchronous re-run clicks fire discovery only ONCE (in-flight latch)", () => {
    const fetchMock = vi.fn(() => new Promise(() => {}));
    global.fetch = fetchMock as unknown as typeof fetch;

    renderTiered({
      test: [tieredShow()],
    });

    const button = screen.getByRole("button", { name: /Re-run discovery/i });
    fireEvent.click(button);
    fireEvent.click(button);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
