// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  cleanup,
  within,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import type { ComponentProps } from "react";
import type { BriefInterpretation, InterpretedRing } from "@/lib/data/types";

const { mockPush } = vi.hoisted(() => ({ mockPush: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
}));

import InterpretationClient from "./interpretation-client";

const PRIMARY: InterpretedRing = {
  ring_hypothesis_id: "ring_p",
  ring_label: "protocol recovery",
  confidence: "high",
  reasoning: "The ColdCo playbook on premium recovery hardware.",
  analog_campaigns: ["ColdCo"],
};
const LAT_HIGH: InterpretedRing = {
  ring_hypothesis_id: "ring_h",
  ring_label: "endurance athletes",
  confidence: "high",
  reasoning: "Performance-insurance buyers.",
  analog_campaigns: [],
};
const LAT_SPEC: InterpretedRing = {
  ring_hypothesis_id: "ring_s",
  ring_label: "cold-climate remote workers",
  confidence: "speculative",
  reasoning: "Defensible hypothesis, nothing in the library.",
  analog_campaigns: [],
};

function interp(overrides: Partial<BriefInterpretation> = {}): BriefInterpretation {
  return {
    campaign_pattern_id: "pat_1",
    campaign_pattern: {
      customer_summary: "Affluent men 30-55 already spending on recovery.",
      interpretation_confidence: "high",
      exclusions_parsed: [],
    },
    primary_ring: PRIMARY,
    lateral_rings: [LAT_HIGH, LAT_SPEC],
    ...overrides,
  };
}

function jsonRes(data: unknown, status = 200) {
  return { ok: status < 400, status, json: async () => data };
}

function stubFetch(
  overrides: {
    interpret?: () => unknown;
    refine?: () => unknown;
    addRing?: () => unknown;
    confirm?: () => unknown;
  } = {}
) {
  const fetchMock = vi.fn(async (url: unknown) => {
    const u = String(url);
    if (u.endsWith("/interpret")) return jsonRes(overrides.interpret?.() ?? interp());
    if (u.endsWith("/refine"))
      return jsonRes(
        overrides.refine?.() ?? {
          ring: {
            ring_hypothesis_id: "ring_new",
            ring_label: "van-life & overlanding",
            confidence: "medium",
            reasoning: "Sharper vehicle-based framing.",
            analog_campaigns: [],
          },
        }
      );
    if (u.endsWith("/add-ring"))
      return jsonRes(
        overrides.addRing?.() ?? {
          ring: {
            ring_hypothesis_id: "ring_added",
            ring_label: "busy parents",
            confidence: "medium",
            reasoning: "Convenience buyers.",
            analog_campaigns: [],
          },
        }
      );
    if (u.endsWith("/confirm")) return jsonRes(overrides.confirm?.() ?? { ok: true });
    return jsonRes({ error: "unexpected" }, 500);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function renderClient(
  props: Partial<ComponentProps<typeof InterpretationClient>> = {}
) {
  return render(
    <InterpretationClient
      campaignId="camp_1"
      budgetTotal={25000}
      goals={["test_channel"]}
      prefillUrl="https://saunabox.com"
      initialInterpretation={interp()}
      initialDecisions={null}
      patternEmpty={false}
      {...props}
    />
  );
}

function findCall(fetchMock: ReturnType<typeof vi.fn>, suffix: string) {
  return fetchMock.mock.calls.find(([url]) => String(url).endsWith(suffix));
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("InterpretationClient", () => {
  it("renders the interpretation: customer summary, primary, laterals", () => {
    stubFetch();
    renderClient();
    expect(screen.getByTestId("customer-summary")).toHaveTextContent(
      "Affluent men 30-55"
    );
    expect(screen.getByText("protocol recovery")).toBeInTheDocument();
    expect(screen.getByText("endurance athletes")).toBeInTheDocument();
    expect(screen.getByText("cold-climate remote workers")).toBeInTheDocument();
    // analog citation surfaced on the primary
    expect(screen.getByText("ColdCo")).toBeInTheDocument();
  });

  it("runs a fresh interpretation on first visit (no initial state)", async () => {
    const fetchMock = stubFetch();
    renderClient({ initialInterpretation: null, initialDecisions: null });
    await waitFor(() =>
      expect(screen.getByTestId("customer-summary")).toHaveTextContent(
        "Affluent men 30-55"
      )
    );
    expect(findCall(fetchMock, "/interpret")).toBeTruthy();
  });

  it("pre-selects Include for high/medium and Skip for speculative/low", () => {
    stubFetch();
    renderClient();
    const cards = screen.getAllByTestId("lateral-ring-card");
    expect(
      within(cards[0]).getByRole("button", { name: "Include" })
    ).toHaveAttribute("aria-pressed", "true");
    expect(
      within(cards[1]).getByRole("button", { name: "Skip" })
    ).toHaveAttribute("aria-pressed", "true");
  });

  it("refines the primary ring inline and swaps the ring", async () => {
    const fetchMock = stubFetch();
    const user = userEvent.setup();
    renderClient();

    await user.click(
      screen.getByRole("button", { name: /not quite right/i })
    );
    await user.type(
      screen.getByLabelText(/refine protocol recovery/i),
      "it's really about the protocol nerds"
    );
    await user.click(screen.getByRole("button", { name: "Submit refinement" }));

    await waitFor(() =>
      expect(screen.getByText("van-life & overlanding")).toBeInTheDocument()
    );
    expect(screen.queryByText("protocol recovery")).not.toBeInTheDocument();
    expect(findCall(fetchMock, "/refine")).toBeTruthy();
  });

  it("increments the refinement counter after a submission", async () => {
    stubFetch();
    const user = userEvent.setup();
    renderClient();

    await user.click(screen.getByRole("button", { name: /not quite right/i }));
    await user.type(screen.getByLabelText(/refine protocol recovery/i), "x");
    await user.click(screen.getByRole("button", { name: "Submit refinement" }));
    await waitFor(() =>
      expect(screen.getByText("van-life & overlanding")).toBeInTheDocument()
    );

    // reopen the refine panel — counter now reads 1 of 3
    await user.click(screen.getByRole("button", { name: /not quite right/i }));
    expect(screen.getByText(/1 of 3 refinements/i)).toBeInTheDocument();
  });

  it("shows 'Want to start over?' after 3 refinements on the same ring", async () => {
    stubFetch();
    const user = userEvent.setup();
    renderClient();

    for (let i = 0; i < 3; i++) {
      await user.click(screen.getByRole("button", { name: /not quite right/i }));
      const box = screen.getByLabelText(/refine /i);
      await user.type(box, "again");
      await user.click(screen.getByRole("button", { name: "Submit refinement" }));
      await waitFor(() =>
        expect(
          screen.queryByRole("button", { name: "Submit refinement" })
        ).not.toBeInTheDocument()
      );
    }

    expect(
      screen.getByRole("link", { name: /want to start over/i })
    ).toBeInTheDocument();
  });

  it("adds a ring the brand framed, marked as added", async () => {
    const fetchMock = stubFetch();
    const user = userEvent.setup();
    renderClient();

    await user.click(screen.getByRole("button", { name: /add a ring i missed/i }));
    await user.type(
      screen.getByLabelText("Add a ring I missed"),
      "what about parents?"
    );
    await user.click(screen.getByRole("button", { name: "Add this ring" }));

    await waitFor(() =>
      expect(screen.getByText("busy parents")).toBeInTheDocument()
    );
    expect(screen.getByText(/you added this/i)).toBeInTheDocument();
    expect(findCall(fetchMock, "/add-ring")).toBeTruthy();
  });

  it("confirm posts the correct brand decisions", async () => {
    const fetchMock = stubFetch();
    const user = userEvent.setup();
    renderClient();

    await user.click(
      screen.getByRole("button", {
        name: /confirm interpretation and discover shows/i,
      })
    );

    await waitFor(() => expect(findCall(fetchMock, "/confirm")).toBeTruthy());
    const body = JSON.parse(findCall(fetchMock, "/confirm")![1].body as string);
    expect(body.rings).toEqual(
      expect.arrayContaining([
        { id: "ring_p", decision: "confirmed" },
        { id: "ring_h", decision: "confirmed" },
        { id: "ring_s", decision: "rejected" },
      ])
    );
  });

  it("redirects to the discovery view after confirm", async () => {
    stubFetch();
    const user = userEvent.setup();
    renderClient();
    await user.click(
      screen.getByRole("button", {
        name: /confirm interpretation and discover shows/i,
      })
    );
    await waitFor(() =>
      expect(mockPush).toHaveBeenCalledWith("/campaigns/camp_1")
    );
  });

  it("uses softer copy when the whole interpretation is speculative", () => {
    stubFetch();
    renderClient({
      initialInterpretation: interp({
        campaign_pattern: {
          customer_summary: "Not much to anchor to.",
          interpretation_confidence: "speculative",
          exclusions_parsed: [],
        },
        primary_ring: { ...PRIMARY, confidence: "speculative" },
        lateral_rings: [{ ...LAT_SPEC, confidence: "low" }],
      }),
    });
    expect(screen.getByTestId("customer-summary")).toHaveTextContent(
      /reasoning from first principles/i
    );
    expect(screen.getByTestId("confirm-summary")).toHaveTextContent(
      /small test before scaling/i
    );
  });

  it("disables Confirm while a refine is in flight (Layer 5 amendment)", async () => {
    const fetchMock = vi.fn(async (url: unknown) => {
      const u = String(url);
      // refine never resolves → it stays "in flight" for the assertion
      if (u.endsWith("/refine")) return new Promise(() => {});
      return jsonRes(interp());
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    renderClient();

    const confirm = screen.getByRole("button", {
      name: /confirm interpretation and discover shows/i,
    });
    expect(confirm).toBeEnabled();

    await user.click(screen.getByRole("button", { name: /not quite right/i }));
    await user.type(screen.getByLabelText(/refine protocol recovery/i), "hmm");
    await user.click(screen.getByRole("button", { name: "Submit refinement" }));

    expect(confirm).toBeDisabled();
  });

  it("empty-rings: shows the refresh banner with CTAs disabled and runs no interpret", () => {
    const fetchMock = stubFetch();
    renderClient({
      initialInterpretation: null,
      initialDecisions: null,
      patternEmpty: true,
    });

    expect(screen.getByRole("alert")).toHaveTextContent(
      /couldn.t save the interpretation/i
    );
    expect(
      screen.getByRole("button", {
        name: /confirm interpretation and discover shows/i,
      })
    ).toBeDisabled();
    // no rings → no refine/add controls
    expect(screen.queryByRole("button", { name: /refine/i })).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /add a ring i missed/i })
    ).not.toBeInTheDocument();
    // an existing-but-empty pattern must NOT trigger a fresh interpretation
    expect(findCall(fetchMock, "/interpret")).toBeFalsy();
  });

  it("enforces the 3-refinement cap: the Refine button is disabled after the 3rd", async () => {
    stubFetch();
    const user = userEvent.setup();
    renderClient();

    for (let i = 0; i < 3; i++) {
      await user.click(screen.getByRole("button", { name: /not quite right/i }));
      await user.type(screen.getByLabelText(/refine /i), "again");
      await user.click(screen.getByRole("button", { name: "Submit refinement" }));
      await waitFor(() =>
        expect(
          screen.queryByRole("button", { name: "Submit refinement" })
        ).not.toBeInTheDocument()
      );
    }

    // 4th attempt is blocked at the UI level — the button is disabled.
    expect(
      screen.getByRole("button", { name: /not quite right/i })
    ).toBeDisabled();
  });

  it("aborts an in-flight refine on unmount", async () => {
    const abortSpy = vi.spyOn(AbortController.prototype, "abort");
    const fetchMock = vi.fn(async (url: unknown) => {
      const u = String(url);
      if (u.endsWith("/refine")) return new Promise(() => {}); // never resolves
      return jsonRes(interp());
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    const { unmount } = renderClient();

    await user.click(screen.getByRole("button", { name: /not quite right/i }));
    await user.type(screen.getByLabelText(/refine protocol recovery/i), "hmm");
    await user.click(screen.getByRole("button", { name: "Submit refinement" }));

    unmount();
    expect(abortSpy).toHaveBeenCalled();
    abortSpy.mockRestore();
  });

  it("reload is durable: a refined ring still shows on the second mount", async () => {
    stubFetch();
    const user = userEvent.setup();
    const { unmount } = renderClient();

    // refine the primary, swapping in the new ring
    await user.click(screen.getByRole("button", { name: /not quite right/i }));
    await user.type(screen.getByLabelText(/refine protocol recovery/i), "x");
    await user.click(screen.getByRole("button", { name: "Submit refinement" }));
    await waitFor(() =>
      expect(screen.getByText("van-life & overlanding")).toBeInTheDocument()
    );

    // simulate a reload: the server reconstructs from ring_hypotheses, with
    // the old primary filtered (brand_decision='refined') and the new one live.
    unmount();
    renderClient({
      initialInterpretation: interp({
        primary_ring: {
          ring_hypothesis_id: "ring_new",
          ring_label: "van-life & overlanding",
          confidence: "medium",
          reasoning: "Sharper vehicle-based framing.",
          analog_campaigns: [],
        },
      }),
    });

    expect(screen.getByText("van-life & overlanding")).toBeInTheDocument();
    expect(screen.queryByText("protocol recovery")).not.toBeInTheDocument();
  });
});
