import { beforeEach, describe, expect, it, vi } from "vitest";

type Link = {
  id: string;
  status: string;
  show_id: string;
  agent_id: string;
  review_note?: string | null;
  rejected_by?: string | null;
  rejected_at?: string | null;
};

type Show = {
  id: string;
  agent_id: string | null;
  is_discoverable: boolean;
};

const { getAuthenticatedUser, isShowsAdmin, adminFrom, logEvent, state } = vi.hoisted(() => ({
  getAuthenticatedUser: vi.fn(),
  isShowsAdmin: vi.fn(),
  adminFrom: vi.fn(),
  logEvent: vi.fn(async (..._args: unknown[]) => null),
  state: {
    links: [] as Link[],
    shows: [] as Show[],
    tables: [] as string[],
    disputes: [] as Record<string, unknown>[],
    disputeReadError: null as { message: string; code?: string } | null,
    triggerOpenDispute: false,
    missingResolutionNote: false,
  },
}));

vi.mock("@/lib/data/queries", () => ({
  getAuthenticatedUser: (...args: unknown[]) => getAuthenticatedUser(...args),
}));
vi.mock("@/lib/shows/can-edit-show", () => ({
  isShowsAdmin: (...args: unknown[]) => isShowsAdmin(...args),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ from: vi.fn() }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: { from: (...args: unknown[]) => adminFrom(...args) },
}));
vi.mock("@/lib/data/events", () => ({
  logEvent: (...args: unknown[]) => logEvent(...args),
}));
vi.mock("@/lib/reps/roster-notify", () => ({
  notifyRosterLinkDecision: vi.fn(async () => undefined),
}));

import { notifyRosterLinkDecision } from "@/lib/reps/roster-notify";
import { POST } from "./route";

function matches(
  row: Record<string, unknown>,
  filters: { column: string; value: unknown }[]
): boolean {
  return filters.every((filter) => row[filter.column] === filter.value);
}

function installAdmin() {
  adminFrom.mockImplementation((table: string) => {
    state.tables.push(table);
    const filters: { column: string; value: unknown }[] = [];
    let patch: Record<string, unknown> | null = null;
    const builder: Record<string, unknown> = {};
    const self = () => builder;
    builder.select = vi.fn(self);
    builder.eq = vi.fn((column: string, value: unknown) => {
      filters.push({ column, value });
      return builder;
    });
    builder.update = vi.fn((row: Record<string, unknown>) => {
      patch = row;
      return builder;
    });
    builder.single = vi.fn(async () => {
      const link = state.links.find((row) =>
        matches(row as unknown as Record<string, unknown>, filters)
      );
      if (
        state.triggerOpenDispute &&
        patch?.status === "approved" &&
        link
      ) {
        return {
          data: null,
          error: { code: "P0001", message: "roster link has an open dispute" },
        };
      }
      if (!link || !patch) {
        return {
          data: null,
          error: { message: "Cannot coerce the result to a single JSON object" },
        };
      }
      Object.assign(link, patch);
      return {
        data: {
          id: link.id,
          show_id: link.show_id,
          agent_id: link.agent_id,
          status: link.status,
        },
        error: null,
      };
    });
    builder.maybeSingle = vi.fn(async () => {
      if (table === "shows") {
        const show = state.shows.find((row) =>
          matches(row as unknown as Record<string, unknown>, filters)
        );
        return { data: show ?? null, error: null };
      }
      const link = state.links.find((row) =>
        matches(row as unknown as Record<string, unknown>, filters)
      );
      if (!link) return { data: null, error: null };
      if (!patch) {
        return { data: { id: link.id, show_id: link.show_id, status: link.status }, error: null };
      }
      Object.assign(link, patch);
      return { data: { id: link.id, status: link.status }, error: null };
    });
    builder.then = (
      resolve: (value: { data: unknown; error: { message: string; code?: string } | null }) => unknown,
      reject?: (reason: unknown) => unknown
    ) => {
      if (table === "roster_link_disputes") {
        if (!patch && state.disputeReadError) {
          return Promise.resolve({ data: null, error: state.disputeReadError }).then(resolve, reject);
        }
        if (patch && state.missingResolutionNote) {
          return Promise.resolve({
            data: null,
            error: {
              code: "42703",
              message: "column roster_link_disputes.resolution_note does not exist",
            },
          }).then(resolve, reject);
        }
        let rows = state.disputes.filter((row) => matches(row, filters));
        if (patch) {
          for (const row of rows) Object.assign(row, patch);
        }
        return Promise.resolve({ data: rows, error: null }).then(resolve, reject);
      }
      if (table === "shows" && patch) {
        const show = state.shows.find((row) =>
          matches(row as unknown as Record<string, unknown>, filters)
        );
        if (show) Object.assign(show, patch);
      }
      return Promise.resolve({ data: null, error: null }).then(resolve, reject);
    };
    return builder;
  });
}

function post(id: string, body: unknown) {
  return POST(
    new Request("http://x/api/admin/roster-links/" + id, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }) as never,
    { params: Promise.resolve({ id }) }
  );
}

function seed() {
  state.links = [
    { id: "rejected", status: "rejected", show_id: "show-r", agent_id: "agent-1" },
    { id: "approved", status: "approved", show_id: "show-a", agent_id: "agent-1" },
    { id: "match", status: "pending", show_id: "show-m", agent_id: "agent-1" },
    { id: "differ", status: "pending", show_id: "show-d", agent_id: "agent-2" },
  ];
  state.shows = [
    { id: "show-r", agent_id: "agent-1", is_discoverable: false },
    { id: "show-a", agent_id: "agent-1", is_discoverable: false },
    { id: "show-m", agent_id: "agent-1", is_discoverable: false },
    { id: "show-d", agent_id: "agent-9", is_discoverable: false },
  ];
  state.tables = [];
  state.disputes = [];
  state.disputeReadError = null;
  state.triggerOpenDispute = false;
  state.missingResolutionNote = false;
}

beforeEach(() => {
  getAuthenticatedUser.mockReset();
  isShowsAdmin.mockReset();
  adminFrom.mockReset();
  seed();
  installAdmin();
  getAuthenticatedUser.mockResolvedValue({ id: "admin-1", email: "ops@taylslate.com" });
  isShowsAdmin.mockResolvedValue(true);
  vi.mocked(notifyRosterLinkDecision).mockReset();
  vi.mocked(notifyRosterLinkDecision).mockResolvedValue(undefined);
  logEvent.mockReset();
});

describe("POST /api/admin/roster-links/[id]", () => {
  it("returns 403 for a signed-in user who is not a shows admin", async () => {
    isShowsAdmin.mockResolvedValue(false);
    getAuthenticatedUser.mockResolvedValue({ id: "brand-1" });
    const response = await post("rejected", { action: "approve" });
    expect(response.status).toBe(403);
    expect(adminFrom).not.toHaveBeenCalled();
    expect(state.links.find((row) => row.id === "rejected")?.status).toBe("rejected");
  });

  it("returns 401 when nobody is signed in", async () => {
    getAuthenticatedUser.mockResolvedValue(null);
    const response = await post("match", { action: "approve" });
    expect(response.status).toBe(401);
    expect(isShowsAdmin).not.toHaveBeenCalled();
    expect(adminFrom).not.toHaveBeenCalled();
  });

  it("approving a rejected link writes nothing and errors", async () => {
    const response = await post("rejected", { action: "approve" });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "Not pending" });
    expect(state.links.find((row) => row.id === "rejected")?.status).toBe("rejected");
    expect(state.shows.find((row) => row.id === "show-r")?.is_discoverable).toBe(false);
    expect(state.tables).not.toContain("shows");
  });

  it("approving an approved link writes nothing", async () => {
    const response = await post("approved", { action: "approve" });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "Not pending" });
    expect(state.links.find((row) => row.id === "approved")?.status).toBe("approved");
    expect(state.shows.every((row) => row.is_discoverable === false)).toBe(true);
    expect(state.tables).not.toContain("shows");
  });

  it("makes the show discoverable only when shows.agent_id matches the link", async () => {
    const matched = await post("match", { action: "approve" });
    expect(matched.status).toBe(200);
    expect(await matched.json()).toEqual({
      id: "match",
      show_id: "show-m",
      status: "approved",
    });
    expect(state.links.find((row) => row.id === "match")?.status).toBe("approved");
    expect(state.shows.find((row) => row.id === "show-m")?.is_discoverable).toBe(true);

    const differed = await post("differ", { action: "approve" });
    expect(differed.status).toBe(200);
    expect(state.links.find((row) => row.id === "differ")?.status).toBe("approved");
    expect(state.shows.find((row) => row.id === "show-d")?.is_discoverable).toBe(false);
  });

  it("fails a reject without a note and writes nothing", async () => {
    const missing = await post("match", { action: "reject" });
    expect(missing.status).toBe(400);
    expect(await missing.json()).toEqual({
      error: "A note of 1 to 500 characters is required.",
    });
    const blank = await post("match", { action: "reject", note: "   " });
    expect(blank.status).toBe(400);
    const long = await post("match", { action: "reject", note: "a".repeat(501) });
    expect(long.status).toBe(400);
    expect(state.links.find((row) => row.id === "match")?.status).toBe("pending");
    expect(state.tables).not.toContain("shows");
    expect(adminFrom).not.toHaveBeenCalled();
    expect(notifyRosterLinkDecision).not.toHaveBeenCalled();
  });

  it("rejects a pending link and does not write shows", async () => {
    const response = await post("match", { action: "reject", note: " Already represented. " });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ id: "match", status: "rejected" });
    expect(state.links.find((row) => row.id === "match")).toMatchObject({
      status: "rejected",
      review_note: "Already represented.",
      rejected_by: "admin-1",
    });
    expect(state.shows.find((row) => row.id === "show-m")?.is_discoverable).toBe(false);
    expect(state.tables).toEqual(["agent_show_relationships"]);
    expect(notifyRosterLinkDecision).toHaveBeenCalledTimes(1);
    expect(notifyRosterLinkDecision).toHaveBeenCalledWith({
      relationshipId: "match",
      decision: "declined",
    });
  });

  it("emails the rep once on approve and not again on 409", async () => {
    const first = await post("match", { action: "approve" });
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({
      id: "match",
      show_id: "show-m",
      status: "approved",
    });
    expect(notifyRosterLinkDecision).toHaveBeenCalledTimes(1);
    expect(notifyRosterLinkDecision).toHaveBeenCalledWith({
      relationshipId: "match",
      decision: "approved",
    });
    const second = await post("match", { action: "approve" });
    expect(second.status).toBe(409);
    expect(await second.json()).toEqual({ error: "Not pending" });
    expect(notifyRosterLinkDecision).toHaveBeenCalledTimes(1);
  });

  it("keeps the approve body when notify throws and does not log the message", async () => {
    vi.mocked(notifyRosterLinkDecision).mockRejectedValueOnce(
      new Error("send failed owner@secret.example SECRET-NOTE")
    );
    const errors: unknown[][] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      errors.push(args);
    });
    const response = await post("match", { action: "approve" });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      id: "match",
      show_id: "show-m",
      status: "approved",
    });
    const logged = errors.flat().map(String).join(" ");
    expect(logged).not.toContain("owner@secret.example");
    expect(logged).not.toContain("SECRET-NOTE");
    spy.mockRestore();
  });

  it("returns 409 and writes nothing when the link has an open dispute", async () => {
    state.disputes.push({
      id: "disp-1",
      link_id: "match",
      show_id: "show-m",
      status: "open",
      owner_user_id: "owner-1",
      note: "SECRET-NOTE",
    });
    const response = await post("match", { action: "approve" });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: "This link has an open dispute. Resolve it before approving.",
      code: "disputed",
    });
    expect(state.links.find((row) => row.id === "match")?.status).toBe("pending");
    expect(state.shows.find((row) => row.id === "show-m")?.is_discoverable).toBe(false);
    expect(notifyRosterLinkDecision).not.toHaveBeenCalled();
    expect(logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "roster_link.approve_blocked",
        entityType: "roster_link",
        entityId: "match",
        actorId: "admin-1",
        payload: { link_id: "match", show_id: "show-m" },
      })
    );
    expect(JSON.stringify(logEvent.mock.calls)).not.toContain("SECRET-NOTE");
    expect(JSON.stringify(logEvent.mock.calls)).not.toContain("owner-1");
  });

  it("maps a trigger open-dispute error to 409 and does not publish", async () => {
    state.triggerOpenDispute = true;
    const response = await post("match", { action: "approve" });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: "This link has an open dispute. Resolve it before approving.",
      code: "disputed",
    });
    expect(state.links.find((row) => row.id === "match")?.status).toBe("pending");
    expect(state.shows.find((row) => row.id === "show-m")?.is_discoverable).toBe(false);
    expect(notifyRosterLinkDecision).not.toHaveBeenCalled();
    expect(logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "roster_link.approve_blocked",
        payload: { link_id: "match", show_id: "show-m" },
      })
    );
  });

  it("returns 503 when the dispute read fails and does not approve", async () => {
    state.disputeReadError = { code: "08000", message: "connection failed" };
    const response = await post("match", { action: "approve" });
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "Couldn't check the dispute." });
    expect(state.links.find((row) => row.id === "match")?.status).toBe("pending");
    expect(state.shows.find((row) => row.id === "show-m")?.is_discoverable).toBe(false);
    expect(notifyRosterLinkDecision).not.toHaveBeenCalled();
  });

  it("requires a note to resolve and does not accept a body resolved_by", async () => {
    const missing = await post("match", { action: "resolve_dispute" });
    expect(missing.status).toBe(400);
    const blank = await post("match", { action: "resolve_dispute", note: "  " });
    expect(blank.status).toBe(400);
    const long = await post("match", { action: "resolve_dispute", note: "a".repeat(501) });
    expect(long.status).toBe(400);
    expect(state.links.find((row) => row.id === "match")?.status).toBe("pending");
    expect(notifyRosterLinkDecision).not.toHaveBeenCalled();
    expect(logEvent).not.toHaveBeenCalled();
  });

  it("resolves an open dispute without changing the link or sending mail", async () => {
    state.disputes.push({
      id: "disp-1",
      link_id: "match",
      show_id: "show-m",
      status: "open",
      owner_user_id: "owner-1",
      note: "SECRET-NOTE",
    });
    const response = await post("match", {
      action: "resolve_dispute",
      note: " Cleared after review. ",
      resolved_by: "someone-else",
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, resolved_count: 1 });
    expect(state.disputes[0]).toMatchObject({
      status: "resolved",
      resolved_by: "admin-1",
      resolution_note: "Cleared after review.",
    });
    expect(state.links.find((row) => row.id === "match")?.status).toBe("pending");
    expect(state.shows.find((row) => row.id === "show-m")?.is_discoverable).toBe(false);
    expect(notifyRosterLinkDecision).not.toHaveBeenCalled();
    const payload = (logEvent.mock.calls[0]?.[0] as unknown as { payload: Record<string, unknown> }).payload;
    expect(payload).toEqual({
      link_id: "match",
      show_id: "show-m",
      resolved_count: 1,
      note_length: "Cleared after review.".length,
    });
    expect(JSON.stringify(payload)).not.toContain("SECRET-NOTE");
    expect(JSON.stringify(payload)).not.toContain("Cleared after review.");
    expect(JSON.stringify(payload)).not.toContain("owner-1");

    const repeat = await post("match", { action: "resolve_dispute", note: "again" });
    expect(repeat.status).toBe(409);
    expect(await repeat.json()).toEqual({ error: "No open dispute on this link." });
    expect(logEvent).toHaveBeenCalledTimes(1);
    expect(state.links.find((row) => row.id === "match")?.status).toBe("pending");
  });

  it("returns 409 when the link has no open dispute", async () => {
    const response = await post("match", { action: "resolve_dispute", note: "Nothing open." });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "No open dispute on this link." });
    expect(logEvent).not.toHaveBeenCalled();
    expect(notifyRosterLinkDecision).not.toHaveBeenCalled();
  });

  it("returns 503 when resolving needs migration 081", async () => {
    state.disputes.push({ id: "disp-1", link_id: "match", show_id: "show-m", status: "open" });
    state.missingResolutionNote = true;
    const response = await post("match", { action: "resolve_dispute", note: "Ready." });
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "Resolving disputes needs migration 081." });
    expect(state.disputes[0].status).toBe("open");
    expect(state.links.find((row) => row.id === "match")?.status).toBe("pending");
    expect(logEvent).not.toHaveBeenCalled();
    expect(notifyRosterLinkDecision).not.toHaveBeenCalled();
  });

  it("returns 401 and 403 for resolve before any write", async () => {
    getAuthenticatedUser.mockResolvedValue(null);
    const signedOut = await post("match", { action: "resolve_dispute", note: "Note" });
    expect(signedOut.status).toBe(401);
    expect(adminFrom).not.toHaveBeenCalled();

    getAuthenticatedUser.mockResolvedValue({ id: "brand-1" });
    isShowsAdmin.mockResolvedValue(false);
    const forbidden = await post("match", { action: "resolve_dispute", note: "Note" });
    expect(forbidden.status).toBe(403);
    expect(adminFrom).not.toHaveBeenCalled();
    expect(state.links.find((row) => row.id === "match")?.status).toBe("pending");
  });
});
