// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

import DocuSignUsageLine from "./docusign-usage-line";

type Usage = {
  used: number;
  limit: number;
  warnAt: number;
  remaining: number;
  state: "ok" | "warn" | "over";
  month: string;
  environment: "production" | "sandbox";
};

function usage(overrides: Partial<Usage>): Usage {
  return {
    used: 0,
    limit: 40,
    warnAt: 35,
    remaining: 40,
    state: "ok",
    month: "October 2026",
    environment: "production",
    ...overrides,
  };
}

function mockFetch(status: number, body: unknown) {
  const fetchMock = vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("DocuSignUsageLine", () => {
  it("shows the muted count below the warning line", async () => {
    const fetchMock = mockFetch(200, usage({ used: 12, remaining: 28, state: "ok" }));

    render(<DocuSignUsageLine />);

    const line = await screen.findByText("12 of 40 DocuSign envelopes used this month");
    expect(line.className).toContain("text-sm");
    expect(line.className).toContain("text-[var(--ts-ink-muted-on-paper)]");
    expect(line.className).not.toContain("border-l-2");
    expect(line.className).not.toContain("font-medium");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("/api/admin/docusign-usage", {
      cache: "no-store",
    });
  });

  it("warns at 36 with the gold border", async () => {
    mockFetch(
      200,
      usage({ used: 36, remaining: 4, state: "warn" }),
    );

    render(<DocuSignUsageLine />);

    const line = await screen.findByText(
      "36 of 40 DocuSign envelopes used this month. 4 left. Sends are not blocked.",
    );
    expect(line.className).toContain("font-medium");
    expect(line.className).toContain("text-[var(--ts-ink-on-paper)]");
    expect(line.className).toContain("border-l-2");
    expect(line.className).toContain("border-[var(--ts-gold)]");
  });

  it("says none left at exactly 40", async () => {
    mockFetch(200, usage({ used: 40, remaining: 0, state: "warn" }));

    render(<DocuSignUsageLine />);

    const line = await screen.findByText(
      "40 of 40 DocuSign envelopes used this month. None left. Sends are not blocked.",
    );
    expect(line.className).toContain("border-[var(--ts-gold)]");
  });

  it("shows the overage line above 40", async () => {
    mockFetch(200, usage({ used: 43, remaining: 0, state: "over" }));

    render(<DocuSignUsageLine />);

    const line = await screen.findByText(
      "43 of 40 DocuSign envelopes used this month. Over the plan allowance. Sends are not blocked. DocuSign sets the overage price.",
    );
    expect(line.className).toContain("border-l-2");
    expect(line.className).toContain("border-[var(--ts-gold)]");
    expect(line.className).toContain("font-medium");
  });

  it("keeps sandbox on the muted line even when the count is high", async () => {
    mockFetch(
      200,
      usage({
        used: 3,
        remaining: 37,
        state: "ok",
        environment: "sandbox",
      }),
    );

    render(<DocuSignUsageLine />);

    const line = await screen.findByText(
      "DocuSign is in sandbox. 3 envelopes this month. Sandbox envelopes do not count against the plan.",
    );
    expect(line.className).toContain("text-[var(--ts-ink-muted-on-paper)]");
    expect(line.className).not.toContain("border-l-2");
  });

  it("does not warn in sandbox when the payload state is over", async () => {
    mockFetch(
      200,
      usage({
        used: 43,
        remaining: 0,
        state: "over",
        environment: "sandbox",
      }),
    );

    render(<DocuSignUsageLine />);

    const line = await screen.findByText(
      "DocuSign is in sandbox. 43 envelopes this month. Sandbox envelopes do not count against the plan.",
    );
    expect(line.className).not.toContain("border-l-2");
    expect(screen.queryByText(/Sends are not blocked/)).not.toBeInTheDocument();
  });

  it("renders nothing for 401 and 403", async () => {
    const fetchMock = mockFetch(403, { error: "Forbidden" });
    const { container } = render(<DocuSignUsageLine />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByText(/DocuSign/)).not.toBeInTheDocument();
  });

  it("shows a muted unavailable line on 500", async () => {
    mockFetch(500, { error: "Could not read DocuSign usage" });

    render(<DocuSignUsageLine />);

    const line = await screen.findByText("DocuSign usage unavailable");
    expect(line.className).toContain("text-[var(--ts-ink-muted-on-paper)]");
    expect(line.className).not.toContain("border-l-2");
  });
});
