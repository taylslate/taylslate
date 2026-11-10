// @vitest-environment jsdom

import type { ReactElement } from "react";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import type { PendingRosterRequest } from "@/lib/reps/roster-review";

const mocks = vi.hoisted(() => ({
  getAuthenticatedUser: vi.fn(),
  isShowsAdmin: vi.fn(),
  listPendingRosterLinks: vi.fn(),
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
vi.mock("@/lib/reps/roster-review", () => ({
  listPendingRosterLinks: (...args: unknown[]) => mocks.listPendingRosterLinks(...args),
}));
vi.mock("next/navigation", () => ({
  notFound: () => mocks.notFound(),
}));

import RosterRequestsPage from "./page";
import { RosterRequestsClient } from "./roster-requests-client";

const clean: PendingRosterRequest = {
  id: "rel-clean",
  agentId: "agent-1",
  agentEmail: "lena@example.com",
  showId: "show-1",
  showName: "Odd Lots",
  discoverable: false,
  source: "import",
  isExclusive: true,
  createdAt: "2026-03-02T00:00:00Z",
  showAgentId: "agent-1",
  showAgentDiffers: false,
  otherLinks: [],
  exclusiveConflict: false,
  disputedByOwner: false,
  status: "pending",
};

const conflict: PendingRosterRequest = {
  id: "rel-conflict",
  agentId: "agent-2",
  agentEmail: "northwind@example.com",
  showId: "show-2",
  showName: "The Rewatchables",
  discoverable: true,
  source: "claim",
  isExclusive: true,
  createdAt: "2026-03-01T00:00:00Z",
  showAgentId: "agent-9",
  showAgentDiffers: true,
  otherLinks: [
    {
      id: "rel-held",
      agentId: "agent-9",
      agentEmail: "held@example.com",
      status: "approved",
      source: "admin",
      isExclusive: true,
    },
  ],
  exclusiveConflict: true,
  disputedByOwner: false,
  status: "pending",
};

const disputed: PendingRosterRequest = {
  ...clean,
  id: "rel-disputed",
  showId: "show-3",
  showName: "Acquired",
  agentEmail: "ada@example.com",
  isExclusive: false,
  disputedByOwner: true,
};

afterEach(() => {
  cleanup();
  mocks.getAuthenticatedUser.mockReset();
  mocks.isShowsAdmin.mockReset();
  mocks.listPendingRosterLinks.mockReset();
  mocks.notFound.mockClear();
  vi.unstubAllGlobals();
});

function expectNoEmDash(container: HTMLElement) {
  expect(container.textContent ?? "").not.toContain("\u2014");
  expect(container.innerHTML).not.toContain("\u2014");
  expect(container.innerHTML).not.toMatch(/--brand-/);
}

describe("roster requests page", () => {
  it("404s when nobody is signed in", async () => {
    mocks.getAuthenticatedUser.mockResolvedValue(null);
    await expect(RosterRequestsPage()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(mocks.notFound).toHaveBeenCalledOnce();
    expect(mocks.isShowsAdmin).not.toHaveBeenCalled();
    expect(mocks.listPendingRosterLinks).not.toHaveBeenCalled();
  });

  it("404s for a signed-in user who is not a shows admin", async () => {
    mocks.getAuthenticatedUser.mockResolvedValue({ id: "brand-1", email: "brand@example.com" });
    mocks.isShowsAdmin.mockResolvedValue(false);
    await expect(RosterRequestsPage()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(mocks.isShowsAdmin).toHaveBeenCalledWith("brand-1");
    expect(mocks.listPendingRosterLinks).not.toHaveBeenCalled();
  });

  it("renders pending links for a shows admin", async () => {
    mocks.getAuthenticatedUser.mockResolvedValue({ id: "admin-1" });
    mocks.isShowsAdmin.mockResolvedValue(true);
    mocks.listPendingRosterLinks.mockResolvedValue([clean]);
    const view = render((await RosterRequestsPage()) as ReactElement);
    expect(screen.getByRole("heading", { name: "Roster requests" })).toBeInTheDocument();
    expect(screen.getByText("Odd Lots")).toBeInTheDocument();
    expect(screen.getByText(/lena@example.com/)).toBeInTheDocument();
    expectNoEmDash(view.container);
  });
});

describe("RosterRequestsClient", () => {
  it("shows an empty pending list", () => {
    const view = render(<RosterRequestsClient links={[]} />);
    expect(screen.getByTestId("roster-pending-count")).toHaveTextContent("0 pending");
    expect(screen.getByTestId("roster-requests-empty")).toHaveTextContent(
      "No pending roster requests."
    );
    expectNoEmDash(view.container);
    expect(view.container.querySelector("h1")?.className).toContain("font-app-display");
  });

  it("shows a pending row and approves it without a confirm step", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: "rel-clean", show_id: "show-1", status: "approved" }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const view = render(<RosterRequestsClient links={[clean]} />);
    expect(screen.getByText(/lena@example.com/)).toHaveTextContent("Import");
    expect(screen.getByText("Not discoverable")).toBeInTheDocument();
    expect(screen.getByText("Exclusive")).toBeInTheDocument();
    expect(screen.getByText(/Approving makes the show discoverable/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Approve Odd Lots" }));
    expect(fetchMock).toHaveBeenCalledWith("/api/admin/roster-links/rel-clean", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "approve" }),
    });
    expect(await screen.findByRole("status")).toHaveTextContent("Approved Odd Lots.");
    expect(screen.queryByTestId("roster-request")).not.toBeInTheDocument();
    expectNoEmDash(view.container);
  });

  it("asks before approving a conflict and rejects only with a note", async () => {
    const user = userEvent.setup();
    let resolveFetch: (value: unknown) => void = () => undefined;
    const fetchMock = vi.fn().mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveFetch = resolve;
        })
    );
    vi.stubGlobal("fetch", fetchMock);
    const view = render(<RosterRequestsClient links={[conflict]} />);
    expect(screen.getByTestId("exclusive-conflict")).toHaveTextContent("held@example.com");
    expect(screen.getByText(/does not make the show discoverable/)).toBeInTheDocument();
    expect(screen.getByText("Discoverable")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Approve The Rewatchables" }));
    expect(fetchMock).not.toHaveBeenCalled();
    const approveDialog = screen.getByTestId("approve-dialog");
    expect(approveDialog).toHaveTextContent("Approve with a conflict?");
    await user.click(within(approveDialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByTestId("approve-dialog")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Reject The Rewatchables" }));
    const rejectDialog = screen.getByTestId("reject-dialog");
    const submit = within(rejectDialog).getByRole("button", { name: "Reject The Rewatchables" });
    expect(submit).toBeDisabled();
    expect(fetchMock).not.toHaveBeenCalled();
    await user.type(within(rejectDialog).getByLabelText("Note"), "Host already has an exclusive.");
    expect(submit).toBeEnabled();
    await user.click(submit);
    await waitFor(() => {
      expect(view.container.querySelector(".animate-spin")).not.toBeNull();
    });
    expect(fetchMock).toHaveBeenCalledWith("/api/admin/roster-links/rel-conflict", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "reject", note: "Host already has an exclusive." }),
    });
    resolveFetch({
      ok: true,
      json: async () => ({ id: "rel-conflict", status: "rejected" }),
    });
    expect(await screen.findByRole("status")).toHaveTextContent("Rejected The Rewatchables.");
    expectNoEmDash(view.container);
  });

  it("approves a conflict only after confirm", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: "rel-conflict", show_id: "show-2", status: "approved" }),
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<RosterRequestsClient links={[conflict]} />);
    await user.click(screen.getByRole("button", { name: "Approve The Rewatchables" }));
    const dialog = screen.getByTestId("approve-dialog");
    await user.click(
      within(dialog).getByRole("button", { name: "Approve The Rewatchables anyway" })
    );
    expect(fetchMock).toHaveBeenCalledWith("/api/admin/roster-links/rel-conflict", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "approve" }),
    });
    expect(await screen.findByRole("status")).toHaveTextContent("Approved The Rewatchables.");
  });

  it("shows the pending count and a disputed badge from the loaded rows", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: "rel-clean", status: "approved" }),
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<RosterRequestsClient links={[clean, disputed]} />);
    expect(screen.getByTestId("roster-pending-count")).toHaveTextContent("2 pending");
    const rows = screen.getAllByTestId("roster-request");
    expect(within(rows[0]).queryByTestId("disputed-by-owner")).not.toBeInTheDocument();
    expect(within(rows[1]).getByTestId("disputed-by-owner")).toHaveTextContent("Disputed by owner");
    await user.click(screen.getByRole("button", { name: "Approve Odd Lots" }));
    expect(await screen.findByTestId("roster-pending-count")).toHaveTextContent("1 pending");
    expect(screen.getByTestId("disputed-by-owner")).toBeInTheDocument();
  });

  it("blocks approve on a disputed row and re-enables it after resolve", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, resolved_count: 1 }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const view = render(<RosterRequestsClient links={[clean, disputed]} />);
    const rows = screen.getAllByTestId("roster-request");
    expect(within(rows[0]).queryByTestId("dispute-blocked")).not.toBeInTheDocument();
    expect(within(rows[0]).queryByRole("button", { name: /Resolve dispute/ })).not.toBeInTheDocument();
    expect(within(rows[0]).getByRole("button", { name: "Approve Odd Lots" })).toBeEnabled();

    const blocked = within(rows[1]);
    expect(blocked.getByTestId("dispute-blocked")).toHaveTextContent(
      "Approval is blocked while the owner's dispute is open. Resolve it first."
    );
    expect(blocked.getByRole("button", { name: "Approve Acquired" })).toBeDisabled();
    expect(blocked.getByRole("button", { name: "Reject Acquired" })).toBeEnabled();

    await user.click(blocked.getByRole("button", { name: "Resolve dispute for Acquired" }));
    const dialog = screen.getByTestId("resolve-dialog");
    const submit = within(dialog).getByRole("button", { name: "Resolve dispute for Acquired" });
    expect(submit).toBeDisabled();
    await user.type(within(dialog).getByLabelText("Note"), "Reviewed with the owner.");
    expect(within(dialog).getByText("24 / 500")).toBeInTheDocument();
    expect(submit).toBeEnabled();
    await user.click(submit);
    expect(fetchMock).toHaveBeenCalledWith("/api/admin/roster-links/rel-disputed", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "resolve_dispute", note: "Reviewed with the owner." }),
    });
    expect(await screen.findByRole("status")).toHaveTextContent("Resolved the dispute on Acquired.");
    expect(screen.queryByTestId("disputed-by-owner")).not.toBeInTheDocument();
    expect(screen.queryByTestId("dispute-blocked")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Approve Acquired" })).toBeEnabled();
    expect(screen.getByTestId("roster-pending-count")).toHaveTextContent("2 pending");
    expect(screen.getAllByTestId("roster-request")).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Approve Odd Lots" })).toBeEnabled();
    expectNoEmDash(view.container);
  });

  it("shows a resolve 409 in the page alert and leaves the dispute open", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({ error: "No open dispute on this link." }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const view = render(<RosterRequestsClient links={[disputed]} />);
    await user.click(screen.getByRole("button", { name: "Resolve dispute for Acquired" }));
    const dialog = screen.getByTestId("resolve-dialog");
    await user.type(within(dialog).getByLabelText("Note"), "Again");
    await user.click(within(dialog).getByRole("button", { name: "Resolve dispute for Acquired" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("No open dispute on this link.");
    expect(screen.queryByTestId("resolve-dialog")).not.toBeInTheDocument();
    expect(screen.getByTestId("disputed-by-owner")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Approve Acquired" })).toBeDisabled();
    expectNoEmDash(view.container);
  });
});
