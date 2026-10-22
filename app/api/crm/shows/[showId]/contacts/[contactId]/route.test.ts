import { beforeEach, describe, expect, it, vi } from "vitest";

const BRAND = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const SHOW = "8f3c1a20-4b6e-4c11-9a2d-111111111111";
const CONTACT = "33333333-3333-4333-8333-333333333333";

type Row = Record<string, unknown>;

const tables: Record<string, Row[]> = {};

function resetContacts() {
  tables.brand_show_contacts = [
    {
      id: CONTACT,
      brand_id: OTHER,
      show_id: SHOW,
      name: "Maya Chen",
      email: null,
      role: null,
      phone: null,
    },
  ];
}

function from(table: string) {
  const query: {
    op: "select" | "update" | "delete";
    filters: { column: string; value: unknown }[];
    payload: Row;
  } = { op: "select", filters: [], payload: {} };

  const matched = () =>
    (tables[table] ?? []).filter((row) =>
      query.filters.every((filter) => row[filter.column] === filter.value),
    );

  const run = () => {
    const rows = matched();
    if (query.op === "update") {
      for (const row of rows) Object.assign(row, query.payload);
    }
    if (query.op === "delete") {
      const hit = new Set(rows);
      tables[table] = (tables[table] ?? []).filter((row) => !hit.has(row));
    }
    return { data: rows, error: null as null };
  };

  const api = {
    update(payload: Row) {
      query.op = "update";
      query.payload = payload;
      return api;
    },
    delete() {
      query.op = "delete";
      return api;
    },
    eq(column: string, value: unknown) {
      query.filters.push({ column, value });
      return api;
    },
    select() {
      return api;
    },
    single() {
      const result = run();
      if (result.data.length !== 1) {
        return Promise.resolve({
          data: null,
          error: {
            code: "PGRST116",
            message: "JSON object requested, multiple (or no) rows returned",
          },
        });
      }
      return Promise.resolve({ data: result.data[0], error: null });
    },
    then(resolve: (value: { data: Row[]; error: null }) => unknown) {
      return Promise.resolve(run()).then(resolve);
    },
  };
  return api;
}

vi.mock("@/lib/data/queries", () => ({
  getAuthenticatedUser: vi.fn(async () => ({ id: BRAND })),
  getEffectiveRole: vi.fn(async () => ({ effectiveRole: "brand" })),
}));

vi.mock("@/lib/entitlements/plan", async () => {
  const actual = await vi.importActual<typeof import("@/lib/entitlements/plan")>(
    "@/lib/entitlements/plan",
  );
  return { ...actual, getProfilePlanId: vi.fn(async () => "starter") };
});

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    from,
    auth: {
      getUser: async () => ({ data: { user: { id: BRAND } }, error: null }),
    },
  })),
}));

import { DELETE, PATCH } from "./route";

function contactParams() {
  return { params: Promise.resolve({ showId: SHOW, contactId: CONTACT }) };
}

beforeEach(() => {
  resetContacts();
});

describe("cross-brand contact writes", () => {
  it("returns 404 for PATCH and DELETE on another brand's contact", async () => {
    const patch = await PATCH(
      new Request("http://x/api/crm/contacts", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Maya C." }),
      }),
      contactParams(),
    );
    expect(patch.status).toBe(404);
    expect(await patch.json()).toEqual({ error: "Not found" });
    expect(tables.brand_show_contacts[0]?.name).toBe("Maya Chen");

    const removed = await DELETE(
      new Request("http://x/api/crm/contacts", { method: "DELETE" }),
      contactParams(),
    );
    expect(removed.status).toBe(404);
    expect(await removed.json()).toEqual({ error: "Contact not found." });
    expect(tables.brand_show_contacts).toHaveLength(1);
  });
});
