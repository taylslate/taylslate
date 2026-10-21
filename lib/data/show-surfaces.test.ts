import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ShowProfile } from "@/lib/data/types";
import type { ShowSurfaceDraft } from "@/lib/shows/surfaces";

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
  show_surfaces: [] as Row[],
};

const filtersSeen: Array<{ table: string; filters: Filter[] }> = [];

const { createShow } = vi.hoisted(() => ({
  createShow: vi.fn(),
}));

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
  if (table === "show_surfaces") return db.show_surfaces;
  return [];
}

vi.mock("@/lib/data/queries", () => ({
  createShow: (...args: unknown[]) => createShow(...args),
}));

vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: {
    from(table: string) {
      const filters: Filter[] = [];
      let mode: "select" | "insert" | "delete" = "select";
      let inserted: Row[] = [];
      const api = {
        select() {
          return api;
        },
        insert(rows: Row[]) {
          mode = "insert";
          inserted = rows;
          return api;
        },
        delete() {
          mode = "delete";
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
        limit() {
          return api;
        },
        maybeSingle() {
          filtersSeen.push({ table, filters: [...filters] });
          const hit = rowsFor(table).find((row) => matches(row, filters)) ?? null;
          return Promise.resolve({ data: hit, error: null });
        },
        then(
          resolve: (value: { data: Row[] | null; error: null }) => unknown,
          reject?: (err: unknown) => unknown
        ) {
          try {
            filtersSeen.push({ table, filters: [...filters] });
            if (mode === "insert") {
              return Promise.resolve({ data: inserted, error: null }).then(resolve, reject);
            }
            if (mode === "delete") {
              return Promise.resolve({ data: [], error: null }).then(resolve, reject);
            }
            const hits = rowsFor(table).filter((row) => matches(row, filters));
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

import { replaceOwnerSurfaces } from "./show-surfaces";

const CATALOG = "11111111-1111-4111-8111-111111111111";
const OWNER_SHOW = "22222222-2222-4222-8222-222222222222";

function profile(over: Partial<ShowProfile> = {}): ShowProfile {
  return {
    id: "prof-1",
    user_id: "user-1",
    show_name: "Recovery Lab",
    platform: "podcast",
    podscan_id: "pd_recovery",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...over,
  };
}

function draft(): ShowSurfaceDraft {
  return {
    type: "newsletter",
    audience_size: 1000,
    format: "Dedicated",
    min_buy: null,
    creative_constraints: null,
    lead_time_days: null,
    posting_owner: "creator",
    price: 500,
    notes: null,
    published: false,
  };
}

beforeEach(() => {
  db.shows = [
    {
      id: CATALOG,
      podscan_id: "pd_recovery",
      slug: "recovery-lab",
      contact_email: "someone-else@recovery.test",
      data_sources: ["podscan"],
    },
  ];
  db.show_profiles = [{ id: "prof-1", user_id: "user-1" }];
  db.profiles = [{ id: "user-1", email: "host@recovery.test" }];
  db.deals = [];
  db.show_surfaces = [];
  filtersSeen.length = 0;
  createShow.mockReset();
  createShow.mockResolvedValue({ id: "created-show" });
});

describe("replaceOwnerSurfaces catalog show", () => {
  it("does not attach a catalog show that only shares a podscan id", async () => {
    const saved = await replaceOwnerSurfaces("user-1", "host@recovery.test", profile(), [draft()]);
    expect(saved?.[0]?.show_id).toBe("created-show");
    expect(createShow).toHaveBeenCalledOnce();
    expect(filtersSeen.some((call) => call.filters.some((filter) => filter.column === "podscan_id"))).toBe(
      false
    );
  });

  it("attaches the catalog show a deal ties to this profile", async () => {
    db.deals = [{ show_id: CATALOG, show_profile_id: "prof-1" }];
    const saved = await replaceOwnerSurfaces("user-1", "host@recovery.test", profile(), [draft()]);
    expect(saved?.[0]?.show_id).toBe(CATALOG);
    expect(createShow).not.toHaveBeenCalled();
    expect(filtersSeen.some((call) => call.filters.some((filter) => filter.column === "podscan_id"))).toBe(
      false
    );
  });

  it("attaches the show_owner row whose contact email matches the login", async () => {
    db.shows.push({
      id: OWNER_SHOW,
      podscan_id: "pd_other",
      slug: "owner-user-1",
      contact_email: "host@recovery.test",
      data_sources: ["show_owner"],
    });
    const saved = await replaceOwnerSurfaces("user-1", "host@recovery.test", profile(), [draft()]);
    expect(saved?.[0]?.show_id).toBe(OWNER_SHOW);
    expect(createShow).not.toHaveBeenCalled();
  });

  it("escapes ilike wildcards in the owner email", async () => {
    db.profiles[0].email = "host_a%@recovery.test";
    await replaceOwnerSurfaces("user-1", "host_a%@recovery.test", profile(), [draft()]);
    const ilike = filtersSeen
      .flatMap((call) => call.filters)
      .find((filter) => filter.op === "ilike" && filter.column === "contact_email");
    expect(ilike?.value).toBe("host\\_a\\%@recovery.test");
  });
});
