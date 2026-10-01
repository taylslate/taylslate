// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import type { AircheckReviewView } from "@/lib/airchecks/types";

const refresh = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
}));

import AircheckReviewClient from "./review-client";

const VIEW: AircheckReviewView = {
  ioLineItemId: "li_1",
  showName: "Huberman Lab",
  advertiserName: "Sauna Box",
  brandName: "Sauna Box",
  promoCode: "HUBERMAN",
  url: "https://saunabox.com",
  placement: "mid-roll",
  hasAircheck: true,
  matchResult: "matched",
  excerpt: "brought to you by Sauna Box. Use code HUBERMAN.",
  skipReason: null,
  checks: {
    brand: "found",
    codeOrUrl: "found",
    position: "found",
    length: "missing",
  },
  reviewDecision: null,
  reviewReason: null,
  decidedBy: null,
  decidedAt: null,
  chargeError: null,
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("AircheckReviewClient", () => {
  it("shows the match evidence and both actions", () => {
    render(<AircheckReviewClient view={VIEW} />);
    expect(screen.getByRole("heading", { name: "Huberman Lab" })).toBeInTheDocument();
    expect(screen.getAllByText("Sauna Box")).toHaveLength(2);
    expect(screen.getByText("HUBERMAN")).toBeInTheDocument();
    expect(screen.getByText("mid-roll")).toBeInTheDocument();
    expect(screen.getByText("Matched")).toBeInTheDocument();
    expect(
      screen.getByText("brought to you by Sauna Box. Use code HUBERMAN.")
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confirm" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Reject" })).toBeEnabled();
  });

  it("says when a charge failed and the line is not confirmed", () => {
    render(
      <AircheckReviewClient
        view={{ ...VIEW, chargeError: "card declined" }}
      />
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "The charge failed, so this line is not confirmed. card declined"
    );
    expect(screen.queryByText(/delivered and charged/)).not.toBeInTheDocument();
  });

  it("posts confirm and reject without a second accent class", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, alreadyCharged: false }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const { container } = render(<AircheckReviewClient view={VIEW} />);
    expect(container.innerHTML).not.toMatch(/--brand-/);

    await user.click(screen.getByRole("button", { name: "Confirm" }));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(fetchMock.mock.calls[0][1].body))).toMatchObject({
      ioLineItemId: "li_1",
      decision: "confirm",
    });
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Confirmed. The line is delivered and the charge succeeded."
    );

    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true }),
    });
    await user.type(screen.getByLabelText(/Rejection reason/), "wrong read");
    await user.click(screen.getByRole("button", { name: "Reject" }));
    expect(await screen.findByText("Rejected. Nothing was charged.")).toBeInTheDocument();
    const rejectBody = JSON.parse(String(fetchMock.mock.calls[1][1].body));
    expect(rejectBody).toMatchObject({
      decision: "reject",
      reason: "wrong read",
    });
  });
});
