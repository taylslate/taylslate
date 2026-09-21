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

const HEART_PATH =
  "M20.42 4.58a5.4 5.4 0 0 0-7.65 0l-.77.78-.77-.78a5.4 5.4 0 0 0-7.65 0C1.46 6.7 1.33 10.28 4 13l8 8 8-8c2.67-2.72 2.54-6.3.42-8.42z";

describe("DashboardClient chrome", () => {
  it("renders a quiet brand dashboard on paper/ink without a second New Campaign", async () => {
    const { container } = render(<DashboardClient role="brand" />);

    await waitFor(() => {
      expect(
        screen.getByRole("heading", { level: 1, name: "Dashboard" }),
      ).toBeInTheDocument();
    });

    expect(screen.getByText("For brands")).toBeInTheDocument();
    expect(
      screen.getByText("Campaigns in motion and deals waiting on a signature."),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Overview of your campaigns, deals, and invoices."),
    ).toBeNull();

    expect(screen.queryByRole("link", { name: /new campaign/i })).toBeNull();
    expect(screen.queryByRole("link", { name: /view deals/i })).toBeNull();
    expect(screen.getByRole("link", { name: /start a campaign/i })).toHaveAttribute(
      "href",
      "/campaigns/new",
    );
    expect(screen.getByRole("link", { name: "View all" })).toHaveAttribute(
      "href",
      "/deals",
    );

    expect(screen.getByText("Campaigns")).toBeInTheDocument();
    expect(screen.getByText("Active Deals")).toBeInTheDocument();
    expect(screen.queryByText("Pipeline")).toBeNull();
    expect(screen.queryByText("Pending Invoices")).toBeNull();
    expect(screen.queryByText("Overdue")).toBeNull();
    expect(screen.queryByText("Revenue (This Mo.)")).toBeNull();

    expect(screen.queryByText("Recent Invoices")).toBeNull();
    expect(screen.queryByText("No invoices yet.")).toBeNull();
    expect(screen.getByText("No deals yet. Send outreach from a campaign to get started.")).toBeInTheDocument();

    expect(container.innerHTML).not.toMatch(BANNED);
    expect(container.innerHTML).not.toMatch(/rounded-xl|rounded-2xl/);
    expect(container.innerHTML).not.toContain(HEART_PATH);
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
    expect(screen.getByText("Pending Invoices")).toBeInTheDocument();
    expect(screen.getByText("Overdue")).toBeInTheDocument();
    expect(screen.getByText("Revenue (This Mo.)")).toBeInTheDocument();
    expect(screen.getByText("Recent Invoices")).toBeInTheDocument();
    expect(screen.getByText("No invoices yet.")).toBeInTheDocument();
    expect(container.innerHTML).not.toMatch(BANNED);
  });

  it("keeps deal rows and hairline status labels without orange fills or heart tiles", async () => {
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
    expect(screen.getByText("Pipeline")).toBeInTheDocument();
    expect(screen.getByText("$1,200")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /new campaign/i })).toBeNull();
    expect(container.innerHTML).not.toMatch(BANNED);
    expect(container.innerHTML).not.toMatch(/var\(--brand-orange\)/);
    expect(container.innerHTML).not.toContain(HEART_PATH);
  });

  it("omits [SEED] deal rows on the brand recent list and uses empty copy when none remain", async () => {
    stubDashboardFetch({
      campaigns: [{ id: "c1" }],
      deals: [
        {
          id: "seed-1",
          status: "planning",
          show_name: "[SEED] Catalog Feed",
          num_episodes: 3,
          total_net: 900,
          created_at: "2026-09-01T00:00:00.000Z",
          updated_at: "2026-09-01T00:00:00.000Z",
        },
        {
          id: "real-1",
          status: "io_sent",
          show_name: "The Real Show",
          num_episodes: 2,
          total_net: 400,
          created_at: "2026-09-02T00:00:00.000Z",
          updated_at: "2026-09-02T00:00:00.000Z",
        },
      ],
    });

    render(<DashboardClient role="brand" />);

    await waitFor(() => {
      expect(screen.getByText("The Real Show")).toBeInTheDocument();
    });

    expect(screen.queryByText("[SEED] Catalog Feed")).toBeNull();
    expect(screen.getByText("IO Sent")).toBeInTheDocument();
  });

  it("shows the existing empty-deals copy when the brand list is only [SEED] rows", async () => {
    stubDashboardFetch({
      campaigns: [{ id: "c1" }],
      deals: [
        {
          id: "seed-1",
          status: "planning",
          show_name: "[SEED] Catalog Feed",
          num_episodes: 3,
          total_net: 900,
          created_at: "2026-09-01T00:00:00.000Z",
          updated_at: "2026-09-01T00:00:00.000Z",
        },
      ],
    });

    render(<DashboardClient role="brand" />);

    await waitFor(() => {
      expect(
        screen.getByText("No deals yet. Send outreach from a campaign to get started."),
      ).toBeInTheDocument();
    });

    expect(screen.queryByText("[SEED] Catalog Feed")).toBeNull();
  });
});
