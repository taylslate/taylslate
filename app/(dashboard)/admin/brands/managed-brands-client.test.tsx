// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import type { ManagedBrandRow } from "@/lib/accounts/managed";

import ManagedBrandsClient from "./managed-brands-client";

const brands: ManagedBrandRow[] = [
  {
    id: "11111111-1111-4111-8111-111111111111",
    email: "chris+brand1@taylslate.com",
    name: "Sauna Box",
    isManaged: true,
  },
  {
    id: "22222222-2222-4222-8222-222222222222",
    email: "other@brand.com",
    name: "Other Brand",
    isManaged: false,
  },
];

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("ManagedBrandsClient handoff", () => {
  it("confirms the brand name and both emails, then posts the handoff", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        id: brands[0].id,
        email: "owner@saunabox.com",
        isManaged: false,
        emailSent: true,
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<ManagedBrandsClient brands={brands} />);

    expect(screen.getAllByRole("button", { name: "Hand off" })).toHaveLength(1);

    await user.click(screen.getByRole("button", { name: "Hand off" }));
    await user.type(screen.getByLabelText("New owner email"), "Owner@SaunaBox.com");
    await user.click(screen.getByRole("button", { name: "Continue" }));

    expect(
      screen.getByText(
        "Hand Sauna Box from chris+brand1@taylslate.com to owner@saunabox.com?",
      ),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Confirm handoff" }));

    expect(fetchMock).toHaveBeenCalledWith(
      `/api/admin/managed-brands/${brands[0].id}/handoff`,
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ email: "owner@saunabox.com" }),
      }),
    );
    expect(await screen.findByText("Sign-in link sent to owner@saunabox.com.")).toBeInTheDocument();
    expect(screen.getByText("owner@saunabox.com")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Hand off" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Mark managed" })).toHaveLength(2);
  });

  it("shows the server error and leaves the row managed", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({ error: "That email already belongs to another account" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<ManagedBrandsClient brands={brands} />);
    await user.click(screen.getByRole("button", { name: "Hand off" }));
    await user.type(screen.getByLabelText("New owner email"), "taken@brand.com");
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await user.click(screen.getByRole("button", { name: "Confirm handoff" }));

    expect(
      await screen.findByRole("alert"),
    ).toHaveTextContent("That email already belongs to another account");
    expect(screen.getByText("chris+brand1@taylslate.com")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Managed" })).toBeInTheDocument();
  });
});
