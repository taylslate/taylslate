import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";

const USER = "11111111-1111-4111-8111-111111111111";
const ROSTER = "22222222-2222-4222-8222-222222222222";
const OWN = "33333333-3333-4333-8333-333333333333";
const OTHER = "44444444-4444-4444-8444-444444444444";

const mocks = vi.hoisted(() => ({
  getAuthenticatedUser: vi.fn(),
  getEffectiveRole: vi.fn(),
  getUserProfile: vi.fn(),
  getAllShows: vi.fn(),
  getShowsFiltered: vi.fn(),
  contactVisibleShowIds: vi.fn(),
  attachVisibleShowContacts: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
}));

vi.mock("@/lib/data/queries", () => ({
  getAuthenticatedUser: (...args: unknown[]) => mocks.getAuthenticatedUser(...args),
  getEffectiveRole: (...args: unknown[]) => mocks.getEffectiveRole(...args),
  getUserProfile: (...args: unknown[]) => mocks.getUserProfile(...args),
  getAllShows: (...args: unknown[]) => mocks.getAllShows(...args),
  getShowsFiltered: (...args: unknown[]) => mocks.getShowsFiltered(...args),
}));

vi.mock("@/lib/relay/contact-visibility", () => ({
  contactVisibleShowIds: (...args: unknown[]) => mocks.contactVisibleShowIds(...args),
  attachVisibleShowContacts: (...args: unknown[]) => mocks.attachVisibleShowContacts(...args),
}));

vi.mock("./shows-client", () => ({
  default: () => null,
}));

import ShowsPage from "./page";

function row(id: string) {
  return {
    id,
    name: id === OWN ? "Mine" : "Other",
    contact: { name: "", email: "", method: "email" as const },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getAuthenticatedUser.mockResolvedValue({ id: USER });
  mocks.attachVisibleShowContacts.mockImplementation(
    async (shows: Array<{ id: string; contact: { email: string } }>, visible: Set<string>) =>
      shows.map((show) =>
        visible.has(show.id)
          ? { ...show, contact: { ...show.contact, email: "host@example.test" } }
          : show
      )
  );
});

describe("ShowsPage contact props", () => {
  it("gives an agent the roster show address", async () => {
    mocks.getEffectiveRole.mockResolvedValue({ effectiveRole: "agent" });
    mocks.getUserProfile.mockResolvedValue({ role: "agent" });
    mocks.getShowsFiltered.mockResolvedValue([row(ROSTER), row(OTHER)]);
    mocks.contactVisibleShowIds.mockResolvedValue(new Set([ROSTER]));
    const element = (await ShowsPage()) as ReactElement<{
      initialShows: Array<{ id: string; contact: { email: string } }>;
    }>;
    expect(element.props.initialShows.map((show) => [show.id, show.contact.email])).toEqual([
      [ROSTER, "host@example.test"],
      [OTHER, ""],
    ]);
  });

  it("gives a show-role user only their own address", async () => {
    mocks.getEffectiveRole.mockResolvedValue({ effectiveRole: "show" });
    mocks.getUserProfile.mockResolvedValue({ role: "show" });
    mocks.getAllShows.mockResolvedValue([row(OWN), row(OTHER)]);
    mocks.contactVisibleShowIds.mockResolvedValue(new Set([OWN]));
    const element = (await ShowsPage()) as ReactElement<{
      initialShows: Array<{ id: string; contact: { email: string } }>;
    }>;
    expect(element.props.initialShows.map((show) => [show.id, show.contact.email])).toEqual([
      [OWN, "host@example.test"],
      [OTHER, ""],
    ]);
    expect(mocks.getShowsFiltered).not.toHaveBeenCalled();
  });
});
