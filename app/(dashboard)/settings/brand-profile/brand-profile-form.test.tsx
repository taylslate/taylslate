// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type { BrandProfile } from "@/lib/data/types";
import BrandProfileForm from "./brand-profile-form";

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

function makeProfile(overrides: Partial<BrandProfile> = {}): BrandProfile {
  return {
    id: "bp1",
    user_id: "u1",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    brand_name: "AG1",
    brand_identity: "We make portable saunas.",
    brand_website: "https://saunabox.com",
    target_customer: "Founders 30-45",
    ...overrides,
  };
}

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ brand_profile: { brand_name: "SaunaBox" } }),
    }))
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("BrandProfileForm", () => {
  it("renders the stored brand_name", () => {
    render(<BrandProfileForm profile={makeProfile({ brand_name: "AG1" })} />);
    expect(screen.getByLabelText("Brand name")).toHaveValue("AG1");
  });

  it("PUTs the edited brand_name through /api/brand-profile", async () => {
    render(<BrandProfileForm profile={makeProfile({ brand_name: "AG1" })} />);
    const input = screen.getByLabelText("Brand name");
    fireEvent.change(input, { target: { value: "  SaunaBox  " } });
    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() => expect(fetch).toHaveBeenCalled());
    const [, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(init.method).toBe("PUT");
    const body = JSON.parse(init.body as string);
    expect(body.brand_name).toBe("SaunaBox");
  });

  it("rejects an empty brand name without calling the API", () => {
    render(<BrandProfileForm profile={makeProfile({ brand_name: "AG1" })} />);
    fireEvent.change(screen.getByLabelText("Brand name"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));
    expect(screen.getByText("Brand name is required.")).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects a whitespace-only brand name without calling the API", () => {
    render(<BrandProfileForm profile={makeProfile({ brand_name: "AG1" })} />);
    fireEvent.change(screen.getByLabelText("Brand name"), { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));
    expect(screen.getByText("Brand name is required.")).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });
});
