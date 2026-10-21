// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { getNavItemsForRole } from "@/lib/nav/items";

vi.mock("next/font/google", () => ({
  Fraunces: () => ({ variable: "font-display", className: "font-display" }),
  Figtree: () => ({ variable: "font-sans", className: "font-sans" }),
}));

import PreviewClient from "./preview-client";
import { CAMPAIGN, budgetRemaining, formatMoney } from "./sample-data";

beforeEach(() => {
  cleanup();
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockImplementation(() => ({
      matches: true,
      media: "",
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  );
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});

describe("design preview", () => {
  it("opens on the active campaign, matched shows, and budget still open", () => {
    render(<PreviewClient />);

    expect(screen.getByRole("heading", { name: CAMPAIGN.name, level: 1 })).toBeInTheDocument();
    expect(screen.getByText(/6 shows matched/)).toBeInTheDocument();
    expect(screen.getByText(formatMoney(budgetRemaining))).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send outreach" })).toBeEnabled();
    expect(screen.getByRole("meter", { name: "Budget filled" })).toHaveAttribute(
      "aria-valuenow",
      String(CAMPAIGN.filled),
    );
    expect(screen.getAllByRole("img", { name: "Heat Check cover" }).length).toBeGreaterThan(0);
    expect(screen.queryByText(/^0$/)).not.toBeInTheDocument();
  });

  it("locks Ink & Gold and stays out of navigation", () => {
    render(<PreviewClient />);

    expect(document.documentElement.dataset.designPreview).toBe("ink-gold");
    expect(screen.queryByRole("button", { name: "Deep Teal" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Ink & Gold" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Forest" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "HubSpot" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Patreon" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Slack" })).not.toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(/persimmon/i);
    expect(document.body).not.toHaveTextContent(/deep teal/i);
    expect(document.body).not.toHaveTextContent(/forest green/i);

    const hrefs = getNavItemsForRole("brand").map((item) => item.href);
    expect(hrefs).not.toContain("/design-preview");
  });

  it("queues outreach inside the preview and does not claim a send", async () => {
    const user = userEvent.setup();
    render(<PreviewClient />);

    await user.click(screen.getByRole("button", { name: "Send outreach" }));
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("Heat Check");
    expect(dialog).toHaveTextContent("This preview does not email anyone");
    await user.click(screen.getByRole("button", { name: "Queue pitches" }));

    expect(screen.getByRole("button", { name: "Outreach queued", hidden: true })).toBeDisabled();
    expect(document.body).toHaveTextContent("Nothing was sent");
  });
});
