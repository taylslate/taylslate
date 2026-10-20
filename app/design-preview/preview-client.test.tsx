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

  it("switches direction tokens without adding the preview to navigation", () => {
    render(<PreviewClient />);

    expect(document.documentElement.dataset.designPreview).toBe("slack");
    expect(screen.getByText(/Dark aubergine sidebar/)).toBeInTheDocument();

    return userEvent.click(screen.getByRole("button", { name: "Patreon" })).then(() => {
      expect(document.documentElement.dataset.designPreview).toBe("patreon");
      expect(screen.getByText(/Warm light field/)).toBeInTheDocument();
    }).then(() => userEvent.click(screen.getByRole("button", { name: "HubSpot" }))).then(() => {
      expect(document.documentElement.dataset.designPreview).toBe("hubspot");
      expect(screen.getByText(/Crisp white cards/)).toBeInTheDocument();
      const hrefs = getNavItemsForRole("brand").map((item) => item.href);
      expect(hrefs).not.toContain("/design-preview");
    });
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
