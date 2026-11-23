import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;

const db: Record<string, Row[]> = {
  shows: [],
  show_ownership_proofs: [],
};

const tables: string[] = [];
const inCalls: Array<{ table: string; size: number }> = [];
let failTable = "";
let failCode = "";
let throwTable = "";

function matches(row: Row, filters: Array<{ op: string; column: string; value: unknown }>): boolean {
  return filters.every((filter) => {
    const cell = row[filter.column];
    if (filter.op === "in") {
      return Array.isArray(filter.value) && (filter.value as unknown[]).includes(cell);
    }
    return cell === filter.value;
  });
}

vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: {
    from(table: string) {
      tables.push(table);
      const filters: Array<{ op: string; column: string; value: unknown }> = [];
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
          inCalls.push({
            table,
            size: Array.isArray(value) ? value.length : 0,
          });
          return api;
        },
        then(
          resolve: (value: { data: Row[] | null; error: { code?: string } | null }) => unknown,
          reject?: (reason: unknown) => unknown
        ) {
          if (throwTable === table) {
            return Promise.reject(new Error("show id leaked")).then(resolve, reject);
          }
          if (failTable === table) {
            return Promise.resolve({ data: null, error: { code: failCode } }).then(resolve, reject);
          }
          const rows = (db[table] ?? []).filter((row) => matches(row, filters));
          return Promise.resolve({ data: rows, error: null }).then(resolve, reject);
        },
      };
      return api;
    },
  },
}));

import { verifiedShowIds } from "./verified-flag";

const VERIFIED = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const COLUMN_ONLY = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";
const CLAIMED = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3";
const UNCLAIMED = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4";
const PENDING = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5";
const FLAG_ONLY = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa6";

function uuid(n: number): string {
  return `bbbbbbbb-bbbb-4bbb-8bbb-${n.toString(16).padStart(12, "0")}`;
}

beforeEach(() => {
  db.shows = [];
  db.show_ownership_proofs = [];
  tables.length = 0;
  inCalls.length = 0;
  failTable = "";
  failCode = "";
  throwTable = "";
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("verifiedShowIds", () => {
  it("returns an id only when ownership_status and a proof are both verified", async () => {
    db.shows.push(
      { id: VERIFIED, ownership_status: "verified", is_verified: false, is_claimed: false },
      { id: COLUMN_ONLY, ownership_status: "verified", is_verified: true },
      { id: CLAIMED, ownership_status: "claimed", is_claimed: true },
      { id: UNCLAIMED, ownership_status: "unclaimed" },
      { id: PENDING, ownership_status: "verified" },
      { id: FLAG_ONLY, ownership_status: "unclaimed", is_verified: true, is_claimed: true }
    );
    db.show_ownership_proofs.push(
      { show_id: VERIFIED, status: "verified", user_id: "host" },
      { show_id: CLAIMED, status: "verified" },
      { show_id: PENDING, status: "pending" },
      { show_id: FLAG_ONLY, status: "verified" }
    );

    const ids = await verifiedShowIds([
      VERIFIED,
      COLUMN_ONLY,
      CLAIMED,
      UNCLAIMED,
      PENDING,
      FLAG_ONLY,
      VERIFIED,
      "not-a-uuid",
    ]);

    expect([...ids]).toEqual([VERIFIED]);
    expect(tables).toEqual(["shows", "show_ownership_proofs"]);
  });

  it("skips the read when no id is a uuid", async () => {
    db.shows.push({ id: VERIFIED, ownership_status: "verified" });
    db.show_ownership_proofs.push({ show_id: VERIFIED, status: "verified" });
    const ids = await verifiedShowIds(["", "show-1", "not-a-uuid"]);
    expect(ids.size).toBe(0);
    expect(tables).toEqual([]);
  });

  it("returns an empty set when the ownership read errors", async () => {
    failTable = "shows";
    failCode = "42501";
    db.shows.push({ id: VERIFIED, ownership_status: "verified" });
    db.show_ownership_proofs.push({ show_id: VERIFIED, status: "verified" });
    const ids = await verifiedShowIds([VERIFIED]);
    expect(ids.size).toBe(0);
    expect(console.warn).toHaveBeenCalledWith("[shows] verified read", "42501");
    expect(JSON.stringify((console.warn as unknown as { mock: { calls: unknown[] } }).mock.calls)).not.toContain(
      VERIFIED
    );
  });

  it("returns an empty set when the proof read errors", async () => {
    failTable = "show_ownership_proofs";
    failCode = "08006";
    db.shows.push({ id: VERIFIED, ownership_status: "verified" });
    db.show_ownership_proofs.push({ show_id: VERIFIED, status: "verified" });
    const ids = await verifiedShowIds([VERIFIED]);
    expect(ids.size).toBe(0);
    expect(console.warn).toHaveBeenCalledWith("[shows] verified read", "08006");
  });

  it("returns an empty set when the read throws", async () => {
    throwTable = "shows";
    db.shows.push({ id: VERIFIED, ownership_status: "verified" });
    const ids = await verifiedShowIds([VERIFIED]);
    expect(ids.size).toBe(0);
    expect(console.warn).toHaveBeenCalledWith("[shows] verified read", "unknown");
    expect(JSON.stringify((console.warn as unknown as { mock: { calls: unknown[] } }).mock.calls)).not.toContain(
      "leaked"
    );
  });

  it("batches .in() calls", async () => {
    const ids = Array.from({ length: 81 }, (_, index) => uuid(index + 1));
    const first = ids[0];
    const last = ids[80];
    db.shows.push(
      { id: first, ownership_status: "verified" },
      { id: last, ownership_status: "verified" },
      { id: ids[40], ownership_status: "claimed" }
    );
    db.show_ownership_proofs.push(
      { show_id: first, status: "verified" },
      { show_id: last, status: "verified" }
    );

    const verified = await verifiedShowIds(ids);
    expect([...verified].sort()).toEqual([first, last].sort());
    const showChunks = inCalls.filter((call) => call.table === "shows").map((call) => call.size);
    expect(showChunks).toEqual([80, 1]);
    const proofChunks = inCalls
      .filter((call) => call.table === "show_ownership_proofs")
      .map((call) => call.size);
    expect(proofChunks).toEqual([2]);
  });
});
