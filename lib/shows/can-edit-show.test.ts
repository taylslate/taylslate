import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ownerShowSlug } from "@/lib/shows/surfaces";

type Row = Record<string, unknown>;

const db: Record<string, Row[]> = {
  shows: [],
  deals: [],
  outreaches: [],
  show_profiles: [],
  domain_events: [],
  show_ownership_proofs: [],
  users: [],
  profiles: [],
  agent_show_relationships: [],
};

const tables: string[] = [];
let authErrorCode = "";
const warn = vi.fn();

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
          return api;
        },
        maybeSingle() {
          const rows = (db[table] ?? []).filter((row) => matches(row, filters));
          return Promise.resolve({ data: rows[0] ?? null, error: null });
        },
        then(
          resolve: (value: { data: Row[] | null; error: { code?: string } | null }) => unknown,
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

import { canEditShow, isShowsAdmin, showWritePatch } from "./can-edit-show";
import { showEditGrantIds } from "@/lib/ownership/edit-rights";

const USER = "11111111-1111-4111-8111-111111111111";
const OTHER = "99999999-9999-4999-8999-999999999999";
const SHOW = "22222222-2222-4222-8222-222222222222";
const SHOW_B = "88888888-8888-4888-8888-888888888888";
const PROFILE = "33333333-3333-4333-8333-333333333333";
const BRAND = "55555555-5555-4555-8555-555555555555";
const DEAL = "66666666-6666-4666-8666-666666666666";
const OUTREACH = "77777777-7777-4777-8777-777777777777";

function confirm(id: string, email: string, confirmed = true) {
  db.users.push({
    id,
    email,
    email_confirmed_at: confirmed ? "2026-01-01T00:00:00.000Z" : null,
  });
}

function ownerRow(id: string, userId: string, email: string, slug = ownerShowSlug(userId)) {
  db.shows.push({
    id,
    contact_email: email,
    data_sources: ["show_owner"],
    slug,
  });
  db.show_profiles.push({ id: PROFILE, user_id: userId });
}

function acceptedDeal() {
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
    sent_to_email: "second@brand.test",
    response_status: "accepted",
  });
}

beforeEach(() => {
  for (const key of Object.keys(db)) db[key] = [];
  tables.length = 0;
  authErrorCode = "";
  warn.mockReset();
  vi.spyOn(console, "warn").mockImplementation(warn);
  delete process.env.INTERNAL_ADMIN_EMAILS;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("canEditShow", () => {
  it("allows an internal admin from the auth login, not profiles.email", async () => {
    process.env.INTERNAL_ADMIN_EMAILS = "ops@taylslate.com";
    confirm(USER, "ops@taylslate.com");
    db.profiles.push({ id: USER, email: "attacker@example.test", role: "brand" });
    expect(await canEditShow(USER, SHOW)).toBe(true);
    expect(await isShowsAdmin(USER)).toBe(true);
    expect(tables).not.toContain("profiles");

    db.users[0].email = "attacker@example.test";
    db.profiles[0].email = "ops@taylslate.com";
    db.profiles[0].role = "admin";
    expect(await canEditShow(USER, SHOW)).toBe(false);
    expect(await isShowsAdmin(USER)).toBe(false);
    expect(tables).not.toContain("profiles");
  });

  it("does not grant an unconfirmed admin login", async () => {
    process.env.INTERNAL_ADMIN_EMAILS = "ops@taylslate.com";
    confirm(USER, "ops@taylslate.com", false);
    expect(await canEditShow(USER, SHOW)).toBe(false);
    expect(await isShowsAdmin(USER)).toBe(true);
  });

  it("does not grant edit to an approved roster link", async () => {
    confirm(USER, "rep@taylslate.com");
    db.shows.push({ id: SHOW, agent_id: USER, contact_email: "", data_sources: [] });
    db.agent_show_relationships.push({
      id: "rel",
      agent_id: USER,
      show_id: SHOW,
      status: "approved",
    });
    expect(await canEditShow(USER, SHOW)).toBe(false);
    expect(tables).not.toContain("agent_show_relationships");
    expect(tables).not.toContain("profiles");
  });

  it("refuses a brand who accepts outreach on a second account", async () => {
    confirm(USER, "second@brand.test");
    confirm(BRAND, "brand@taylslate.com");
    acceptedDeal();
    db.domain_events.push({
      actor_id: BRAND,
      entity_type: "deal",
      entity_id: DEAL,
      event_type: "deal.created",
    });
    db.profiles.push({ id: USER, email: "real-host@show.test", role: "show" });
    expect(await canEditShow(USER, SHOW)).toBe(false);
    expect(tables).not.toContain("profiles");
    expect(JSON.stringify(warn.mock.calls)).not.toContain("@");
    expect(JSON.stringify(warn.mock.calls)).not.toContain(SHOW);
  });

  it("allows the server owner row and rejects a slug spoof", async () => {
    confirm(USER, "host@show.test");
    ownerRow(SHOW, USER, "Host@Show.test");
    ownerRow(SHOW_B, USER, "Host@Show.test", "odd-lots");
    db.show_profiles.length = 1;
    const granted = await showEditGrantIds(USER, [SHOW, SHOW_B]);
    expect(granted).toEqual(new Set([SHOW]));
    expect(await canEditShow(USER, SHOW)).toBe(true);
    expect(await canEditShow(USER, SHOW_B)).toBe(false);

    db.shows[1].slug = ownerShowSlug(OTHER);
    expect(await canEditShow(USER, SHOW_B)).toBe(false);
    expect(tables).not.toContain("profiles");
  });

  it("refuses an unconfirmed login on the owner row", async () => {
    confirm(USER, "host@show.test", false);
    ownerRow(SHOW, USER, "host@show.test");
    expect(await canEditShow(USER, SHOW)).toBe(false);
  });

  it("allows a verified proof tied to this user and ignores verified alone", async () => {
    confirm(USER, "host@show.test", false);
    db.shows.push({ id: SHOW, ownership_status: "verified", slug: "catalog" });
    db.show_ownership_proofs.push({
      show_id: SHOW,
      user_id: OTHER,
      status: "verified",
    });
    expect(await canEditShow(USER, SHOW)).toBe(false);

    db.show_ownership_proofs.push({
      show_id: SHOW,
      user_id: USER,
      status: "verified",
    });
    expect(await canEditShow(USER, SHOW)).toBe(true);

    db.show_ownership_proofs[1].status = "pending";
    expect(await canEditShow(USER, SHOW)).toBe(false);
  });

  it("logs a code only when the auth read fails", async () => {
    authErrorCode = "500";
    db.profiles.push({ id: USER, email: "host@show.test" });
    expect(await canEditShow(USER, SHOW)).toBe(false);
    expect(warn.mock.calls.some((call) => call[0] === "[show-edit]" && call[1] === "500")).toBe(true);
    expect(JSON.stringify(warn.mock.calls)).not.toContain("@");
    expect(JSON.stringify(warn.mock.calls)).not.toContain(SHOW);
    expect(tables).not.toContain("profiles");
  });
});

describe("showWritePatch", () => {
  it("keeps admin-only columns for an admin and drops them otherwise", () => {
    const body = {
      id: "x",
      created_at: "then",
      description: "updated",
      agent_id: USER,
      is_verified: true,
      is_claimed: true,
      podscan_id: "pod",
      is_discoverable: false,
      ownership_status: "verified",
      data_sources: ["show_owner"],
      slug: "owner-forged",
    };
    expect(showWritePatch(body, false)).toEqual({ description: "updated" });
    expect(showWritePatch(body, true)).toEqual({
      description: "updated",
      agent_id: USER,
      is_verified: true,
      is_claimed: true,
      podscan_id: "pod",
      is_discoverable: false,
      data_sources: ["show_owner"],
      slug: "owner-forged",
    });
  });
});
