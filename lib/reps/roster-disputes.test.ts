import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;

const { adminFrom, logEvent, db } = vi.hoisted(() => ({
  adminFrom: vi.fn(),
  logEvent: vi.fn(async (..._args: unknown[]) => null),
  db: {
    disputes: [] as Row[],
    readError: null as { code?: string; message: string } | null,
    writeError: null as { code?: string; message: string } | null,
  },
}));

vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: { from: (...args: unknown[]) => adminFrom(...args) },
}));
vi.mock("@/lib/data/events", () => ({
  logEvent: (...args: unknown[]) => logEvent(...args),
}));

import { assertNoOpenDispute, resolveRosterDispute, RosterDisputeReadError, RosterLinkDisputedError, RosterResolutionUnavailableError } from "./roster-disputes";

function install() {
  adminFrom.mockImplementation((table: string) => {
    const filters: { column: string; value: unknown }[] = [];
    let patch: Row | null = null;
    const builder: Record<string, unknown> = {};
    const self = () => builder;
    builder.select = vi.fn(self);
    builder.eq = vi.fn((column: string, value: unknown) => {
      filters.push({ column, value });
      return builder;
    });
    builder.update = vi.fn((row: Row) => {
      patch = row;
      return builder;
    });
    builder.then = (
      resolve: (value: { data: unknown; error: { code?: string; message: string } | null }) => unknown,
      reject?: (reason: unknown) => unknown
    ) => {
      if (table !== "roster_link_disputes") {
        return Promise.resolve({ data: [], error: null }).then(resolve, reject);
      }
      if (!patch && db.readError) {
        return Promise.resolve({ data: null, error: db.readError }).then(resolve, reject);
      }
      if (patch && db.writeError) {
        return Promise.resolve({ data: null, error: db.writeError }).then(resolve, reject);
      }
      let rows = db.disputes.filter((row) => filters.every((filter) => row[filter.column] === filter.value));
      if (patch) {
        for (const row of rows) Object.assign(row, patch);
      }
      return Promise.resolve({ data: rows, error: null }).then(resolve, reject);
    };
    return builder;
  });
}

beforeEach(() => {
  adminFrom.mockReset();
  logEvent.mockClear();
  db.disputes = [];
  db.readError = null;
  db.writeError = null;
  install();
});

describe("assertNoOpenDispute", () => {
  it("throws when an open dispute exists", async () => {
    db.disputes.push({ id: "d1", link_id: "link-1", show_id: "show-1", status: "open" });
    await expect(assertNoOpenDispute("link-1")).rejects.toBeInstanceOf(RosterLinkDisputedError);
    await expect(assertNoOpenDispute("link-1")).rejects.toMatchObject({ showId: "show-1" });
  });

  it("returns when no open dispute exists", async () => {
    db.disputes.push({
      id: "d1",
      link_id: "link-1",
      show_id: "show-1",
      status: "resolved",
    });
    await expect(assertNoOpenDispute("link-1")).resolves.toBeUndefined();
    await expect(assertNoOpenDispute("link-2")).resolves.toBeUndefined();
  });

  it("throws on a read error and does not treat a missing table as empty", async () => {
    db.readError = { code: "42501", message: "permission denied" };
    await expect(assertNoOpenDispute("link-1")).rejects.toBeInstanceOf(RosterDisputeReadError);
  });
});

describe("resolveRosterDispute", () => {
  it("resolves open rows and records a count, not the note", async () => {
    db.disputes.push({
      id: "d1",
      link_id: "link-1",
      show_id: "show-1",
      status: "open",
      owner_user_id: "owner-secret",
      note: "SECRET-NOTE",
    });
    const result = await resolveRosterDispute("admin-1", "link-1", "Reviewed and cleared.");
    expect(result).toEqual({ resolved_count: 1 });
    expect(db.disputes[0]).toMatchObject({
      status: "resolved",
      resolved_by: "admin-1",
      resolution_note: "Reviewed and cleared.",
    });
    expect(logEvent).toHaveBeenCalledTimes(1);
    const payload = logEvent.mock.calls[0]?.[0] as unknown as { payload: Record<string, unknown> };
    expect(payload.payload).toEqual({
      link_id: "link-1",
      show_id: "show-1",
      resolved_count: 1,
      note_length: "Reviewed and cleared.".length,
    });
    expect(JSON.stringify(payload.payload)).not.toContain("SECRET-NOTE");
    expect(JSON.stringify(payload.payload)).not.toContain("owner-secret");
    expect(JSON.stringify(payload.payload)).not.toContain("Reviewed and cleared.");
  });

  it("writes nothing when no open dispute matches", async () => {
    db.disputes.push({ id: "d1", link_id: "link-1", show_id: "show-1", status: "resolved" });
    await expect(resolveRosterDispute("admin-1", "link-1", "Again")).resolves.toEqual({
      resolved_count: 0,
    });
    expect(db.disputes[0].resolved_by).toBeUndefined();
    expect(logEvent).not.toHaveBeenCalled();
  });

  it("reports a missing resolution_note column", async () => {
    db.writeError = {
      code: "42703",
      message: 'column roster_link_disputes.resolution_note does not exist',
    };
    await expect(resolveRosterDispute("admin-1", "link-1", "Note")).rejects.toBeInstanceOf(
      RosterResolutionUnavailableError
    );
    expect(logEvent).not.toHaveBeenCalled();
  });
});
