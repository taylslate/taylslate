// @vitest-environment jsdom

import type { ReactElement, ReactNode } from "react";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { SHOW_ACQUIRED, SHOW_JOURNAL, formatFlight } from "./fixtures";

const mocks = vi.hoisted(() => ({
  requireMockupAdmin: vi.fn(async () => undefined),
}));

vi.mock("@/app/(dashboard)/admin/mockups/require-admin", () => ({
  requireMockupAdmin: mocks.requireMockupAdmin,
}));

import MockupsIndexPage from "./page";
import CrmMockupPage from "./crm/page";
import CrmShowMockupPage from "./crm/[showId]/page";
import ImportMockupPage from "./import/page";
import RepRosterMockupPage from "./rep/page";
import RepDealsMockupPage from "./rep/deals/page";
import RepShowMockupPage from "./rep/shows/[showId]/page";
import RosterUploadMockupPage from "./rep/upload/page";
import RosterRequestsMockupPage from "./roster-requests/page";
import ApiKeysMockupPage from "./api-keys/page";
import ApprovalsMockupPage from "./approvals/page";
import { CrmClient } from "./crm/crm-client";
import { CrmShowClient } from "./crm/[showId]/show-client";
import { ImportClient } from "./import/import-client";
import { RosterClient } from "./rep/roster-client";
import { RepDealsClient } from "./rep/deals/deals-client";
import { RosterUploadClient } from "./rep/upload/upload-client";
import { RosterRequestsClient } from "./roster-requests/roster-requests-client";
import { ApiKeysClient } from "./api-keys/api-keys-client";
import { ApprovalsClient } from "./approvals/approvals-client";

afterEach(() => {
  cleanup();
  mocks.requireMockupAdmin.mockClear();
});

function expectNoEmDash(container: HTMLElement) {
  expect(container.textContent ?? "").not.toContain("\u2014");
  expect(container.innerHTML).not.toContain("\u2014");
}

async function renderPage(node: Promise<ReactNode> | ReactNode) {
  const element = await node;
  const view = render(element as ReactElement);
  expect(screen.getByTestId("mockup-banner")).toHaveTextContent("Mockup. Nothing here is saved.");
  expectNoEmDash(view.container);
  expect(mocks.requireMockupAdmin).toHaveBeenCalled();
  return view;
}

describe("admin mockup routes", () => {
  it("renders the index", async () => {
    await renderPage(MockupsIndexPage());
    expect(screen.getByRole("heading", { name: "Mockups" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Brand CRM/ })).toHaveAttribute(
      "href",
      "/admin/mockups/crm",
    );
  });

  it("renders brand CRM", async () => {
    await renderPage(CrmMockupPage());
    expect(screen.getByRole("heading", { name: "Brand CRM" })).toBeInTheDocument();
    expect(screen.getByTestId("crm-upgrade-card")).toBeInTheDocument();
  });

  it("renders a show CRM page", async () => {
    await renderPage(CrmShowMockupPage({ params: Promise.resolve({ showId: SHOW_ACQUIRED }) }));
    expect(screen.getByRole("heading", { name: "Acquired" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Contacts" })).toHaveAttribute("aria-selected", "true");
  });

  it("404s a CRM show that is not in the preview", async () => {
    await expect(
      CrmShowMockupPage({ params: Promise.resolve({ showId: "missing-show" }) }),
    ).rejects.toThrow();
    expect(mocks.requireMockupAdmin).toHaveBeenCalled();
  });

  it("renders past campaign import", async () => {
    await renderPage(ImportMockupPage());
    expect(screen.getByRole("heading", { name: "Past campaign import" })).toBeInTheDocument();
    expect(screen.getByTestId("import-step")).toHaveTextContent("Step 1 of 5");
  });

  it("renders the rep roster", async () => {
    await renderPage(RepRosterMockupPage());
    expect(screen.getByRole("heading", { name: "Rep roster" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Exclusive for Acquired" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("renders rep deals with status and flight only", async () => {
    await renderPage(RepDealsMockupPage());
    const deals = screen.getByTestId("rep-deals");
    expect(deals).toHaveTextContent("Delivering");
    expect(deals).toHaveTextContent(formatFlight("2026-03-02", "2026-04-13"));
    expect(deals.textContent ?? "").not.toMatch(/\$|CPM|commission/i);
    expectNoEmDash(deals);
  });

  it("renders a rep show", async () => {
    await renderPage(RepShowMockupPage({ params: Promise.resolve({ showId: SHOW_ACQUIRED }) }));
    expect(screen.getByRole("heading", { name: "Acquired" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Flights" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Exclusive for Acquired" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("404s a rep show that is not on the roster", async () => {
    await expect(
      RepShowMockupPage({ params: Promise.resolve({ showId: "missing-show" }) }),
    ).rejects.toThrow();
    expect(mocks.requireMockupAdmin).toHaveBeenCalled();
  });

  it("renders roster CSV upload", async () => {
    await renderPage(RosterUploadMockupPage());
    expect(screen.getByRole("heading", { name: "Roster CSV" })).toBeInTheDocument();
  });

  it("renders roster requests", async () => {
    await renderPage(RosterRequestsMockupPage());
    expect(screen.getByRole("heading", { name: "Roster requests" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Approve Odd Lots" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reject The Rewatchables" })).toBeInTheDocument();
  });

  it("renders API keys", async () => {
    await renderPage(ApiKeysMockupPage());
    expect(screen.getByRole("heading", { name: "API keys" })).toBeInTheDocument();
    expect(screen.getByText("Last used Oct 12, 2026")).toBeInTheDocument();
  });

  it("renders approvals", async () => {
    await renderPage(ApprovalsMockupPage());
    expect(screen.getByRole("heading", { name: "Approvals" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Approve Sauna Box requested Starter" })).toBeInTheDocument();
  });
});

describe("mockup local interactions", () => {
  it("opens the Starter CRM from the Free upgrade card", async () => {
    const user = userEvent.setup();
    const view = render(<CrmClient />);
    expectNoEmDash(view.container);
    await user.click(screen.getByRole("button", { name: "Upgrade to Starter" }));
    expect(screen.queryByTestId("crm-upgrade-card")).not.toBeInTheDocument();
    expect(screen.getByTestId("crm-show-list")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /The Journal/ })).toHaveAttribute(
      "href",
      expect.stringContaining("/admin/mockups/crm/"),
    );
    expectNoEmDash(view.container);
  });

  it("adds a contact, a note, and shows deal amounts on the show", async () => {
    const user = userEvent.setup();
    const view = render(<CrmShowClient showId={SHOW_ACQUIRED} />);
    await user.type(screen.getByLabelText("Name"), "Avery Cole");
    await user.type(screen.getByLabelText("Email"), "avery@acquired.fm");
    await user.click(screen.getByRole("button", { name: "Add contact" }));
    expect(screen.getByText("Avery Cole")).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Notes" }));
    await user.type(screen.getByLabelText("Note"), "Hold the next flight until May.");
    await user.click(screen.getByRole("button", { name: "Add note" }));
    expect(screen.getByText("Hold the next flight until May.")).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Deal history" }));
    expect(screen.getByRole("columnheader", { name: "Total" })).toBeInTheDocument();
    expect(screen.getByText("$4,500")).toBeInTheDocument();
    expectNoEmDash(view.container);
  });

  it("shows an empty deal history for a show with no flights", async () => {
    render(<CrmShowClient showId={SHOW_JOURNAL} initialTab="deals" />);
    expect(screen.getByText("No deals with this show yet.")).toBeInTheDocument();
  });

  it("walks import from choose through confirmed without saving", async () => {
    const user = userEvent.setup();
    const view = render(<ImportClient />);
    await user.click(screen.getByRole("button", { name: /CSV/ }));
    await user.click(screen.getByRole("button", { name: "Use sample file" }));
    expect(screen.getByText(/Selected file: sauna-box-q1.csv/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Review rows" }));
    expect(screen.getByText("Catalog suggestion: Acquired. The imported name stays unless you change it.")).toBeInTheDocument();
    expect(screen.getByText("No catalog suggestion.")).toBeInTheDocument();
    const showName = screen.getByLabelText("Show name", { selector: "#show-import-row-mfm" });
    await user.clear(showName);
    await user.type(showName, "My First Million podcast");
    await user.click(screen.getByRole("button", { name: "Continue to consent" }));
    expect(screen.getByLabelText(/Allow a later anonymized pool/)).not.toBeChecked();
    await user.click(screen.getByLabelText(/Allow a later anonymized pool/));
    await user.click(screen.getByRole("button", { name: "Confirm import" }));
    const confirmed = screen.getByTestId("import-confirmed");
    expect(confirmed).toHaveTextContent("Confirmed");
    expect(confirmed).toHaveTextContent("Pooling consent: yes");
    expect(confirmed).toHaveTextContent("My First Million podcast");
    expectNoEmDash(view.container);
  });

  it("turns exclusive off on the roster", async () => {
    const user = userEvent.setup();
    render(<RosterClient />);
    const toggle = screen.getByRole("button", { name: "Exclusive for SmartLess" });
    expect(toggle).toHaveAttribute("aria-pressed", "true");
    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    expect(within(toggle).getByText("Not exclusive")).toBeInTheDocument();
  });

  it("keeps dollar amounts off rep deals", () => {
    const view = render(<RepDealsClient />);
    expect(view.container.textContent ?? "").not.toMatch(/\$/);
    expectNoEmDash(view.container);
  });

  it("previews a roster CSV with exclusive on", async () => {
    const user = userEvent.setup();
    const view = render(<RosterUploadClient />);
    await user.click(screen.getByRole("button", { name: "Use sample roster" }));
    const preview = screen.getByTestId("roster-csv-preview");
    expect(within(preview).getByDisplayValue("Odd Lots")).toBeInTheDocument();
    expect(within(preview).getByDisplayValue("The Rewatchables")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Exclusive for Odd Lots" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(within(preview).getAllByText("Pending")).toHaveLength(2);
    await user.click(screen.getByRole("button", { name: "Confirm preview" }));
    expect(screen.getByTestId("roster-csv-confirmed")).toHaveTextContent(
      "2 shows added to the preview roster.",
    );
    expectNoEmDash(view.container);
  });

  it("approves and rejects roster requests in the browser only", async () => {
    const user = userEvent.setup();
    const view = render(<RosterRequestsClient />);
    await user.click(screen.getByRole("button", { name: "Approve Odd Lots" }));
    expect(screen.getByText("Approved Odd Lots.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Approve Odd Lots" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: /Approved/ }));
    expect(screen.getByText(/Approved by You \(preview\)/)).toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: /Pending/ }));
    await user.click(screen.getByRole("button", { name: "Reject The Rewatchables" }));
    await user.click(screen.getByRole("tab", { name: /Rejected/ }));
    expect(screen.getByText("The Rewatchables")).toBeInTheDocument();
    expectNoEmDash(view.container);
  });

  it("shows a new API key once, then only the prefix", async () => {
    const user = userEvent.setup();
    const view = render(<ApiKeysClient />);
    await user.type(screen.getByLabelText("Name"), "Planning agent");
    await user.click(screen.getByRole("checkbox", { name: /Read deals/ }));
    await user.click(screen.getByRole("button", { name: "Create key" }));
    const reveal = screen.getByTestId("api-key-secret");
    expect(reveal).toHaveTextContent("ts_mock_03_7k3m9q");
    expect(reveal).toHaveTextContent("Copy this key now. It will not be shown again.");
    await user.click(screen.getByRole("button", { name: "Hide key" }));
    expect(screen.queryByTestId("api-key-secret")).not.toBeInTheDocument();
    expect(screen.queryByText("ts_mock_03_7k3m9q")).not.toBeInTheDocument();
    expect(screen.getByText("ts_mock_03_7k3...")).toBeInTheDocument();
    expect(screen.getByText("Not used yet")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Revoke Planning agent" }));
    expect(screen.queryByRole("button", { name: "Revoke Planning agent" })).not.toBeInTheDocument();
    expectNoEmDash(view.container);
  });

  it("approves and rejects pending actions", async () => {
    const user = userEvent.setup();
    const view = render(<ApprovalsClient />);
    await user.click(screen.getByRole("button", { name: "Reject Acquired asked to publish a YouTube surface" }));
    expect(screen.getByText("Rejected: Acquired asked to publish a YouTube surface.")).toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: /Rejected/ }));
    expect(screen.getByText("Acquired asked to publish a YouTube surface")).toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: /Pending/ }));
    await user.click(screen.getByRole("button", { name: "Approve Sauna Box requested Starter" }));
    await user.click(screen.getByRole("tab", { name: /Approved/ }));
    expect(screen.getByText("Sauna Box requested Starter")).toBeInTheDocument();
    expectNoEmDash(view.container);
  });
});
