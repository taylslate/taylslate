import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;

interface Filter {
  op: "eq" | "in";
  column: string;
  value: unknown;
}

const db: Record<string, Row[]> = {
  shows: [],
  show_ownership_proofs: [],
  agent_show_relationships: [],
};

const errors: Record<string, string> = {};

function matches(row: Row, filters: Filter[]): boolean {
  return filters.every((filter) => {
    const cell = row[filter.column];
    if (filter.op === "eq") return cell === filter.value;
    return Array.isArray(filter.value) && filter.value.includes(cell);
  });
}

vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: {
    from(table: string) {
      const filters: Filter[] = [];
      const api = {
        select() {
          return api;
        },
        eq(column: string, value: unknown) {
          filters.push({ op: "eq", column, value });
          return api;
        },
        in(column: string, value: unknown) {
          filters.push({ op: "in", column, value });
          return api;
        },
        then(
          resolve: (value: { data: Row[] | null; error: { message: string } | null }) => unknown,
          reject?: (err: unknown) => unknown
        ) {
          if (errors[table]) {
            return Promise.resolve({ data: null, error: { message: errors[table] } }).then(
              resolve,
              reject
            );
          }
          const hits = (db[table] ?? []).filter((row) => matches(row, filters));
          return Promise.resolve({ data: hits, error: null }).then(resolve, reject);
        },
      };
      return api;
    },
  },
}));

import { getOwnershipState, ownershipLabels } from "./status";

const SHOW = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";

beforeEach(() => {
  db.shows = [];
  db.show_ownership_proofs = [];
  db.agent_show_relationships = [];
  for (const key of Object.keys(errors)) delete errors[key];
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("ownership labels", () => {
  it("exports Verified, Unclaimed, and Pending for owner and admin views", () => {
    expect(ownershipLabels).toEqual({
      verified: "Verified",
      unclaimed: "Unclaimed",
      pending: "Pending",
    });
  });
});

describe("getOwnershipState", () => {
  it("returns unclaimed with no pending tag when nothing is open", async () => {
    db.shows.push({ id: SHOW, ownership_status: "unclaimed" });
    const states = await getOwnershipState([SHOW]);
    expect(states.get(SHOW)).toEqual({ state: "unclaimed", pending: false });
  });

  it("returns verified without a pending tag", async () => {
    db.shows.push({ id: SHOW, ownership_status: "verified" });
    db.show_ownership_proofs.push({ show_id: SHOW, status: "verified" });
    db.agent_show_relationships.push({ show_id: SHOW, status: "approved" });
    const states = await getOwnershipState([SHOW]);
    expect(states.get(SHOW)).toEqual({ state: "verified", pending: false });
  });

  it("sets the pending tag from a pending proof", async () => {
    db.shows.push({ id: SHOW, ownership_status: "unclaimed" });
    db.show_ownership_proofs.push({ show_id: SHOW, status: "pending" });
    const states = await getOwnershipState([SHOW]);
    expect(states.get(SHOW)).toEqual({ state: "unclaimed", pending: true });
  });

  it("sets the pending tag from a pending rep link", async () => {
    db.shows.push({ id: SHOW, ownership_status: "unclaimed" });
    db.agent_show_relationships.push({ show_id: SHOW, status: "pending" });
    const states = await getOwnershipState([SHOW]);
    expect(states.get(SHOW)).toEqual({ state: "unclaimed", pending: true });
  });

  it("keeps verified and adds the pending tag when a rep link is still pending", async () => {
    db.shows.push({ id: SHOW, ownership_status: "verified" });
    db.agent_show_relationships.push({ show_id: SHOW, status: "pending" });
    const states = await getOwnershipState([SHOW]);
    expect(states.get(SHOW)).toEqual({ state: "verified", pending: true });
  });

  it("does not treat rejected proofs or approved links as pending", async () => {
    db.shows.push({ id: SHOW, ownership_status: "unclaimed" });
    db.show_ownership_proofs.push(
      { show_id: SHOW, status: "rejected" },
      { show_id: SHOW, status: "contested" },
      { show_id: SHOW, status: "expired" }
    );
    db.agent_show_relationships.push({ show_id: SHOW, status: "approved" });
    const states = await getOwnershipState([SHOW, OTHER]);
    expect(states.get(SHOW)).toEqual({ state: "unclaimed", pending: false });
    expect(states.get(OTHER)).toEqual({ state: "unclaimed", pending: false });
  });

  it("returns one entry per id and ignores blanks", async () => {
    db.shows.push({ id: SHOW, ownership_status: "verified" });
    const states = await getOwnershipState([SHOW, SHOW, "  ", ""]);
    expect([...states.keys()]).toEqual([SHOW]);
    expect(states.get(SHOW)?.state).toBe("verified");
    expect(await getOwnershipState([])).toEqual(new Map());
  });

  it("stays unclaimed when the show read fails", async () => {
    errors.shows = "permission denied";
    db.shows.push({ id: SHOW, ownership_status: "verified" });
    const states = await getOwnershipState([SHOW]);
    expect(states.get(SHOW)).toEqual({ state: "unclaimed", pending: false });
    expect(console.warn).toHaveBeenCalled();
  });
});
