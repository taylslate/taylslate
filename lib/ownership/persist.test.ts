import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;

const db = {
  shows: [] as Row[],
  deals: [] as Row[],
  show_profiles: [] as Row[],
  authUsers: [] as { id: string; email: string }[],
  claimedWrites: 0,
  checkViolation: false,
};

const warn = vi.fn();

function matches(row: Row, filters: Array<{ op: string; column: string; value: unknown }>): boolean {
  return filters.every((filter) => {
    const cell = row[filter.column];
    if (filter.op === "in") return Array.isArray(filter.value) && filter.value.includes(cell);
    return cell === filter.value;
  });
}

vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: {
    from(table: string) {
      const filters: Array<{ op: string; column: string; value: unknown }> = [];
      let patch: Row | null = null;
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
        update(next: Row) {
          patch = next;
          return api;
        },
        maybeSingle() {
          const rows = (db[table as "shows"] ?? []).filter((row) => matches(row, filters));
          return Promise.resolve({ data: rows[0] ?? null, error: null });
        },
        then(
          resolve: (value: { data: Row[] | null; error: { code?: string } | null }) => unknown,
          reject?: (reason: unknown) => unknown
        ) {
          const rows = (db[table as "shows"] ?? []).filter((row) => matches(row, filters));
          if (patch && table === "shows") {
            const status = patch.ownership_status;
            if (status === "claimed") db.claimedWrites += 1;
            if (status === "claimed" && db.checkViolation) {
              return Promise.resolve({ data: null, error: { code: "23514" } }).then(resolve, reject);
            }
            for (const row of rows) Object.assign(row, patch);
          }
          return Promise.resolve({ data: rows, error: null }).then(resolve, reject);
        },
      };
      return api;
    },
    rpc(name: string, args: { lookup?: string }) {
      if (name !== "auth_user_ids_for_email") {
        return Promise.resolve({ data: null, error: { code: "42883" } });
      }
      const lookup = String(args.lookup ?? "").toLowerCase();
      const ids = db.authUsers
        .filter((user) => user.email.toLowerCase() === lookup)
        .map((user) => user.id);
      return Promise.resolve({ data: ids, error: null });
    },
  },
}));

import { claimLookup, stampRankingOwnership, syncShowClaim, writeOwnershipStatus } from "./persist";

const SHOW = "11111111-1111-4111-8111-111111111111";
const PROFILE = "22222222-2222-4222-8222-222222222222";
const USER = "33333333-3333-4333-8333-333333333333";

beforeEach(() => {
  db.shows = [];
  db.deals = [];
  db.show_profiles = [];
  db.authUsers = [];
  db.claimedWrites = 0;
  db.checkViolation = false;
  warn.mockReset();
  vi.spyOn(console, "warn").mockImplementation(warn);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ownership writes before and after migration 100", () => {
  it("logs only 23514 and continues when claimed is rejected", async () => {
    db.checkViolation = true;
    db.shows.push({ id: SHOW, ownership_status: "unclaimed" });
    const written = await writeOwnershipStatus(SHOW, "claimed");
    expect(written).toEqual({ ok: false, code: "23514", unsupported: true });
    expect(db.shows[0].ownership_status).toBe("unclaimed");
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]).toEqual(["[ownership]", "23514"]);
    expect(JSON.stringify(warn.mock.calls)).not.toContain(SHOW);
    expect(JSON.stringify(warn.mock.calls)).not.toContain("@");
  });

  it("stores claimed after the check allows it", async () => {
    db.shows.push({ id: SHOW, ownership_status: "unclaimed" });
    const written = await writeOwnershipStatus(SHOW, "claimed");
    expect(written).toEqual({ ok: true });
    expect(db.shows[0].ownership_status).toBe("claimed");
    expect(warn).not.toHaveBeenCalled();
  });

  it("does not downgrade verified when a claim sync runs", async () => {
    db.shows.push({ id: SHOW, ownership_status: "verified" });
    db.deals.push({ show_id: SHOW, show_profile_id: PROFILE });
    await syncShowClaim(SHOW);
    expect(db.shows[0].ownership_status).toBe("verified");
    expect(db.claimedWrites).toBe(0);
  });

  it("sets claimed from a show profile on a deal, then returns to unclaimed when that link is gone", async () => {
    db.shows.push({ id: SHOW, ownership_status: "unclaimed" });
    db.deals.push({ show_id: SHOW, show_profile_id: PROFILE });
    await syncShowClaim(SHOW);
    expect(db.shows[0].ownership_status).toBe("claimed");

    db.deals = [];
    await syncShowClaim(SHOW);
    expect(db.shows[0].ownership_status).toBe("unclaimed");
  });

  it("sets claimed for a show_owner row tied to a show profile login", async () => {
    db.shows.push({
      id: SHOW,
      ownership_status: "unclaimed",
      data_sources: ["show_owner"],
      contact_email: "Host@Show.test",
    });
    db.authUsers.push({ id: USER, email: "host@show.test" });
    db.show_profiles.push({ id: PROFILE, user_id: USER });
    await syncShowClaim(SHOW);
    expect(db.shows[0].ownership_status).toBe("claimed");
  });

  it("does not treat a show_owner email without a profile as claimed", async () => {
    db.shows.push({
      id: SHOW,
      ownership_status: "unclaimed",
      data_sources: ["show_owner"],
      contact_email: "host@show.test",
    });
    db.authUsers.push({ id: USER, email: "host@show.test" });
    const lookup = await claimLookup([
      { id: SHOW, contact_email: "host@show.test", data_sources: ["show_owner"] },
    ]);
    expect(lookup).toEqual({ ok: true, ids: new Set() });
  });

  it("stamps claimed in memory when the column is still unclaimed", async () => {
    db.deals.push({ show_id: SHOW, show_profile_id: PROFILE });
    const candidate: { ownership_status?: "unclaimed" | "claimed" | "verified" } = {
      ownership_status: "unclaimed",
    };
    await stampRankingOwnership([
      { candidate, stored: { id: SHOW, ownership_status: "unclaimed" } },
    ]);
    expect(candidate.ownership_status).toBe("claimed");
    expect(db.claimedWrites).toBe(0);
  });

  it("copies a stored verified tier and does not overwrite it with a claim", async () => {
    db.deals.push({ show_id: SHOW, show_profile_id: PROFILE });
    const candidate: { ownership_status?: "unclaimed" | "claimed" | "verified" } = {};
    await stampRankingOwnership([
      { candidate, stored: { id: SHOW, ownership_status: "verified" } },
    ]);
    expect(candidate.ownership_status).toBe("verified");
  });
});
