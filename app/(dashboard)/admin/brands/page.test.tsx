// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

const { getAuthenticatedUser, listManagedBrands } = vi.hoisted(() => ({
  getAuthenticatedUser: vi.fn(),
  listManagedBrands: vi.fn(),
}));

vi.mock("@/lib/data/queries", () => ({
  getAuthenticatedUser: (...args: unknown[]) => getAuthenticatedUser(...args),
}));
vi.mock("@/lib/accounts/managed", () => ({
  listManagedBrands: (...args: unknown[]) => listManagedBrands(...args),
}));

import ManagedBrandsPage from "./page";

beforeEach(() => {
  vi.clearAllMocks();
  process.env.INTERNAL_ADMIN_EMAILS = "ops@taylslate.com";
  listManagedBrands.mockResolvedValue([]);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      throw new Error("usage route should not be called");
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("/admin/brands DocuSign line", () => {
  it("shows only the admin notice to a signed-in non-admin", async () => {
    getAuthenticatedUser.mockResolvedValue({ id: "brand-1", email: "brand@example.com" });

    const { container } = render(await ManagedBrandsPage());

    expect(container.textContent?.replace(/\s+/g, " ").trim()).toBe(
      "This page is for Taylslate admins.",
    );
    expect(screen.queryByText(/DocuSign/)).not.toBeInTheDocument();
    expect(screen.queryByText("Managed brands")).not.toBeInTheDocument();
    expect(listManagedBrands).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    expect(container.innerHTML).toBe(
      '<div class="max-w-2xl p-4 sm:p-8"><p class="text-sm text-[var(--ts-ink-muted-on-paper)]">This page is for Taylslate admins.</p></div>',
    );
  });

  it("places the usage line above the managed brands list for an admin", async () => {
    getAuthenticatedUser.mockResolvedValue({ id: "admin", email: "ops@taylslate.com" });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          used: 12,
          limit: 40,
          warnAt: 35,
          remaining: 28,
          state: "ok",
          month: "October 2026",
          environment: "production",
        }),
      })),
    );

    render(await ManagedBrandsPage());

    const line = await screen.findByText("12 of 40 DocuSign envelopes used this month");
    const heading = screen.getByRole("heading", { name: "Managed brands" });
    expect(
      line.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(listManagedBrands).toHaveBeenCalledTimes(1);
  });
});
