import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;

const db: Record<string, Row[]> = {
  deals: [],
  shows: [],
  show_profiles: [],
  show_ownership_proofs: [],
  show_sponsors: [],
  brand_profiles: [],
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
        contains() {
          return api;
        },
        ilike() {
          return api;
        },
        maybeSingle() {
          const rows = (db[table] ?? []).filter((row) => matches(row, filters));
          return Promise.resolve({ data: rows[0] ?? null, error: null });
        },
        then(
          resolve: (value: { data: Row[]; error: null }) => unknown,
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
          const user = db.users.find((row) => row.id === id) ?? null;
          return Promise.resolve({ data: { user }, error: null });
        },
      },
    },
    rpc() {
      return Promise.resolve({ data: [], error: null });
    },
  },
}));

import { loadMarketSignalsForShows } from "./load-market-signals";

const SHOW = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";

beforeEach(() => {
  for (const key of Object.keys(db)) db[key] = [];
});

describe("market signal ties", () => {
  it("does not add host history from a deal-only profile tie", async () => {
    db.deals.push({
      show_id: SHOW,
      show_profile_id: "profile-9",
      status: "planning",
      price_type: "cpm",
      cpm_rate: null,
    });
    db.show_profiles.push({
      id: "profile-9",
      user_id: USER,
      brand_history: [{ brand_name: "Whoop", category: "Wearables", deal_type: "one-off" }],
      expected_cpm: 40,
      audience_geography: { uk: 99 },
    });
    db.users.push({
      id: USER,
      email: "host@show.test",
      email_confirmed_at: "2026-01-01T00:00:00.000Z",
    });
    db.shows.push({
      id: SHOW,
      contact_email: "host@show.test",
      data_sources: ["podscan"],
      slug: "real-show",
    });

    const result = await loadMarketSignalsForShows(
      [
        {
          showId: SHOW,
          currentSponsors: [],
          pastSponsors: [],
          audienceSize: 40000,
          isEstimate: true,
          costBasis: "derived",
          cpmUsedCents: 2200,
          rateCard: { midroll_cpm: 22 },
        },
      ],
      { productCategory: null, exclusions: null, exclusionText: null }
    );
    const text = result[SHOW].map((signal) => signal.value).join(" ");
    expect(text).not.toContain("Whoop");
    expect(text).not.toContain("$40");
  });
});
