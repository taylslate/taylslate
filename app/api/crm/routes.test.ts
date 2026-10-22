import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAuthenticatedUser: vi.fn(),
  getEffectiveRole: vi.fn(),
  getProfilePlanId: vi.fn(),
  listCrmShows: vi.fn(),
  listContacts: vi.fn(),
  addContact: vi.fn(),
  updateContact: vi.fn(),
  deleteContact: vi.fn(),
  addNote: vi.fn(),
  listNotes: vi.fn(),
  listShowDealHistory: vi.fn(),
}));

vi.mock("@/lib/data/queries", () => ({
  getAuthenticatedUser: mocks.getAuthenticatedUser,
  getEffectiveRole: mocks.getEffectiveRole,
}));

vi.mock("@/lib/entitlements/plan", async () => {
  const actual = await vi.importActual<typeof import("@/lib/entitlements/plan")>(
    "@/lib/entitlements/plan",
  );
  return { ...actual, getProfilePlanId: mocks.getProfilePlanId };
});

vi.mock("@/lib/crm/store", async () => {
  const actual = await vi.importActual<typeof import("@/lib/crm/store")>("@/lib/crm/store");
  return {
    ...actual,
    listCrmShows: mocks.listCrmShows,
    listContacts: mocks.listContacts,
    addContact: mocks.addContact,
    updateContact: mocks.updateContact,
    deleteContact: mocks.deleteContact,
    addNote: mocks.addNote,
    listNotes: mocks.listNotes,
    listShowDealHistory: mocks.listShowDealHistory,
  };
});

import { GET as getShows } from "./shows/route";
import { GET as getContacts, POST as postContact } from "./shows/[showId]/contacts/route";
import { DELETE as deleteContactRoute, PATCH as patchContact } from "./shows/[showId]/contacts/[contactId]/route";
import { GET as getNotes, POST as postNote } from "./shows/[showId]/notes/route";
import { GET as getDeals } from "./shows/[showId]/deals/route";

const BRAND = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const SHOW = "8f3c1a20-4b6e-4c11-9a2d-111111111111";
const CONTACT = "33333333-3333-4333-8333-333333333333";

function showParams(showId = SHOW) {
  return { params: Promise.resolve({ showId }) };
}

function contactParams(showId = SHOW, contactId = CONTACT) {
  return { params: Promise.resolve({ showId, contactId }) };
}

function signedIn(role = "brand", plan = "starter") {
  mocks.getAuthenticatedUser.mockResolvedValue({ id: BRAND });
  mocks.getEffectiveRole.mockResolvedValue({ effectiveRole: role });
  mocks.getProfilePlanId.mockResolvedValue(plan);
}

beforeEach(() => {
  vi.clearAllMocks();
  signedIn();
  mocks.listCrmShows.mockResolvedValue([]);
  mocks.listContacts.mockResolvedValue([]);
  mocks.listNotes.mockResolvedValue([]);
  mocks.listShowDealHistory.mockResolvedValue([]);
  mocks.addContact.mockResolvedValue({ id: CONTACT, name: "Maya Chen" });
  mocks.updateContact.mockResolvedValue({ id: CONTACT, name: "Maya Chen" });
  mocks.deleteContact.mockResolvedValue(undefined);
  mocks.addNote.mockResolvedValue({ id: "note-1", body: "Hold the flight.", created_at: "2026-04-02T14:00:00Z" });
});

describe("CRM route gates", () => {
  it("returns 401 when nobody is signed in", async () => {
    mocks.getAuthenticatedUser.mockResolvedValue(null);
    const res = await getShows(new Request(`http://x/api/crm/shows?brandId=${OTHER}`));
    expect(res.status).toBe(401);
    expect(mocks.listCrmShows).not.toHaveBeenCalled();
    expect(mocks.getEffectiveRole).not.toHaveBeenCalled();
  });

  it("returns 403 for a show account and an agent account", async () => {
    for (const role of ["show", "agent"] as const) {
      signedIn(role, "operator");
      const res = await postContact(
        new Request(`http://x/api/crm/shows/${SHOW}/contacts`, {
          method: "POST",
          body: JSON.stringify({ name: "Maya", brandId: OTHER }),
        }),
        showParams(),
      );
      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.error).toBe("CRM is for brand accounts.");
    }
    expect(mocks.addContact).not.toHaveBeenCalled();
    expect(mocks.getProfilePlanId).not.toHaveBeenCalled();
  });

  it("returns 403 on the Free plan and does not read CRM rows", async () => {
    signedIn("brand", "pay_as_you_go");
    const res = await getDeals(new Request(`http://x/api/crm/shows/${SHOW}/deals?brandId=${OTHER}`), showParams());
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe("CRM is included with Starter.");
    expect(mocks.listShowDealHistory).not.toHaveBeenCalled();
  });

  it("allows Starter, Operator, and the legacy agency plan", async () => {
    for (const plan of ["starter", "operator", "agency"]) {
      signedIn("agency", plan);
      const res = await getShows(new Request("http://x/api/crm/shows"));
      expect(res.status).toBe(200);
    }
  });
});

describe("CRM brand id", () => {
  it("lists shows for the session user when the query names another brand", async () => {
    await getShows(new Request(`http://x/api/crm/shows?brandId=${OTHER}`));
    expect(mocks.listCrmShows).toHaveBeenCalledTimes(1);
    expect(mocks.listCrmShows).toHaveBeenCalledWith(BRAND);
  });

  it("ignores a brandId in the contact body", async () => {
    const res = await postContact(
      new Request(`http://x/api/crm/shows/${SHOW}/contacts?brandId=${OTHER}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Maya Chen",
          email: "Maya@Acquired.fm",
          role: "Producer",
          phone: "415-555-0148",
          brandId: OTHER,
        }),
      }),
      showParams(),
    );
    expect(res.status).toBe(201);
    expect(mocks.addContact).toHaveBeenCalledWith({
      brandId: BRAND,
      showId: SHOW,
      name: "Maya Chen",
      email: "maya@acquired.fm",
      role: "Producer",
      phone: "415-555-0148",
    });
  });

  it("updates and deletes a contact for the session user only", async () => {
    const patch = await patchContact(
      new Request("http://x/api/crm/contacts", {
        method: "PATCH",
        body: JSON.stringify({ name: "Maya C.", brandId: OTHER }),
      }),
      contactParams(),
    );
    expect(patch.status).toBe(200);
    expect(mocks.updateContact).toHaveBeenCalledWith(
      expect.objectContaining({ brandId: BRAND, showId: SHOW, contactId: CONTACT, name: "Maya C." }),
    );
    expect(mocks.updateContact.mock.calls[0][0].brandId).not.toBe(OTHER);

    const removed = await deleteContactRoute(new Request("http://x/api/crm/contacts", { method: "DELETE" }), contactParams());
    expect(removed.status).toBe(200);
    expect(mocks.deleteContact).toHaveBeenCalledWith({
      brandId: BRAND,
      showId: SHOW,
      contactId: CONTACT,
    });
  });

  it("adds a note for the session user and ignores a body brandId", async () => {
    const res = await postNote(
      new Request("http://x/api/crm/notes", {
        method: "POST",
        body: JSON.stringify({ body: "Hold the flight.", brandId: OTHER }),
      }),
      showParams(),
    );
    expect(res.status).toBe(201);
    expect(mocks.addNote).toHaveBeenCalledWith({
      brandId: BRAND,
      showId: SHOW,
      body: "Hold the flight.",
    });
  });
});

describe("CRM input limits", () => {
  it("rejects an over-long name before calling the store", async () => {
    const res = await postContact(
      new Request("http://x/api/crm/contacts", {
        method: "POST",
        body: JSON.stringify({ name: "M".repeat(201) }),
      }),
      showParams(),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Name must be 200 characters or fewer.");
    expect(mocks.addContact).not.toHaveBeenCalled();
  });

  it("rejects an invalid email, a long role, and a long phone", async () => {
    const email = await postContact(
      new Request("http://x/api/crm/contacts", {
        method: "POST",
        body: JSON.stringify({ name: "Maya", email: "not-an-email" }),
      }),
      showParams(),
    );
    expect(email.status).toBe(400);

    const role = await postContact(
      new Request("http://x/api/crm/contacts", {
        method: "POST",
        body: JSON.stringify({ name: "Maya", role: "R".repeat(81) }),
      }),
      showParams(),
    );
    expect(role.status).toBe(400);

    const phone = await postContact(
      new Request("http://x/api/crm/contacts", {
        method: "POST",
        body: JSON.stringify({ name: "Maya", phone: "1".repeat(41) }),
      }),
      showParams(),
    );
    expect(phone.status).toBe(400);
    expect(mocks.addContact).not.toHaveBeenCalled();
  });

  it("rejects an empty note and a note past the store limit", async () => {
    const empty = await postNote(
      new Request("http://x/api/crm/notes", { method: "POST", body: JSON.stringify({ body: "   " }) }),
      showParams(),
    );
    expect(empty.status).toBe(400);
    const long = await postNote(
      new Request("http://x/api/crm/notes", {
        method: "POST",
        body: JSON.stringify({ body: "n".repeat(2001) }),
      }),
      showParams(),
    );
    expect(long.status).toBe(400);
    const body = await long.json();
    expect(body.error).toBe("Note must be between 1 and 2000 characters.");
    expect(mocks.addNote).not.toHaveBeenCalled();
  });

  it("rejects a show id that is not a uuid", async () => {
    const res = await getContacts(new Request("http://x/api/crm/contacts"), showParams("acquired"));
    expect(res.status).toBe(400);
    expect(mocks.listContacts).not.toHaveBeenCalled();
  });

  it("rejects an empty contact update", async () => {
    const res = await patchContact(
      new Request("http://x/api/crm/contacts", { method: "PATCH", body: JSON.stringify({ brandId: OTHER }) }),
      contactParams(),
    );
    expect(res.status).toBe(400);
    expect(mocks.updateContact).not.toHaveBeenCalled();
  });
});

describe("CRM reads", () => {
  it("returns contacts, notes, and deals for the session brand", async () => {
    mocks.listContacts.mockResolvedValue([{ id: CONTACT, name: "Maya Chen" }]);
    mocks.listNotes.mockResolvedValue([{ id: "note-1", body: "Newest" }]);
    mocks.listShowDealHistory.mockResolvedValue([{ id: "deal-1", status: "delivering" }]);

    const contacts = await getContacts(new Request("http://x/api/crm/contacts"), showParams());
    const notes = await getNotes(new Request("http://x/api/crm/notes"), showParams());
    const deals = await getDeals(new Request("http://x/api/crm/deals"), showParams());

    expect(contacts.status).toBe(200);
    expect(notes.status).toBe(200);
    expect(deals.status).toBe(200);
    expect(mocks.listContacts).toHaveBeenCalledWith(BRAND, SHOW);
    expect(mocks.listNotes).toHaveBeenCalledWith(BRAND, SHOW);
    expect(mocks.listShowDealHistory).toHaveBeenCalledWith(BRAND, SHOW);
    expect(await contacts.json()).toEqual({ contacts: [{ id: CONTACT, name: "Maya Chen" }] });
  });
});
