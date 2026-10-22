// @vitest-environment jsdom

import type { ReactElement } from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

const mocks = vi.hoisted(() => ({
  getAuthenticatedUser: vi.fn(),
  getEffectiveRole: vi.fn(),
  getProfilePlanId: vi.fn(),
  getBrandProfileByUserId: vi.fn(),
  getUserProfile: vi.fn(),
  listCrmShows: vi.fn(),
  listContacts: vi.fn(),
  listNotes: vi.fn(),
  listShowDealHistory: vi.fn(),
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
  notFound: vi.fn(() => {
    throw new Error("NOT_FOUND");
  }),
}));

vi.mock("next/navigation", () => ({
  redirect: mocks.redirect,
  notFound: mocks.notFound,
}));

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

vi.mock("@/lib/data/queries", () => ({
  getAuthenticatedUser: mocks.getAuthenticatedUser,
  getEffectiveRole: mocks.getEffectiveRole,
  getBrandProfileByUserId: mocks.getBrandProfileByUserId,
  getUserProfile: mocks.getUserProfile,
}));

vi.mock("@/lib/entitlements/plan", async () => {
  const actual = await vi.importActual<typeof import("@/lib/entitlements/plan")>(
    "@/lib/entitlements/plan",
  );
  return { ...actual, getProfilePlanId: mocks.getProfilePlanId };
});

vi.mock("@/lib/crm/store", () => ({
  listCrmShows: mocks.listCrmShows,
  listContacts: mocks.listContacts,
  listNotes: mocks.listNotes,
  listShowDealHistory: mocks.listShowDealHistory,
}));

import CrmPage from "./page";
import CrmShowPage from "./[showId]/page";
import { CrmShowClient } from "./[showId]/show-client";
import type { CrmContactView, CrmDealView, CrmNoteView } from "./components/types";

const BRAND = "11111111-1111-4111-8111-111111111111";
const SHOW = "8f3c1a20-4b6e-4c11-9a2d-111111111111";
const CONTACT = "33333333-3333-4333-8333-333333333333";

function expectNoEmDash(container: HTMLElement) {
  expect(container.textContent ?? "").not.toContain("\u2014");
  expect(container.innerHTML).not.toContain("\u2014");
}

function signedIn(role = "brand", plan = "starter") {
  mocks.getAuthenticatedUser.mockResolvedValue({ id: BRAND });
  mocks.getEffectiveRole.mockResolvedValue({ effectiveRole: role });
  mocks.getProfilePlanId.mockResolvedValue(plan);
  mocks.getBrandProfileByUserId.mockResolvedValue({ brand_name: "Sauna Box" });
  mocks.getUserProfile.mockResolvedValue({ company_name: "Sauna Box LLC" });
}

const contact: CrmContactView = {
  id: CONTACT,
  name: "Maya Chen",
  email: "maya@acquired.fm",
  role: "Producer",
  phone: "415-555-0148",
};

const note: CrmNoteView = {
  id: "note-1",
  body: "Ask Maya before pitching a second flight.",
  createdAt: "2026-04-02T14:00:00Z",
};

const deal: CrmDealView = {
  id: "deal-1",
  status: "delivering",
  numEpisodes: 3,
  placement: "mid-roll",
  cpmRate: 25,
  totalGross: 4500,
  flightStart: "2026-03-02",
  flightEnd: "2026-04-13",
};

beforeEach(() => {
  vi.clearAllMocks();
  signedIn();
  mocks.listCrmShows.mockResolvedValue([{ id: SHOW, name: "Acquired" }]);
  mocks.listContacts.mockResolvedValue([
    {
      id: CONTACT,
      name: contact.name,
      email: contact.email,
      role: contact.role,
      phone: contact.phone,
    },
  ]);
  mocks.listNotes.mockResolvedValue([
    { id: note.id, body: note.body, created_at: note.createdAt },
  ]);
  mocks.listShowDealHistory.mockResolvedValue([
    {
      id: deal.id,
      status: deal.status,
      num_episodes: deal.numEpisodes,
      placement: deal.placement,
      cpm_rate: deal.cpmRate,
      total_gross: deal.totalGross,
      flight_start: deal.flightStart,
      flight_end: deal.flightEnd,
    },
  ]);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function renderPage(node: Promise<ReactElement>) {
  const view = render(await node);
  expectNoEmDash(view.container);
  return view;
}

describe("CRM pages", () => {
  it("renders the Free upgrade card and does not call the store", async () => {
    signedIn("brand", "pay_as_you_go");
    const view = await renderPage(CrmPage());
    expect(screen.getByRole("heading", { name: "Brand CRM" })).toBeInTheDocument();
    expect(screen.getByTestId("crm-upgrade-card")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "CRM is included with Starter" })).toBeInTheDocument();
    expect(view.container).toHaveTextContent("Free includes 1 active campaign.");
    expect(view.container).toHaveTextContent("Starter is $79 a month and includes CRM, with 5 active campaigns.");
    expect(view.container).toHaveTextContent("Operator includes CRM as well.");
    expect(screen.getByRole("link", { name: "Upgrade to Starter" })).toHaveAttribute(
      "href",
      "/settings/billing",
    );
    expect(screen.queryByText("Preview plan")).not.toBeInTheDocument();
    expect(screen.queryByText("This button only opens the Starter preview.")).not.toBeInTheDocument();
    expect(mocks.listCrmShows).not.toHaveBeenCalled();
    expect(mocks.listContacts).not.toHaveBeenCalled();
    expectNoEmDash(view.container);
  });

  it("renders the show index for a Starter brand", async () => {
    const view = await renderPage(CrmPage());
    expect(screen.getByRole("heading", { name: "Brand CRM" })).toBeInTheDocument();
    expect(view.container).toHaveTextContent(
      "Sauna Box. Contacts and notes are stored per show. Deal history stays read-only.",
    );
    expect(screen.getByTestId("crm-show-list")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Acquired" })).toHaveAttribute("href", `/crm/${SHOW}`);
    expect(screen.queryByTestId("crm-upgrade-card")).not.toBeInTheDocument();
    expect(mocks.listCrmShows).toHaveBeenCalledWith(BRAND);
  });

  it("renders an empty show list without the upgrade card", async () => {
    mocks.listCrmShows.mockResolvedValue([]);
    await renderPage(CrmPage());
    expect(screen.getByText("No shows yet.")).toBeInTheDocument();
    expect(screen.queryByTestId("crm-upgrade-card")).not.toBeInTheDocument();
  });

  it("renders contacts, notes, and deal history on a show", async () => {
    const view = await renderPage(CrmShowPage({ params: Promise.resolve({ showId: SHOW }) }));
    expect(screen.getByRole("heading", { name: "Acquired" })).toBeInTheDocument();
    expect(view.container).toHaveTextContent(
      "Contacts and notes are for Sauna Box only. Deal history is read-only.",
    );
    expect(screen.getByRole("tab", { name: "Contacts" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("Maya Chen")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Brand CRM" })).toHaveAttribute("href", "/crm");

    const user = userEvent.setup();
    await user.click(screen.getByRole("tab", { name: "Notes" }));
    expect(screen.getByText(note.body)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Remove note" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Deal history" }));
    expect(screen.getByRole("columnheader", { name: "Total" })).toBeInTheDocument();
    expect(screen.getByText("Delivering")).toBeInTheDocument();
    expect(screen.getByText("Mid-roll")).toBeInTheDocument();
    expect(screen.getByText("$4,500")).toBeInTheDocument();
    expectNoEmDash(view.container);
    expect(mocks.listContacts).toHaveBeenCalledWith(BRAND, SHOW);
    expect(mocks.listNotes).toHaveBeenCalledWith(BRAND, SHOW);
    expect(mocks.listShowDealHistory).toHaveBeenCalledWith(BRAND, SHOW);
  });

  it("shows the upgrade card on a show url when the plan is Free", async () => {
    signedIn("brand", "pay_as_you_go");
    await renderPage(CrmShowPage({ params: Promise.resolve({ showId: SHOW }) }));
    expect(screen.getByTestId("crm-upgrade-card")).toBeInTheDocument();
    expect(mocks.listCrmShows).not.toHaveBeenCalled();
    expect(mocks.listContacts).not.toHaveBeenCalled();
  });

  it("sends a show or agent away from CRM", async () => {
    signedIn("show", "operator");
    await expect(CrmPage()).rejects.toThrow("REDIRECT:/dashboard");
    signedIn("agent", "operator");
    await expect(CrmShowPage({ params: Promise.resolve({ showId: SHOW }) })).rejects.toThrow(
      "REDIRECT:/dashboard",
    );
    expect(mocks.listCrmShows).not.toHaveBeenCalled();
    expect(mocks.getProfilePlanId).not.toHaveBeenCalled();
  });

  it("sends a signed-out visit to login and a role-less profile to onboarding", async () => {
    mocks.getAuthenticatedUser.mockResolvedValue(null);
    await expect(CrmPage()).rejects.toThrow("REDIRECT:/login");
    signedIn();
    mocks.getEffectiveRole.mockResolvedValue(null);
    await expect(CrmPage()).rejects.toThrow("REDIRECT:/onboarding");
  });

  it("404s a show the brand does not have", async () => {
    await expect(
      CrmShowPage({ params: Promise.resolve({ showId: "8f3c1a20-4b6e-4c11-9a2d-999999999999" }) }),
    ).rejects.toThrow("NOT_FOUND");
    expect(mocks.listContacts).not.toHaveBeenCalled();
  });
});

describe("CRM show actions", () => {
  function renderShow() {
    return render(
      <CrmShowClient
        show={{ id: SHOW, name: "Acquired" }}
        brandName="Sauna Box"
        contacts={[contact]}
        notes={[note]}
        deals={[deal]}
      />,
    );
  }

  it("adds a contact optimistically and rolls it back when the request fails", async () => {
    let finish: (value: { ok: boolean; json: () => Promise<unknown> }) => void = () => {};
    const pending = new Promise<{ ok: boolean; json: () => Promise<unknown> }>((resolve) => {
      finish = resolve;
    });
    const fetchMock = vi.fn(() => pending);
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    const view = renderShow();
    await user.type(screen.getByLabelText("Name"), "Avery Cole");
    await user.type(screen.getByLabelText("Email"), "avery@acquired.fm");
    await user.click(screen.getByRole("button", { name: "Add contact" }));
    await waitFor(() => expect(screen.getByText("Avery Cole")).toBeInTheDocument());
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`/api/crm/shows/${SHOW}/contacts`);
    expect(JSON.parse(String(init.body)).brandId).toBeUndefined();

    finish({ ok: false, json: async () => ({ error: "Could not save. Try again." }) });
    await waitFor(() => expect(screen.queryByText("Avery Cole")).not.toBeInTheDocument());
    expect(screen.getByText("Could not save. Try again.")).toBeInTheDocument();
    expect(screen.getByLabelText("Name")).toHaveValue("Avery Cole");
    expectNoEmDash(view.container);
  });

  it("keeps a saved contact and a saved note", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).endsWith("/notes")) {
        return {
          ok: true,
          json: async () => ({
            note: {
              id: "note-2",
              body: "Hold the next flight until May.",
              created_at: "2026-05-01T12:00:00Z",
            },
          }),
        };
      }
      return {
        ok: true,
        json: async () => ({
          contact: {
            id: "44444444-4444-4444-8444-444444444444",
            name: "Avery Cole",
            email: "avery@acquired.fm",
            role: null,
            phone: null,
          },
        }),
      };
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    renderShow();
    await user.type(screen.getByLabelText("Name"), "Avery Cole");
    await user.type(screen.getByLabelText("Email"), "avery@acquired.fm");
    await user.click(screen.getByRole("button", { name: "Add contact" }));
    await waitFor(() => expect(screen.getByText("Avery Cole")).toBeInTheDocument());

    await user.click(screen.getByRole("tab", { name: "Notes" }));
    await user.type(screen.getByLabelText("Note"), "Hold the next flight until May.");
    await user.click(screen.getByRole("button", { name: "Add note" }));
    await waitFor(() => expect(screen.getByText("Hold the next flight until May.")).toBeInTheDocument());
    expect(screen.getByText(note.body)).toBeInTheDocument();
  });

  it("edits a contact optimistically and restores it when the request fails", async () => {
    let finish: (value: { ok: boolean; json: () => Promise<unknown> }) => void = () => {};
    const pending = new Promise<{ ok: boolean; json: () => Promise<unknown> }>((resolve) => {
      finish = resolve;
    });
    const fetchMock = vi.fn(() => pending);
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    renderShow();
    await user.click(screen.getByRole("button", { name: "Edit Maya Chen" }));
    const name = document.getElementById(`edit-name-${CONTACT}`) as HTMLInputElement;
    await user.clear(name);
    await user.type(name, "Maya C.");
    await user.click(screen.getByRole("button", { name: "Save Maya Chen" }));
    await waitFor(() => expect(screen.getByText("Maya C.")).toBeInTheDocument());
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`/api/crm/shows/${SHOW}/contacts/${CONTACT}`);
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(String(init.body)).brandId).toBeUndefined();
    finish({ ok: false, json: async () => ({ error: "Could not save. Try again." }) });
    await waitFor(() => expect(screen.getByText("Could not save. Try again.")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Save Maya Chen" })).toBeInTheDocument();
    expect((document.getElementById(`edit-name-${CONTACT}`) as HTMLInputElement).value).toBe(
      "Maya Chen",
    );
    expect(screen.queryByText("Maya C.")).not.toBeInTheDocument();
  });

  it("rolls a deleted contact back when the request fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, json: async () => ({ error: "Contact not found." }) })),
    );
    const user = userEvent.setup();
    renderShow();
    await user.click(screen.getByRole("button", { name: "Remove Maya Chen" }));
    await waitFor(() => expect(screen.getByText("Contact not found.")).toBeInTheDocument());
    expect(screen.getByText("Maya Chen")).toBeInTheDocument();
  });
});
