import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;

const db: Record<string, Row[]> = {
  shows: [],
  deals: [],
  outreaches: [],
  show_contacts: [],
  show_profiles: [],
  domain_events: [],
  show_ownership_proofs: [],
  users: [],
};

function matches(row: Row, filters: Array<{ op: string; column: string; value: unknown }>): boolean {
  return filters.every((filter) => {
    const cell = row[filter.column];
    if (filter.op === "in") return Array.isArray(filter.value) && (filter.value as unknown[]).includes(cell);
    return cell === filter.value;
  });
}

vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: {
    from(table: string) {
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
          return api;
        },
        maybeSingle() {
          const rows = (db[table] ?? []).filter((row) => matches(row, filters));
          return Promise.resolve({ data: rows[0] ?? null, error: null });
        },
        then(
          resolve: (value: { data: Row[] | null; error: null }) => unknown,
          reject?: (reason: unknown) => unknown
        ) {
          const rows = (db[table] ?? []).filter((row) => matches(row, filters));
          return Promise.resolve({ data: rows, error: null }).then(resolve, reject);
        },
      };
      return api;
    },
    auth: {
      admin: {
        getUserById(id: string) {
          const user = (db.users ?? []).find((row) => row.id === id) ?? null;
          return Promise.resolve({ data: { user }, error: null });
        },
      },
    },
  },
}));

import { canEditShow } from "@/lib/shows/can-edit-show";

const USER = "11111111-1111-4111-8111-111111111111";
const SHOW = "22222222-2222-4222-8222-222222222222";
const PROFILE = "33333333-3333-4333-8333-333333333333";
const DEAL = "66666666-6666-4666-8666-666666666666";
const OUTREACH = "77777777-7777-4777-8777-777777777777";

function seed() {
  db.users.push({
    id: USER,
    email: "host@show.test",
    email_confirmed_at: "2026-01-01T00:00:00.000Z",
  });
  db.shows.push({
    id: SHOW,
    contact_email: "real-host@show.test",
    data_sources: ["podscan"],
    slug: "real-show",
  });
  db.show_profiles.push({ id: PROFILE, user_id: USER });
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
    sent_to_email: "host@show.test",
    response_status: "accepted",
  });
}

beforeEach(() => {
  for (const key of Object.keys(db)) db[key] = [];
  delete process.env.INTERNAL_ADMIN_EMAILS;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("sourced deal edit grant", () => {
  it("refuses a sourced accept when no show actor was recorded", async () => {
    seed();
    db.show_contacts.push({ show_id: SHOW, email: "host@show.test", source: "podscan" });
    expect(await canEditShow(USER, SHOW)).toBe(false);
  });

  it("allows a future signed-in show action and rejects a declined deal", async () => {
    seed();
    db.show_contacts.push({ show_id: SHOW, email: "host@show.test", source: "apple_rss" });
    db.domain_events.push({
      actor_id: USER,
      entity_type: "outreach",
      entity_id: OUTREACH,
      event_type: "io.show_signed",
    });
    expect(await canEditShow(USER, SHOW)).toBe(true);

    db.outreaches[0].response_status = "declined";
    db.deals[0].status = "cancelled";
    db.deals[0].show_signed_at = null;
    expect(await canEditShow(USER, SHOW)).toBe(false);

    db.outreaches[0].response_status = "accepted";
    db.deals[0].status = "show_signed";
    db.deals[0].show_signed_at = "2026-04-01T00:00:00.000Z";
    db.show_contacts[0].source = "brand";
    expect(await canEditShow(USER, SHOW)).toBe(false);
  });
});
