import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;

interface Filter {
  op: "eq" | "in" | "contains" | "ilike";
  column: string;
  value: unknown;
}

const db = {
  shows: [] as Row[],
  show_profiles: [] as Row[],
  profiles: [] as Row[],
  deals: [] as Row[],
};

const filtersSeen: Array<{ table: string; filters: Filter[] }> = [];

function matches(row: Row, filters: Filter[]): boolean {
  return filters.every((filter) => {
    const cell = row[filter.column];
    if (filter.op === "eq") return cell === filter.value;
    if (filter.op === "in") return Array.isArray(filter.value) && filter.value.includes(cell);
    if (filter.op === "contains") {
      return (
        Array.isArray(cell) &&
        Array.isArray(filter.value) &&
        filter.value.every((item) => cell.includes(item))
      );
    }
    const wanted = String(filter.value).replace(/\\([\\%_])/g, "$1").toLowerCase();
    return typeof cell === "string" && cell.toLowerCase() === wanted;
  });
}

function rowsFor(table: string): Row[] {
  if (table === "shows") return db.shows;
  if (table === "show_profiles") return db.show_profiles;
  if (table === "profiles") return db.profiles;
  if (table === "deals") return db.deals;
  return [];
}

vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: {
    from(table: string) {
      const filters: Filter[] = [];
      let payload: Row | null = null;
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
        contains(column: string, value: unknown) {
          filters.push({ op: "contains", column, value });
          return api;
        },
        ilike(column: string, value: unknown) {
          filters.push({ op: "ilike", column, value });
          return api;
        },
        update(next: Row) {
          payload = next;
          return api;
        },
        maybeSingle() {
          filtersSeen.push({ table, filters: [...filters] });
          const hit = rowsFor(table).find((row) => matches(row, filters)) ?? null;
          return Promise.resolve({ data: hit, error: null });
        },
        then(resolve: (value: { data: Row[]; error: null }) => unknown, reject?: (err: unknown) => unknown) {
          try {
            filtersSeen.push({ table, filters: [...filters] });
            const hits = rowsFor(table).filter((row) => matches(row, filters));
            if (payload) {
              for (const row of hits) Object.assign(row, payload);
            }
            return Promise.resolve({ data: hits, error: null }).then(resolve, reject);
          } catch (err) {
            return Promise.reject(err).then(resolve, reject);
          }
        },
      };
      return api;
    },
  },
}));

import {
  applyAudienceGeographyToShow,
  getVerifiedAudienceGeography,
} from "./apply-geography";

const CATALOG_ID = "11111111-1111-1111-1111-111111111111";

function seedCatalog() {
  db.shows = [
    {
      id: CATALOG_ID,
      slug: "smartless",
      name: "SmartLess",
      podscan_id: "pd_smartless",
      contact_email: "host@smartless.com",
      data_sources: ["podscan"],
      demographics: { us: 70, male: 55 },
    },
  ];
  db.show_profiles = [
    {
      id: "prof-imposter",
      user_id: "user-imposter",
      show_name: "SmartLess",
      show_slug: "smartless",
      podscan_id: null,
      audience_geography: { uk: 99 },
    },
  ];
  db.profiles = [{ id: "user-imposter", email: "imposter@example.com" }];
  db.deals = [];
  filtersSeen.length = 0;
}

beforeEach(seedCatalog);

describe("audience geography ties", () => {
  it("does not write a same-name profile onto the catalog show", async () => {
    const ok = await applyAudienceGeographyToShow({
      id: "prof-imposter",
      user_id: "user-imposter",
      podscan_id: null,
      audience_geography: { uk: 99 },
    });
    expect(ok).toBe(true);
    expect(db.shows[0].demographics).toEqual({ us: 70, male: 55 });
    expect(filtersSeen.some((call) => call.filters.some((filter) => filter.column === "slug"))).toBe(
      false
    );
    expect(
      filtersSeen.some((call) => call.filters.some((filter) => filter.column === "show_slug"))
    ).toBe(false);
  });

  it("does not return that profile's geography for the catalog show", async () => {
    const rows = await getVerifiedAudienceGeography([
      {
        showId: CATALOG_ID,
        podscanId: "pd_smartless",
        contactEmail: "host@smartless.com",
        dataSources: ["podscan"],
      },
    ]);
    expect(rows).toEqual([]);
    expect(
      filtersSeen.some((call) => call.filters.some((filter) => filter.column === "show_slug"))
    ).toBe(false);
  });

  it("writes geography when the profile shares the catalog podscan id", async () => {
    db.show_profiles[0].podscan_id = "pd_smartless";
    const ok = await applyAudienceGeographyToShow({
      id: "prof-imposter",
      user_id: "user-imposter",
      podscan_id: "pd_smartless",
      audience_geography: { uk: 99 },
    });
    expect(ok).toBe(true);
    expect(db.shows[0].demographics).toEqual({ male: 55, uk: 99 });
  });

  it("writes geography when a deal links the profile to the catalog show", async () => {
    db.deals.push({ show_id: CATALOG_ID, show_profile_id: "prof-imposter" });
    const ok = await applyAudienceGeographyToShow({
      id: "prof-imposter",
      user_id: "user-imposter",
      audience_geography: { canada: 12 },
    });
    expect(ok).toBe(true);
    expect(db.shows[0].demographics).toMatchObject({ canada: 12, male: 55 });
  });

  it("writes geography onto the show_owner row with a matching contact email", async () => {
    db.shows[0].data_sources = ["show_owner"];
    db.shows[0].contact_email = "Imposter@Example.com";
    const ok = await applyAudienceGeographyToShow({
      id: "prof-imposter",
      user_id: "user-imposter",
      audience_geography: { australia: 8 },
    });
    expect(ok).toBe(true);
    expect(db.shows[0].demographics).toEqual({ male: 55, australia: 8 });
  });

  it("does not treat a matching contact email as ownership without show_owner", async () => {
    db.shows[0].contact_email = "imposter@example.com";
    const ok = await applyAudienceGeographyToShow({
      id: "prof-imposter",
      user_id: "user-imposter",
      audience_geography: { australia: 8 },
    });
    expect(ok).toBe(true);
    expect(db.shows[0].demographics).toEqual({ us: 70, male: 55 });
  });
});
