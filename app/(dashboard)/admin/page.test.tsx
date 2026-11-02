// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import type { OpsDashboardData } from "@/lib/admin/ops-dashboard";
import { DEFAULT_OPS_FILTERS } from "@/lib/admin/ops-filters";

const mocks = vi.hoisted(() => ({
  getAuthenticatedUser: vi.fn(),
  isShowsAdmin: vi.fn(),
  loadOpsDashboard: vi.fn(),
  createSupabaseOpsDb: vi.fn(() => ({ select: vi.fn() })),
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));

vi.mock("@/lib/data/queries", () => ({
  getAuthenticatedUser: (...args: unknown[]) => mocks.getAuthenticatedUser(...args),
}));
vi.mock("@/lib/shows/can-edit-show", () => ({
  isShowsAdmin: (...args: unknown[]) => mocks.isShowsAdmin(...args),
}));
vi.mock("@/lib/admin/ops-dashboard", () => ({
  loadOpsDashboard: (...args: unknown[]) => mocks.loadOpsDashboard(...args),
}));
vi.mock("@/lib/admin/ops-db", () => ({
  createSupabaseOpsDb: () => mocks.createSupabaseOpsDb(),
}));
vi.mock("next/navigation", () => ({
  notFound: () => mocks.notFound(),
}));

import AdminOpsPage from "./page";
import { OpsView } from "./ops-view";

const DATA: OpsDashboardData = {
  generatedAt: "2026-11-02T12:00:00.000Z",
  accounts: {
    error: null,
    listError: null,
    counts: [
      { key: "brand", count: 2 },
      { key: "show", count: 1 },
      { key: "agency", count: 1 },
      { key: "agent", count: 0 },
    ],
    signups24h: 1,
    signups7d: 3,
    matched: 1,
    rows: [
      {
        id: "b1",
        email: "ada@brand.test",
        name: "Ada",
        company: "Ada Co",
        role: "brand",
        plan: "starter",
        createdAt: "2026-11-02T01:00:00.000Z",
        managed: true,
      },
    ],
  },
  campaigns: {
    error: null,
    listError: null,
    detailNote: null,
    counts: [
      { key: "draft", count: 0 },
      { key: "planned", count: 0 },
      { key: "active", count: 4 },
      { key: "completed", count: 0 },
      { key: "archived", count: 0 },
    ],
    active: 4,
    matched: 1,
    rows: [
      {
        id: "c1",
        name: "Spring",
        status: "active",
        budget: 1500,
        createdAt: "2026-11-01T00:00:00.000Z",
        ownerEmail: "ada@brand.test",
      },
    ],
  },
  deals: {
    error: null,
    listError: null,
    detailNote: null,
    counts: [{ key: "planning", count: 1 }],
    active: 1,
    matched: 1,
    rows: [
      {
        id: "d1",
        status: "planning",
        createdAt: "2026-11-01T00:00:00.000Z",
        showName: "History Hour",
        brandEmail: "ada@brand.test",
        totalGross: 1200,
      },
    ],
  },
  fees: {
    error: null,
    summary: {
      collectedCents: 1550,
      collectedCount: 2,
      missingFeeCount: 0,
      last30DaysCents: 1550,
      inFlightCents: 0,
      inFlightCount: 0,
      refundedCents: 0,
      refundedCount: 0,
      disputedCents: 0,
      disputedCount: 0,
      failedCount: 0,
      truncated: false,
    },
  },
  youtube: {
    error: null,
    available: true,
    unavailableReason: null,
    total: 10,
    passedMarketFilter: 4,
    added24h: 2,
    added7d: 6,
    emails: [],
    emailNote: "No email column on youtube_channels.",
    queueAvailable: true,
    queueUnavailableReason: null,
    queueByStatus: [
      { key: "pending", count: 3 },
      { key: "done", count: 1 },
      { key: "error", count: 0 },
    ],
  },
  activity: {
    error: null,
    events: [],
    failedPayments: [],
    queueErrors: [
      {
        id: "q1",
        createdAt: "2026-11-01T00:00:00.000Z",
        kind: "seed_channel",
        value: "UCxxxx",
        attempts: 2,
        lastError: "key=[redacted] failed",
      },
    ],
    recentDone: [],
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  process.env.INTERNAL_ADMIN_EMAILS = "chris@taylslate.com";
  mocks.loadOpsDashboard.mockResolvedValue(DATA);
});

afterEach(() => {
  cleanup();
  delete process.env.INTERNAL_ADMIN_EMAILS;
});

describe("/admin gate", () => {
  it("404s when nobody is signed in and does not read", async () => {
    mocks.getAuthenticatedUser.mockResolvedValue(null);
    await expect(AdminOpsPage({ searchParams: Promise.resolve({}) })).rejects.toThrow("NEXT_NOT_FOUND");
    expect(mocks.isShowsAdmin).not.toHaveBeenCalled();
    expect(mocks.loadOpsDashboard).not.toHaveBeenCalled();
    expect(mocks.createSupabaseOpsDb).not.toHaveBeenCalled();
  });

  it("404s for a signed-in brand and does not read", async () => {
    mocks.getAuthenticatedUser.mockResolvedValue({ id: "brand-1", email: "ada@brand.test" });
    mocks.isShowsAdmin.mockResolvedValue(false);
    await expect(AdminOpsPage({ searchParams: Promise.resolve({}) })).rejects.toThrow("NEXT_NOT_FOUND");
    expect(mocks.loadOpsDashboard).not.toHaveBeenCalled();
    expect(mocks.createSupabaseOpsDb).not.toHaveBeenCalled();
  });

  it("reads for the allowlisted founder email", async () => {
    mocks.getAuthenticatedUser.mockResolvedValue({ id: "chris", email: "chris@taylslate.com" });
    render(await AdminOpsPage({ searchParams: Promise.resolve({ role: "show", userQ: "ada" }) }));
    expect(mocks.isShowsAdmin).not.toHaveBeenCalled();
    expect(mocks.loadOpsDashboard).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ role: "show", userQ: "ada" }),
      expect.any(Date),
    );
    expect(screen.getByRole("heading", { name: "Operations" })).toBeInTheDocument();
    expect(screen.getAllByText("ada@brand.test").length).toBeGreaterThan(0);
  });

  it("reads for a profile role of admin that is not on the allowlist", async () => {
    mocks.getAuthenticatedUser.mockResolvedValue({ id: "ops", email: "ops@example.com" });
    mocks.isShowsAdmin.mockResolvedValue(true);
    render(await AdminOpsPage({ searchParams: Promise.resolve({}) }));
    expect(mocks.isShowsAdmin).toHaveBeenCalledWith("ops");
    expect(mocks.loadOpsDashboard).toHaveBeenCalledOnce();
  });
});

describe("OpsView", () => {
  it("shows fees, youtube counts, filters, and no em dash", () => {
    const { container } = render(<OpsView data={DATA} filters={DEFAULT_OPS_FILTERS} />);
    expect(screen.getAllByText("$15.50").length).toBeGreaterThan(0);
    expect(screen.getByText("No email column on youtube_channels.")).toBeInTheDocument();
    expect(screen.getByText("History Hour")).toBeInTheDocument();
    expect(screen.getByText("key=[redacted] failed")).toBeInTheDocument();
    expect(screen.getByLabelText("Search name, email, or company")).toHaveValue("");
    expect(screen.getByLabelText("Status", { selector: "#ops-campaign-status" })).toHaveValue("active");
    expect(screen.getByRole("link", { name: "Managed brands" })).toHaveAttribute("href", "/admin/brands");
    expect(container.textContent).not.toMatch(/[—–]/);
    expect(container.textContent).not.toContain("sk_");
  });
});
