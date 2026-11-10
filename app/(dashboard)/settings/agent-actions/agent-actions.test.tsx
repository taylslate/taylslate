// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import AgentActionsClient from "./agent-actions-client";

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

const SCRIPT = "<script>alert(1)</script>";
const CAMPAIGN = "dddddddd-dddd-4ddd-8ddd-ddddddddddd1";

function outreachRow() {
  return {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
    kind: "outreach.draft",
    status: "pending",
    created_at: "2026-06-15T15:00:00.000Z",
    decided_at: null,
    decision_note: null,
    executed_at: null,
    result_campaign_id: null,
    execution_error: null,
    key: { name: "Planner", prefix: "0123456789abcdef" },
    summary: {
      type: "outreach",
      show_name: "Visible Show",
      subject: `${SCRIPT} https://evil.example/phish`,
      body: "<img src=x onerror=alert(1)>",
    },
  };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("AgentActionsClient", () => {
  it("renders payload text literally, including a script tag in the subject", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ data: [outreachRow()], next_cursor: null }),
      }))
    );
    const { container } = render(<AgentActionsClient />);
    const subject = await screen.findByText(`${SCRIPT} https://evil.example/phish`);
    expect(subject).toBeInTheDocument();
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector('a[href*="evil.example"]')).toBeNull();
  });

  it("shows the empty state", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ data: [], next_cursor: null }),
      }))
    );
    render(<AgentActionsClient />);
    expect(
      await screen.findByText(
        "Nothing waiting. Actions your API keys propose show up here for you to approve."
      )
    ).toBeInTheDocument();
  });

  it("links an approved campaign and shows Retry for an execution error", async () => {
    const rows = [
      {
        ...outreachRow(),
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2",
        kind: "campaign.create",
        status: "approved",
        result_campaign_id: CAMPAIGN,
        execution_error: null,
        summary: {
          type: "campaign",
          brand_name: "Sauna Box",
          budget_total: 25000,
          goals: "Test the channel",
          flight: "Next 30 days",
        },
      },
      {
        ...outreachRow(),
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3",
        kind: "campaign.create",
        status: "approved",
        result_campaign_id: null,
        execution_error: "The campaign could not be created.",
        summary: {
          type: "campaign",
          brand_name: "Sauna Box",
          budget_total: 25000,
          goals: "Test the channel",
          flight: "Next 30 days",
        },
      },
    ];
    const fetchMock = vi.fn(async (url: string, _init?: RequestInit) => {
      const status = new URL(String(url), "http://localhost").searchParams.get("status");
      return {
        ok: true,
        json: async () => ({
          data: status === "approved" ? rows : [],
          next_cursor: null,
        }),
      };
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<AgentActionsClient />);
    fireEvent.click(await screen.findByRole("tab", { name: "Approved" }));
    const link = await screen.findByRole("link", { name: "Open campaign" });
    expect(link).toHaveAttribute("href", `/campaigns/${CAMPAIGN}`);
    expect(screen.getByText("The campaign could not be created.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => {
      const call = fetchMock.mock.calls.find((item) => {
        const init = item[1] as RequestInit | undefined;
        return init?.method === "POST";
      });
      expect(call?.[0]).toContain("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3");
      expect(JSON.parse(String(call?.[1]?.body))).toEqual({ decision: "retry" });
    });
  });
});
