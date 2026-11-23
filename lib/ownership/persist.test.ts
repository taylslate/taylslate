import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ownerShowSlug } from "@/lib/shows/surfaces";

type Row = Record<string, unknown>;

const db: Record<string, Row[]> = {
  shows: [],
  deals: [],
  outreaches: [],
  show_contacts: [],
  show_profiles: [],
  domain_events: [],
  users: [],
};

const calls: string[] = [];
let checkViolation = false;
let staleUnclaimedRead = false;
let authErrorCode = "";
const warn = vi.fn();

function matches(row: Row, filters: Array<{ op: string; column: string; value: unknown }>): boolean {
  return filters.every((filter) => {
    const cell = row[filter.column];
    if (filter.op === "in") return Array.isArray(filter.value) && (filter.value as unknown[]).includes(cell);
    if (filter.op === "neq") return cell !== filter.value;
    return cell === filter.value;
  });
}

function tableOf(name: string): Row[] {
  return db[name] ?? [];
}

vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: {
    from(table: string) {
      return builder(table);
    },
    auth: {
      admin: {
        getUserById(id: string) {
          calls.push("auth.admin.getUserById");
          if (authErrorCode) {
            return Promise.resolve({ data: { user: null }, error: { code: authErrorCode } });
          }
          const user = (db.users ?? []).find((row) => row.id === id) ?? null;
          return Promise.resolve({ data: { user }, error: null });
        },
      },
    },
  },
}));

function builder(table: string) {
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
    neq(column: string, value: unknown) {
      filters.push({ op: "neq", column, value });
      return api;
    },
    in(column: string, value: unknown) {
      filters.push({ op: "in", column, value });
      calls.push(`${table}.in.${column}`);
      return api;
    },
    update(next: Row) {
      patch = next;
      return api;
    },
    maybeSingle() {
      const rows = tableOf(table).filter((row) => matches(row, filters));
      if (staleUnclaimedRead && table === "shows") {
        return Promise.resolve({
          data: rows[0] ? { ...rows[0], ownership_status: "unclaimed" } : null,
          error: null,
        });
      }
      return Promise.resolve({ data: rows[0] ?? null, error: null });
    },
    then(
      resolve: (value: { data: Row[] | null; error: { code?: string } | null }) => unknown,
      reject?: (reason: unknown) => unknown
    ) {
      const rows = tableOf(table).filter((row) => matches(row, filters));
      if (patch && table === "shows") {
        if (patch.ownership_status === "claimed" && checkViolation) {
          return Promise.resolve({ data: null, error: { code: "23514" } }).then(resolve, reject);
        }
        for (const row of rows) Object.assign(row, patch);
      }
      return Promise.resolve({ data: rows, error: null }).then(resolve, reject);
    },
  };
  return api;
}

import { claimLookup, stampRankingOwnership, syncShowClaim, writeOwnershipStatus } from "./persist";

const SHOW = "11111111-1111-4111-8111-111111111111";
const SHOW_B = "22222222-2222-4222-8222-222222222222";
const PROFILE = "33333333-3333-4333-8333-333333333333";
const USER = "44444444-4444-4444-8444-444444444444";
const BRAND = "55555555-5555-4555-8555-555555555555";
const DEAL = "66666666-6666-4666-8666-666666666666";
const OUTREACH = "77777777-7777-4777-8777-777777777777";

function qualifyingDeal() {
  db.shows.push({ id: SHOW, ownership_status: "unclaimed", podscan_id: "pd_show" });
  db.deals.push({
    id: DEAL,
    show_id: SHOW,
    show_profile_id: PROFILE,
    outreach_id: OUTREACH,
    status: "show_signed",
    show_signed_at: "2026-04-01T00:00:00.000Z",
  });
  db.outreaches.push({
    id: OUTREACH,
    response_status: "accepted",
    sent_to_email: "host@show.test",
  });
  db.show_contacts.push({
    show_id: SHOW,
    podscan_id: "pd_show",
    email: "host@show.test",
    source: "podscan",
  });
  db.show_profiles.push({ id: PROFILE, user_id: USER });
  db.domain_events.push({
    actor_id: USER,
    entity_type: "deal",
    entity_id: DEAL,
    event_type: "deal.created",
  });
  db.users.push({
    id: USER,
    email: "host@show.test",
    email_confirmed_at: "2026-01-01T00:00:00.000Z",
  });
}

beforeEach(() => {
  for (const key of Object.keys(db)) db[key] = [];
  calls.length = 0;
  checkViolation = false;
  staleUnclaimedRead = false;
  authErrorCode = "";
  warn.mockReset();
  vi.spyOn(console, "warn").mockImplementation(warn);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("tight claim rule", () => {
  it("does not claim a show from a deal profile alone", async () => {
    db.shows.push({ id: SHOW, ownership_status: "unclaimed" });
    db.deals.push({ id: DEAL, show_id: SHOW, show_profile_id: PROFILE, status: "planning" });
    await syncShowClaim(SHOW);
    expect(db.shows[0].ownership_status).toBe("unclaimed");
  });

  it("covers a future signed-in show action, not a current accept route", async () => {
    // Current token accept, counter accept, and the DocuSign webhook do not
    // record the show user as actor_id. This fixture is that future event.
    qualifyingDeal();
    await syncShowClaim(SHOW);
    expect(db.shows[0].ownership_status).toBe("claimed");
    expect(calls.filter((call) => call === "auth.admin.getUserById").length).toBeGreaterThan(0);
  });

  it("does not claim a declined or unsigned deal", async () => {
    qualifyingDeal();
    db.outreaches[0].response_status = "declined";
    db.deals[0].show_signed_at = null;
    db.deals[0].status = "cancelled";
    await syncShowClaim(SHOW);
    expect(db.shows[0].ownership_status).toBe("unclaimed");
  });

  it("does not claim when the recorded actor is the brand", async () => {
    qualifyingDeal();
    db.domain_events[0].actor_id = BRAND;
    await syncShowClaim(SHOW);
    expect(db.shows[0].ownership_status).toBe("unclaimed");
  });

  it("does not claim a brand-typed email that is not a sourced contact", async () => {
    qualifyingDeal();
    db.show_contacts[0].email = "other@show.test";
    await syncShowClaim(SHOW);
    expect(db.shows[0].ownership_status).toBe("unclaimed");
  });

  it("does not claim when the show login is unconfirmed", async () => {
    qualifyingDeal();
    db.users[0].email_confirmed_at = null;
    await syncShowClaim(SHOW);
    expect(db.shows[0].ownership_status).toBe("unclaimed");
  });

  it("claims a server owner slug for a confirmed login and ignores a forged slug", async () => {
    db.shows.push(
      {
        id: SHOW,
        ownership_status: "unclaimed",
        data_sources: ["show_owner"],
        slug: ownerShowSlug(USER),
        contact_email: "Host@Show.test",
      },
      {
        id: SHOW_B,
        ownership_status: "unclaimed",
        data_sources: ["show_owner"],
        slug: "odd-lots",
        contact_email: "Host@Show.test",
      }
    );
    db.show_profiles.push({ id: PROFILE, user_id: USER });
    db.users.push({
      id: USER,
      email: "host@show.test",
      email_confirmed_at: "2026-01-01T00:00:00.000Z",
    });
    const lookup = await claimLookup([
      {
        id: SHOW,
        data_sources: ["show_owner"],
        slug: ownerShowSlug(USER),
        contact_email: "Host@Show.test",
      },
      {
        id: SHOW_B,
        data_sources: ["show_owner"],
        slug: "odd-lots",
        contact_email: "Host@Show.test",
      },
    ]);
    expect(lookup).toEqual({ ok: true, ids: new Set([SHOW]) });
    const profileReads = calls.filter((call) => call === "show_profiles.in.user_id");
    const authReads = calls.filter((call) => call === "auth.admin.getUserById");
    expect(profileReads).toHaveLength(1);
    expect(authReads).toHaveLength(1);
  });

  it("fails closed when getUserById errors and does not use an auth schema", async () => {
    qualifyingDeal();
    authErrorCode = "500";
    const lookup = await claimLookup([{ id: SHOW, podscan_id: "pd_show" }]);
    expect(lookup).toEqual({ ok: false });
    expect(warn.mock.calls.some((call) => call[0] === "[ownership]" && call[1] === "500")).toBe(true);
    expect(JSON.stringify(warn.mock.calls)).not.toContain("@");
    const admin = (await import("@/lib/supabase/admin")).supabaseAdmin as { schema?: unknown };
    expect(admin.schema).toBeUndefined();
  });

  it("logs only 23514 and continues when claimed is rejected", async () => {
    checkViolation = true;
    db.shows.push({ id: SHOW, ownership_status: "unclaimed" });
    const written = await writeOwnershipStatus(SHOW, "claimed");
    expect(written).toEqual({ ok: false, code: "23514", unsupported: true });
    expect(db.shows[0].ownership_status).toBe("unclaimed");
    expect(warn.mock.calls[0]).toEqual(["[ownership]", "23514"]);
    expect(JSON.stringify(warn.mock.calls)).not.toContain(SHOW);
    expect(JSON.stringify(warn.mock.calls)).not.toContain("@");
  });

  it("does not downgrade verified when the read is stale", async () => {
    staleUnclaimedRead = true;
    db.shows.push({ id: SHOW, ownership_status: "verified" });
    const written = await writeOwnershipStatus(SHOW, "claimed");
    expect(written.ok).toBe(true);
    expect(db.shows[0].ownership_status).toBe("verified");
  });

  it("stamps a qualifying deal in memory and leaves a bare profile link unclaimed", async () => {
    qualifyingDeal();
    const qualified: { ownership_status?: "unclaimed" | "claimed" | "verified" } = {
      ownership_status: "unclaimed",
    };
    const bare: { ownership_status?: "unclaimed" | "claimed" | "verified" } = {
      ownership_status: "unclaimed",
    };
    await stampRankingOwnership([
      { candidate: qualified, stored: { id: SHOW, ownership_status: "unclaimed", podscan_id: "pd_show" } },
      { candidate: bare, stored: { id: SHOW_B, ownership_status: "unclaimed" } },
    ]);
    expect(qualified.ownership_status).toBe("claimed");
    expect(bare.ownership_status).toBe("unclaimed");
  });
});
