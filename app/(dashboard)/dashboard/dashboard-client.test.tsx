// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    className,
    style,
  }: {
    href: string;
    children: React.ReactNode;
    className?: string;
    style?: React.CSSProperties;
  }) => (
    <a href={href} className={className} style={style}>
      {children}
    </a>
  ),
}));

import DashboardClient from "./dashboard-client";

const BANNED = /--brand-blue|--brand-orange|--brand-navy|--brand-teal|--brand-blue-light|--brand-warning/;

function jsonOk(body: unknown) {
  return Promise.resolve({
    ok: true,
    json: async () => body,
  });
}

function stubDashboardFetch(overrides?: {
  deals?: unknown[];
  invoices?: unknown[];
  campaigns?: unknown[];
  shows?: unknown[];
}) {
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) => {
      if (url.includes("/api/shows")) return jsonOk(overrides?.shows ?? []);
      if (url.includes("/api/deals")) {
        return jsonOk({ deals: overrides?.deals ?? [] });
      }
      if (url.includes("/api/invoices")) {
        return jsonOk({
          invoices: overrides?.invoices ?? [],
          stats: {},
        });
      }
      if (url.includes("/api/campaigns")) {
        return jsonOk({ campaigns: overrides?.campaigns ?? [] });
      }
      return jsonOk({});
    }),
  );
}

beforeEach(() => {
  stubDashboardFetch();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("DashboardClient chrome", () => {
  it("renders brand dashboard on paper/ink with an ink primary action", async () => {
    const { container } = render(<DashboardClient role="brand" />);

    await waitFor(() => {
      expect(
        screen.getByRole("heading", { level: 1, name: "Dashboard" }),
      ).toBeInTheDocument();
    });

    expect(screen.getByText("For brands")).toBeInTheDocument();
    expect(
      screen.getByText("Overview of your campaigns, deals, and invoices."),
    ).toBeInTheDocument();

    const newCampaign = screen.getByRole("link", { name: /new campaign/i });
    expect(newCampaign).toHaveAttribute("href", "/campaigns/new");
    expect(newCampaign.className).toContain("bg-[var(--ts-ink-on-paper)]");
    expect(newCampaign.className).toContain("text-[var(--ts-paper)]");

    expect(screen.getByRole("link", { name: /start a campaign/i })).toHaveAttribute(
      "href",
      "/campaigns/new",
    );

    expect(container.innerHTML).not.toMatch(BANNED);
    expect(container.innerHTML).not.toMatch(/rounded-xl|rounded-2xl/);
  });

  it("restyles the show-role body with the same tokens and keeps show actions", async () => {
    const { container } = render(<DashboardClient role="show" />);

    await waitFor(() => {
      expect(screen.getByText("For shows")).toBeInTheDocument();
    });

    expect(
      screen.getByText("Overview of your shows, deals, and invoices."),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Add Show" })).toHaveAttribute(
      "href",
      "/shows",
    );
    expect(screen.queryByRole("link", { name: /new campaign/i })).toBeNull();
    expect(container.innerHTML).not.toMatch(BANNED);
  });

  it("keeps deal rows and hairline status labels without orange fills", async () => {
    stubDashboardFetch({
      campaigns: [{ id: "c1" }],
      deals: [
        {
          id: "d1",
          status: "planning",
          show_name: "Morning Show",
          num_episodes: 3,
          total_net: 1200,
          created_at: "2026-09-01T00:00:00.000Z",
          updated_at: "2026-09-01T00:00:00.000Z",
        },
      ],
      invoices: [
        {
          id: "i1",
          invoice_number: "INV-1",
          advertiser_name: "Acme",
          total_due: 400,
          status: "sent",
          due_date: "2026-09-20T00:00:00.000Z",
        },
      ],
    });

    const { container } = render(<DashboardClient role="brand" />);

    await waitFor(() => {
      expect(screen.getByText("Morning Show")).toBeInTheDocument();
    });

    expect(screen.getByText("Planning")).toBeInTheDocument();
    expect(screen.getByText("INV-1 — Acme")).toBeInTheDocument();
    expect(screen.getByText("Sent")).toBeInTheDocument();
    expect(container.innerHTML).not.toMatch(BANNED);
    expect(container.innerHTML).not.toMatch(/var\(--brand-orange\)/);
  });
});
