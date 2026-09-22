// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type { MediaPlan, ScoredShowRecord } from "@/lib/data/types";
import MediaPlanBuilder from "./media-plan-builder";

const { mockPush } = vi.hoisted(() => ({
  mockPush: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
}));

const BANNED =
  /--brand-blue|--brand-orange|--brand-navy|--brand-teal|--brand-blue-light|--brand-success|--brand-text|--brand-surface|--brand-border|--brand-warning|--brand-error/;
const ROUNDED = /rounded-xl|rounded-2xl|rounded-full|rounded-lg|rounded-md/;

function show(over: Partial<ScoredShowRecord> = {}): ScoredShowRecord {
  return {
    podcastId: "pod-1",
    name: "The Recovery Lab",
    description: "",
    imageUrl: null,
    websiteUrl: null,
    rssUrl: null,
    categories: [],
    publisherName: "Recovery Co",
    language: "en",
    episodeCount: 40,
    lastPostedAt: null,
    contactEmail: null,
    audienceSize: 100_000,
    prsScore: null,
    compositeScore: 70,
    dimensionScores: {
      audienceFit: 60,
      adEngagement: 50,
      sponsorRetention: 40,
      reach: 30,
    },
    estimatedCpm: 25,
    demographics: null,
    sponsorCount: 0,
    adEngagementRate: null,
    brandSafety: null,
    source: "discover",
    placement: "mid-roll",
    costIsEstimate: true,
    audienceIsEstimate: true,
    ...over,
  };
}

function renderPlan(over: { initialPlan?: MediaPlan | null; shows?: ScoredShowRecord[] } = {}) {
  return render(
    <MediaPlanBuilder
      campaignId="camp-1"
      campaignName="More/Less — September 2026"
      budgetTotal={30000}
      selectedShows={over.shows ?? [show()]}
      initialPlan={over.initialPlan ?? null}
    />
  );
}

function money(n: number): string {
  return `$${Math.round(n).toLocaleString()}`;
}

describe("MediaPlanBuilder — paper/ink", () => {
  beforeEach(() => {
    mockPush.mockReset();
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) })
    );
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("styles the plan in paper and ink and keeps the estimate tag", () => {
    const { container } = renderPlan();

    expect(screen.getByText("For brands")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "More/Less — September 2026" })).toBeInTheDocument();
    expect(
      screen.getByText("Configure placements, episodes, and spacing. Pricing updates as you edit.")
    ).toBeInTheDocument();

    const back = screen.getByRole("button", { name: /back to discovery/i });
    expect(back.className).toContain("text-[var(--ts-ink-muted-on-paper)]");

    const generate = screen.getByRole("button", { name: "Generate IOs" });
    expect(generate.className).toContain("bg-[var(--ts-ink-on-paper)]");
    expect(generate.className).toContain("text-[var(--ts-paper)]");
    expect(generate).toHaveStyle({ borderRadius: "var(--ts-radius)" });

    for (const name of ["Edit shows", "Export CSV"]) {
      const button = screen.getByRole("button", { name });
      expect(button.className).toContain("border-[var(--ts-hairline-on-paper)]");
      expect(button.className).toContain("text-[var(--ts-ink-on-paper)]");
      expect(button.className).not.toMatch(/--brand-blue/);
      expect(button).toHaveStyle({ borderRadius: "var(--ts-radius)" });
    }

    const outreach = screen.getByRole("button", { name: "Send outreach" });
    expect(outreach.className).toContain("text-[var(--ts-accent)]");
    expect(outreach.className).toContain("border-[var(--ts-hairline-on-paper)]");
    expect(outreach.className).not.toMatch(/--brand-blue/);

    const selected = screen.getByRole("button", { name: "Mid-roll" });
    expect(selected).toHaveAttribute("aria-pressed", "true");
    expect(selected.className).toContain("bg-[var(--ts-band-brands)]");
    expect(selected.className).not.toMatch(/--brand-blue/);

    const idle = screen.getByRole("button", { name: "Pre-roll" });
    expect(idle.className).toContain("bg-[var(--ts-paper)]");
    expect(idle.className).not.toContain("bg-[var(--ts-band-brands)]");

    const table = screen.getByRole("table").parentElement;
    expect(table?.className).toContain("border-[var(--ts-hairline-on-paper)]");
    expect(table?.className).toContain("bg-[var(--ts-paper)]");
    expect(table).toHaveStyle({ borderRadius: "var(--ts-radius)" });

    const est = screen.getAllByTestId("plan-estimate")[0];
    expect(est.className).toContain("border-[var(--ts-hairline-on-paper)]");
    expect(est.className).toContain("text-[var(--ts-ink-muted-on-paper)]");
    expect(est).toHaveStyle({ borderRadius: "var(--ts-radius)" });

    expect(container.innerHTML).not.toMatch(BANNED);
    expect(container.innerHTML).not.toMatch(ROUNDED);
    expect(container.innerHTML).not.toMatch(/focus:ring-/);
    expect(container.querySelector(".animate-spin")).toBeNull();
  });

  it("autosaves a single placement change and updates the spend total", async () => {
    // Hold the response so the in-flight "Saving…" state is observable.
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise((resolve) => {
            setTimeout(
              () => resolve({ ok: true, json: async () => ({}) }),
              1000
            );
          })
      )
    );
    renderPlan();

    expect(screen.getAllByText(money(7500)).length).toBeGreaterThan(0);

    fireEvent.change(screen.getByLabelText("Placement for The Recovery Lab"), {
      target: { value: "pre-roll" },
    });

    expect(screen.getAllByText(money(8250)).length).toBeGreaterThan(0);
    expect(screen.queryByText(money(7500))).not.toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(600);
    });

    expect(screen.getByText("Saving…")).toBeInTheDocument();

    const calls = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls as [
      string,
      { method?: string; body?: string },
    ][];
    const planPut = calls.filter(
      (c) => c[0] === "/api/campaigns/plan" && c[1]?.method === "PUT"
    );
    expect(planPut.length).toBe(1);
    const body = JSON.parse(planPut[0][1].body ?? "{}");
    expect(body.campaign_id).toBe("camp-1");
    expect(body.media_plan.default_placement).toBe("mid-roll");
    expect(body.media_plan.line_items).toEqual([
      { podcast_id: "pod-1", placement: "pre-roll", num_episodes: 3 },
    ]);
    expect(calls.some((c) => String(c[0]).includes("generate-ios"))).toBe(false);

    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
  });

  it("returns to discovery and removes a line without generating IOs", async () => {
    renderPlan();

    fireEvent.click(screen.getByRole("button", { name: /back to discovery/i }));
    expect(mockPush).toHaveBeenCalledWith("/campaigns/camp-1");

    fireEvent.click(screen.getByTitle("Remove from plan"));
    expect(screen.getByText(/No shows in the plan/)).toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(600);
    });

    const calls = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls as [
      string,
      { method?: string; body?: string },
    ][];
    const selectionPut = calls.find(
      (c) => c[0] === "/api/campaigns/selections" && c[1]?.method === "PUT"
    );
    expect(selectionPut).toBeTruthy();
    expect(JSON.parse(selectionPut![1].body ?? "{}")).toEqual({
      campaign_id: "camp-1",
      selected_show_ids: [],
    });
    expect(calls.some((c) => String(c[0]).includes("generate-ios"))).toBe(false);
  });
});
