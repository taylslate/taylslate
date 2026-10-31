// @vitest-environment jsdom

import type { ReactElement } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

const mocks = vi.hoisted(() => ({
  getAuthenticatedUser: vi.fn(),
  loadOwnerRosterLink: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));

vi.mock("@/lib/data/queries", () => ({
  getAuthenticatedUser: (...args: unknown[]) => mocks.getAuthenticatedUser(...args),
}));
vi.mock("@/lib/reps/roster-notify", () => ({
  loadOwnerRosterLink: (...args: unknown[]) => mocks.loadOwnerRosterLink(...args),
}));
vi.mock("next/navigation", () => ({
  notFound: () => mocks.notFound(),
}));

import OwnerRosterLinkPage from "./page";
import { OwnerRosterLinkClient } from "./owner-roster-link-client";

const LINK = "11111111-1111-4111-8111-111111111111";

afterEach(() => {
  cleanup();
  mocks.getAuthenticatedUser.mockReset();
  mocks.loadOwnerRosterLink.mockReset();
  mocks.notFound.mockClear();
  vi.unstubAllGlobals();
});

describe("owner roster link page", () => {
  it("404s when nobody is signed in", async () => {
    mocks.getAuthenticatedUser.mockResolvedValue(null);
    await expect(
      OwnerRosterLinkPage({ params: Promise.resolve({ id: LINK }) })
    ).rejects.toThrow("NEXT_NOT_FOUND");
    expect(mocks.notFound).toHaveBeenCalledOnce();
    expect(mocks.loadOwnerRosterLink).not.toHaveBeenCalled();
  });

  it("404s a malformed id without loading the link", async () => {
    mocks.getAuthenticatedUser.mockResolvedValue({ id: "owner-1" });
    await expect(
      OwnerRosterLinkPage({ params: Promise.resolve({ id: "not-a-uuid" }) })
    ).rejects.toThrow("NEXT_NOT_FOUND");
    expect(mocks.notFound).toHaveBeenCalledOnce();
    expect(mocks.loadOwnerRosterLink).not.toHaveBeenCalled();
  });

  it("404s a non-owner the same way it 404s a missing link", async () => {
    mocks.getAuthenticatedUser.mockResolvedValue({ id: "owner-1" });
    mocks.loadOwnerRosterLink.mockResolvedValue({ ok: false });
    await expect(
      OwnerRosterLinkPage({ params: Promise.resolve({ id: LINK }) })
    ).rejects.toThrow("NEXT_NOT_FOUND");
    expect(mocks.loadOwnerRosterLink).toHaveBeenCalledWith(LINK, "owner-1");
    expect(mocks.notFound).toHaveBeenCalledOnce();
  });

  it("shows the show, the rep, and the flag button for a verified owner", async () => {
    mocks.getAuthenticatedUser.mockResolvedValue({ id: "owner-1" });
    mocks.loadOwnerRosterLink.mockResolvedValue({
      ok: true,
      linkId: LINK,
      showId: "show-1",
      showName: "Odd Lots",
      repLabel: "Northwind",
      status: "pending",
      agentId: "agent-1",
    });
    const view = render((await OwnerRosterLinkPage({ params: Promise.resolve({ id: LINK }) })) as ReactElement);
    expect(screen.getByRole("heading", { name: "Odd Lots" })).toBeInTheDocument();
    expect(screen.getByText(/Northwind listed this show/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Flag this to Taylslate" })).toBeInTheDocument();
    expect(view.container.textContent ?? "").not.toContain("\u2014");
    expect(view.container.textContent ?? "").not.toContain("rep-secret@");
    expect(view.container.innerHTML).not.toMatch(/--brand-/);
  });
});

describe("OwnerRosterLinkClient", () => {
  it("posts an optional note and shows the flagged state", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, result: "flagged" }),
    });
    vi.stubGlobal("fetch", fetchMock);
    render(
      <OwnerRosterLinkClient
        linkId={LINK}
        showName="Odd Lots"
        repLabel="Northwind"
        status="pending"
      />
    );
    await user.type(screen.getByLabelText("Note, optional"), "Not my show");
    await user.click(screen.getByRole("button", { name: "Flag this to Taylslate" }));
    expect(fetchMock).toHaveBeenCalledWith(`/api/roster-links/${LINK}/dispute`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ note: "Not my show" }),
    });
    expect(await screen.findByRole("status")).toHaveTextContent("Flagged. Taylslate will review it.");
  });

  it("hides the form when the link was already declined", () => {
    render(
      <OwnerRosterLinkClient
        linkId={LINK}
        showName="Odd Lots"
        repLabel="Northwind"
        status="rejected"
      />
    );
    expect(screen.getByText("This link was already declined.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Flag this to Taylslate" })).not.toBeInTheDocument();
  });
});
