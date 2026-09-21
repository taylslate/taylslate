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

import CampaignsClient from "./campaigns-client";

const BANNED =
  /--brand-blue|--brand-orange|--brand-navy|--brand-teal|--brand-blue-light|--brand-success|--brand-text|--brand-surface|--brand-border|--brand-warning/;

const FLAG_PATH =
  "M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z";
const CHEVRON_PATH = "m9 18 6-6-6-6";

function jsonOk(body: unknown) {
  return Promise.resolve({
    ok: true,
    json: async () => body,
  });
}

function stubCampaigns(campaigns: unknown[]) {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => jsonOk({ campaigns })),
  );
}

beforeEach(() => {
  stubCampaigns([]);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("CampaignsClient", () => {
  it("renders a paper/ink list head and an ink New Campaign link", async () => {
    const { container } = render(<CampaignsClient />);

    await waitFor(() => {
      expect(
        screen.getByRole("heading", { level: 1, name: "Campaigns" }),
      ).toBeInTheDocument();
    });

    expect(screen.getByText("For brands")).toBeInTheDocument();
    expect(
      screen.getByText("Briefs you've opened and the shows you're testing."),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(
        "Plan and manage your podcast and YouTube sponsorship campaigns.",
      ),
    ).toBeNull();

    const cta = screen.getByRole("link", { name: "New Campaign" });
    expect(cta).toHaveAttribute("href", "/campaigns/new");
    expect(cta.className).toContain("bg-[var(--ts-ink-on-paper)]");
    expect(cta.className).toContain("text-[var(--ts-paper)]");
    expect(cta).toHaveStyle({ borderRadius: "var(--ts-radius)" });

    expect(container.innerHTML).not.toMatch(BANNED);
    expect(container.innerHTML).not.toMatch(/rounded-xl|rounded-2xl|rounded-full|rounded-lg/);
    expect(container.innerHTML).not.toMatch(/animate-spin|shadow/);
    expect(container.innerHTML).not.toContain(FLAG_PATH);
    expect(container.innerHTML).not.toContain(CHEVRON_PATH);
  });

  it("lists campaigns as hairline rows that still open /campaigns/[id]", async () => {
    const created = "2026-09-01T15:00:00.000Z";
    stubCampaigns([
      {
        id: "camp-1",
        name: "Sauna Box Spring",
        budget_total: 25000,
        platforms: ["podcast", "youtube"],
        status: "active",
        recommendations: [{}, {}, {}],
        youtube_recommendations: [{}],
        created_at: created,
      },
      {
        id: "camp-2",
        name: "Quiet Draft",
        budget_total: 0,
        platforms: ["podcast"],
        status: "draft",
        recommendations: [],
        created_at: created,
      },
    ]);

    const { container } = render(<CampaignsClient />);

    await waitFor(() => {
      expect(screen.getByText("Sauna Box Spring")).toBeInTheDocument();
    });

    const date = new Date(created).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
    expect(
      screen.getByText(`${date} · podcast + youtube · 4 shows`),
    ).toBeInTheDocument();
    expect(screen.getByText(`${date} · podcast · 0 shows`)).toBeInTheDocument();
    expect(screen.getByText("$25,000")).toBeInTheDocument();
    expect(screen.getByText("Active")).toBeInTheDocument();
    expect(screen.getByText("Draft")).toBeInTheDocument();

    expect(screen.getByRole("link", { name: /Sauna Box Spring/ })).toHaveAttribute(
      "href",
      "/campaigns/camp-1",
    );
    expect(screen.getByRole("link", { name: /Quiet Draft/ })).toHaveAttribute(
      "href",
      "/campaigns/camp-2",
    );

    const active = screen.getByText("Active");
    expect(active.className).toContain("border-[var(--ts-hairline-on-paper)]");
    expect(active).toHaveStyle({ color: "var(--ts-accent)" });
    expect(screen.getByText("Draft")).toHaveStyle({
      color: "var(--ts-ink-muted-on-paper)",
    });

    expect(container.innerHTML).not.toMatch(BANNED);
    expect(container.innerHTML).not.toContain(CHEVRON_PATH);
    expect(container.innerHTML).not.toMatch(/hover:border|hover:shadow/);
  });

  it("renders an empty paper panel with an ink New campaign link", async () => {
    const { container } = render(<CampaignsClient />);

    await waitFor(() => {
      expect(screen.getByText("No campaigns yet")).toBeInTheDocument();
    });

    expect(
      screen.getByText(
        "Tell us what you sell. We come back with a short list of shows worth testing.",
      ),
    ).toBeInTheDocument();

    const emptyCta = screen.getByRole("link", { name: "New campaign" });
    expect(emptyCta).toHaveAttribute("href", "/campaigns/new");
    expect(emptyCta.className).toContain("bg-[var(--ts-ink-on-paper)]");
    expect(emptyCta.className).toContain("text-[var(--ts-paper)]");
    expect(container.innerHTML).not.toMatch(/border-dashed|rounded-2xl/);
    expect(container.innerHTML).not.toContain(FLAG_PATH);
    expect(container.innerHTML).not.toMatch(BANNED);
  });

  it("pulses while loading instead of a blue spinner", () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
    const { container } = render(<CampaignsClient />);

    expect(container.querySelectorAll(".animate-pulse").length).toBeGreaterThan(0);
    expect(container.innerHTML).not.toMatch(/animate-spin|--brand-blue/);
    expect(screen.queryByRole("heading", { name: "Campaigns" })).toBeNull();
  });
});
