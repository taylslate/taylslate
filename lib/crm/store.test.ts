import { beforeEach, describe, expect, it, vi } from "vitest";
import fs from "fs";
import path from "path";

type Row = Record<string, unknown>;

interface QueryLog {
  table: string;
  op: "select" | "insert" | "update" | "delete";
  columns?: string;
  filters: { op: "eq" | "in"; column: string; value: unknown }[];
  or?: string;
  orders: { column: string; ascending: boolean }[];
  payload?: Row;
}

const tables: Record<string, Row[]> = {};
const log: QueryLog[] = [];
const failures: Record<string, string> = {};
let signedInUserId: string | null = null;

function resetDb(seed: Record<string, Row[]> = {}) {
  for (const key of Object.keys(tables)) delete tables[key];
  for (const [key, rows] of Object.entries(seed)) {
    tables[key] = rows.map((row) => ({ ...row }));
  }
  log.length = 0;
  for (const key of Object.keys(failures)) delete failures[key];
}

function splitTopLevel(expr: string): string[] {
  const parts: string[] = [];
  let current = "";
  let depth = 0;
  for (const char of expr) {
    if (char === "(") depth += 1;
    if (char === ")") depth -= 1;
    if (char === "," && depth === 0) {
      parts.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  if (current) parts.push(current);
  return parts;
}

function matchesOr(row: Row, expr: string): boolean {
  return splitTopLevel(expr).some((part) => {
    const eq = part.match(/^([a-z_]+)\.eq\.(.+)$/);
    if (eq) return String(row[eq[1]]) === eq[2];
    const inn = part.match(/^([a-z_]+)\.in\.\((.*)\)$/);
    if (inn) {
      const values = inn[2] ? inn[2].split(",") : [];
      return values.includes(String(row[inn[1]] ?? ""));
    }
    return false;
  });
}

function matches(row: Row, query: QueryLog): boolean {
  for (const filter of query.filters) {
    if (filter.op === "eq" && row[filter.column] !== filter.value) return false;
    if (filter.op === "in") {
      const values = filter.value as unknown[];
      if (!values.includes(row[filter.column])) return false;
    }
  }
  if (query.or && !matchesOr(row, query.or)) return false;
  return true;
}

function sortRows(rows: Row[], orders: QueryLog["orders"]): Row[] {
  if (orders.length === 0) return rows;
  return [...rows].sort((a, b) => {
    for (const order of orders) {
      const av = a[order.column];
      const bv = b[order.column];
      if (av === bv) continue;
      const cmp = String(av) < String(bv) ? -1 : 1;
      return order.ascending ? cmp : -cmp;
    }
    return 0;
  });
}

function from(table: string) {
  const query: QueryLog = { table, op: "select", filters: [], orders: [] };
  const run = () => {
    log.push(query);
    if (failures[table]) return { data: null, error: { message: failures[table] } };
    const source = tables[table] ?? [];
    const matched = source.filter((row) => matches(row, query));
    if (query.op === "insert") {
      const row = {
        id: `row-${source.length + 1}`,
        created_at: "2026-10-21T00:00:00.000Z",
        updated_at: "2026-10-21T00:00:00.000Z",
        ...query.payload,
      };
      source.push(row);
      tables[table] = source;
      return { data: query.columns ? [row] : null, error: null };
    }
    if (query.op === "update") {
      for (const row of matched) Object.assign(row, query.payload);
      return { data: query.columns ? matched : null, error: null };
    }
    if (query.op === "delete") {
      tables[table] = source.filter((row) => !matched.includes(row));
      return { data: query.columns ? matched : null, error: null };
    }
    return { data: sortRows(matched, query.orders), error: null };
  };

  const api = {
    select(columns?: string) {
      query.columns = columns ?? "*";
      return api;
    },
    insert(payload: Row) {
      query.op = "insert";
      query.payload = payload;
      return api;
    },
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
      query.filters.push({ op: "eq", column, value });
      return api;
    },
    in(column: string, value: unknown) {
      query.filters.push({ op: "in", column, value });
      return api;
    },
    or(expr: string) {
      query.or = expr;
      return api;
    },
    order(column: string, options?: { ascending?: boolean }) {
      query.orders.push({ column, ascending: options?.ascending !== false });
      return api;
    },
    single() {
      const result = run();
      if (result.error) return Promise.resolve({ data: null, error: result.error });
      const rows = (result.data ?? []) as Row[];
      if (rows.length !== 1) {
        return Promise.resolve({
          data: null,
          error: { message: "JSON object requested, multiple (or no) rows returned" },
        });
      }
      return Promise.resolve({ data: rows[0], error: null });
    },
    then(
      resolve: (value: { data: Row[] | null; error: { message: string } | null }) => unknown,
      reject?: (reason: unknown) => unknown
    ) {
      return Promise.resolve(run()).then(resolve, reject);
    },
  };
  return api;
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    from,
    auth: {
      getUser: async () => ({
        data: { user: signedInUserId ? { id: signedInUserId } : null },
        error: null,
      }),
    },
  })),
}));

import {
  addContact,
  addNote,
  deleteContact,
  listContacts,
  listCrmShows,
  listNotes,
  listShowDealHistory,
  updateContact,
} from "./store";

const BRAND = "11111111-1111-4111-8111-111111111111";
const SHOW = "22222222-2222-4222-8222-222222222222";
const SHOW_B = "33333333-3333-4333-8333-333333333333";
const SHOW_C = "44444444-4444-4444-8444-444444444444";
const OTHER = "55555555-5555-4555-8555-555555555555";
const PROFILE = "66666666-6666-4666-8666-666666666666";
const CONTACT = "77777777-7777-4777-8777-777777777777";

function calls(table: string) {
  return log.filter((entry) => entry.table === table);
}

describe("crm store", () => {
  beforeEach(() => {
    resetDb();
    signedInUserId = BRAND;
  });

  it("uses the signed-in user and rejects a different brandId", async () => {
    await listContacts(BRAND.toUpperCase(), SHOW);
    expect(calls("brand_show_contacts")[0]?.filters).toContainEqual({
      op: "eq",
      column: "brand_id",
      value: BRAND,
    });

    log.length = 0;
    signedInUserId = OTHER;
    await expect(listContacts(BRAND, SHOW)).rejects.toThrow(
      /brandId does not match the signed-in user/
    );
    await expect(
      addNote({ brandId: BRAND, showId: SHOW, body: "hello" })
    ).rejects.toThrow(/brandId does not match the signed-in user/);
    signedInUserId = null;
    await expect(listCrmShows(BRAND)).rejects.toThrow(/not signed in/);
    expect(log).toHaveLength(0);
  });

  it("uses the user server client and does not touch podscan or the service role", () => {
    const source = fs.readFileSync(path.join(__dirname, "store.ts"), "utf8");
    expect(source).toMatch(/from "@\/lib\/supabase\/server"/);
    expect(source).not.toMatch(/supabase\/admin/);
    expect(source).not.toMatch(/podscan/);
    expect(source).not.toMatch(/show_profiles/);
  });

  it("lists contacts for one brand and show", async () => {
    resetDb({
      brand_show_contacts: [
        {
          id: CONTACT,
          brand_id: BRAND,
          show_id: SHOW,
          name: "Ada",
          created_at: "2026-01-02T00:00:00.000Z",
        },
        {
          id: "88888888-8888-4888-8888-888888888888",
          brand_id: OTHER,
          show_id: SHOW,
          name: "Other brand",
          created_at: "2026-01-01T00:00:00.000Z",
        },
        {
          id: "99999999-9999-4999-8999-999999999999",
          brand_id: BRAND,
          show_id: SHOW_B,
          name: "Other show",
          created_at: "2026-01-03T00:00:00.000Z",
        },
      ],
    });
    const rows = await listContacts(BRAND, SHOW);
    expect(rows.map((row) => row.name)).toEqual(["Ada"]);
    expect(calls("brand_show_contacts")[0]).toMatchObject({
      op: "select",
      filters: [
        { op: "eq", column: "brand_id", value: BRAND },
        { op: "eq", column: "show_id", value: SHOW },
      ],
    });
  });

  it("adds a contact with a normalized email and rejects bad input before writing", async () => {
    const saved = await addContact({
      brandId: BRAND,
      showId: SHOW,
      name: "  Ada Lovelace  ",
      email: " Ada@Show.com ",
      role: " Host ",
      phone: " +1 555 ",
    });
    expect(saved.name).toBe("Ada Lovelace");
    expect(calls("brand_show_contacts")[0]?.payload).toEqual({
      brand_id: BRAND,
      show_id: SHOW,
      name: "Ada Lovelace",
      email: "ada@show.com",
      role: "Host",
      phone: "+1 555",
    });

    log.length = 0;
    await expect(addContact({ brandId: "brand", showId: SHOW, name: "Ada" })).rejects.toThrow(
      /brandId must be a uuid/
    );
    await expect(addContact({ brandId: BRAND, showId: SHOW, name: "   " })).rejects.toThrow(
      /name is required/
    );
    await expect(
      addContact({ brandId: BRAND, showId: SHOW, name: "A".repeat(201) })
    ).rejects.toThrow(/name must be 200 characters or fewer/);
    await expect(
      addContact({ brandId: BRAND, showId: SHOW, name: "Ada", email: "not-an-email" })
    ).rejects.toThrow(/email is not valid/);
    await expect(
      addContact({ brandId: BRAND, showId: SHOW, name: "Ada", role: "R".repeat(81) })
    ).rejects.toThrow(/role must be 80 characters or fewer/);
    await expect(
      addContact({ brandId: BRAND, showId: SHOW, name: "Ada", phone: "1".repeat(41) })
    ).rejects.toThrow(/phone must be 40 characters or fewer/);
    expect(log).toHaveLength(0);
  });

  it("updates and deletes a contact scoped to the brand and show", async () => {
    resetDb({
      brand_show_contacts: [
        {
          id: CONTACT,
          brand_id: BRAND,
          show_id: SHOW,
          name: "Ada",
          email: "ada@show.com",
          role: "Host",
          phone: "555",
        },
      ],
    });

    const updated = await updateContact({
      brandId: BRAND,
      showId: SHOW,
      contactId: CONTACT,
      email: null,
      phone: " 999 ",
    });
    expect(updated.email).toBeNull();
    expect(updated.phone).toBe("999");
    expect(updated.name).toBe("Ada");
    const update = calls("brand_show_contacts").find((entry) => entry.op === "update");
    expect(update?.payload).toEqual({ email: null, phone: "999" });
    expect(update?.filters).toEqual([
      { op: "eq", column: "id", value: CONTACT },
      { op: "eq", column: "brand_id", value: BRAND },
      { op: "eq", column: "show_id", value: SHOW },
    ]);

    log.length = 0;
    await expect(
      updateContact({ brandId: BRAND, showId: SHOW, contactId: CONTACT })
    ).rejects.toThrow(/nothing to update/);
    await expect(
      updateContact({ brandId: BRAND, showId: SHOW, contactId: CONTACT, email: "nope" })
    ).rejects.toThrow(/email is not valid/);
    expect(log).toHaveLength(0);

    await deleteContact({ brandId: BRAND, showId: SHOW, contactId: CONTACT });
    expect(calls("brand_show_contacts").some((entry) => entry.op === "delete")).toBe(true);
    await expect(
      deleteContact({ brandId: BRAND, showId: SHOW, contactId: CONTACT })
    ).rejects.toThrow(/contact not found/);
  });

  it("adds a trimmed note and lists notes newest first", async () => {
    await expect(addNote({ brandId: BRAND, showId: SHOW, body: "   " })).rejects.toThrow(
      /note must be between 1 and 2000 characters/
    );
    await expect(
      addNote({ brandId: BRAND, showId: SHOW, body: "n".repeat(2001) })
    ).rejects.toThrow(/note must be between 1 and 2000 characters/);
    expect(log).toHaveLength(0);

    await addNote({ brandId: BRAND, showId: SHOW, body: "  first flight held  " });
    expect(calls("brand_show_notes")[0]?.payload).toEqual({
      brand_id: BRAND,
      show_id: SHOW,
      body: "first flight held",
    });

    resetDb({
      brand_show_notes: [
        {
          id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          brand_id: BRAND,
          show_id: SHOW,
          body: "older",
          created_at: "2026-01-01T00:00:00.000Z",
        },
        {
          id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          brand_id: BRAND,
          show_id: SHOW,
          body: "newer",
          created_at: "2026-06-01T00:00:00.000Z",
        },
        {
          id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
          brand_id: OTHER,
          show_id: SHOW,
          body: "someone else",
          created_at: "2026-07-01T00:00:00.000Z",
        },
      ],
    });
    const notes = await listNotes(BRAND, SHOW);
    expect(notes.map((note) => note.body)).toEqual(["newer", "older"]);
    expect(calls("brand_show_notes")[0]?.orders).toEqual([
      { column: "created_at", ascending: false },
    ]);
  });

  it("reads deal history for deals the brand owns and does not write deals", async () => {
    resetDb({
      brand_profiles: [{ id: PROFILE, user_id: BRAND }],
      deals: [
        {
          id: "d1d1d1d1-d1d1-41d1-81d1-d1d1d1d1d1d1",
          show_id: SHOW,
          brand_id: BRAND,
          brand_profile_id: null,
          status: "completed",
          cpm_rate: "25.00",
          total_gross: 7500,
          created_at: "2026-01-01T00:00:00.000Z",
        },
        {
          id: "d2d2d2d2-d2d2-42d2-82d2-d2d2d2d2d2d2",
          show_id: SHOW,
          brand_id: OTHER,
          brand_profile_id: PROFILE,
          status: "live",
          cpm_rate: 30,
          created_at: "2026-05-01T00:00:00.000Z",
        },
        {
          id: "d3d3d3d3-d3d3-43d3-83d3-d3d3d3d3d3d3",
          show_id: SHOW,
          brand_id: OTHER,
          agent_id: BRAND,
          status: "planning",
          created_at: "2026-08-01T00:00:00.000Z",
        },
        {
          id: "d4d4d4d4-d4d4-44d4-84d4-d4d4d4d4d4d4",
          show_id: SHOW_B,
          brand_id: BRAND,
          status: "completed",
          created_at: "2026-09-01T00:00:00.000Z",
        },
      ],
    });

    const history = await listShowDealHistory(BRAND, SHOW);
    expect(history.map((deal) => deal.id)).toEqual([
      "d2d2d2d2-d2d2-42d2-82d2-d2d2d2d2d2d2",
      "d1d1d1d1-d1d1-41d1-81d1-d1d1d1d1d1d1",
    ]);
    expect(history[1]?.cpm_rate).toBe(25);
    expect(history[1]?.total_gross).toBe(7500);
    const dealRead = calls("deals")[0];
    expect(dealRead?.op).toBe("select");
    expect(dealRead?.columns).not.toContain("*");
    expect(dealRead?.columns).not.toContain("setup_intent");
    expect(dealRead?.or).toBe(
      `brand_id.eq.${BRAND},brand_profile_id.in.(${PROFILE})`
    );
    expect(calls("deals").every((entry) => entry.op === "select")).toBe(true);

    resetDb({ deals: tables.deals, brand_profiles: [] });
    log.length = 0;
    const legacy = await listShowDealHistory(BRAND, SHOW);
    expect(legacy.map((deal) => deal.id)).toEqual([
      "d1d1d1d1-d1d1-41d1-81d1-d1d1d1d1d1d1",
    ]);
    expect(calls("deals")[0]?.or).toBeUndefined();
    expect(calls("deals")[0]?.filters).toContainEqual({
      op: "eq",
      column: "brand_id",
      value: BRAND,
    });
  });

  it("lists shows that have a deal, a contact, or a note", async () => {
    resetDb({
      brand_profiles: [{ id: PROFILE, user_id: BRAND }, { id: "not-a-uuid", user_id: BRAND }],
      brand_show_contacts: [{ show_id: SHOW, brand_id: BRAND }],
      brand_show_notes: [{ show_id: SHOW_B, brand_id: BRAND }],
      deals: [
        { show_id: SHOW, brand_id: BRAND },
        { show_id: SHOW_C, brand_id: OTHER, brand_profile_id: PROFILE },
        { show_id: OTHER, brand_id: OTHER, agent_id: BRAND },
      ],
      shows: [
        { id: SHOW_C, name: "Cedar" },
        { id: SHOW, name: "Alpha" },
        { id: SHOW_B, name: "Bravo" },
        { id: OTHER, name: "Should not appear" },
      ],
    });

    const shows = await listCrmShows(BRAND);
    expect(shows).toEqual([
      { id: SHOW, name: "Alpha" },
      { id: SHOW_B, name: "Bravo" },
      { id: SHOW_C, name: "Cedar" },
    ]);
    const showRead = calls("shows")[0];
    expect(showRead?.columns).toBe("id, name");
    expect(showRead?.op).toBe("select");
    expect(calls("deals").every((entry) => entry.op === "select")).toBe(true);
    expect(calls("deals")[0]?.or).toBe(
      `brand_id.eq.${BRAND},brand_profile_id.in.(${PROFILE})`
    );
    expect(calls("deals")[0]?.or).not.toContain("not-a-uuid");
  });

  it("returns no shows when the brand has no CRM rows and does not query shows", async () => {
    const shows = await listCrmShows(BRAND);
    expect(shows).toEqual([]);
    expect(calls("shows")).toHaveLength(0);
    expect(calls("deals").every((entry) => entry.op === "select")).toBe(true);
  });

  it("throws the database error and ignores a profile id that is not a uuid", async () => {
    failures.brand_show_contacts = "permission denied";
    await expect(listContacts(BRAND, SHOW)).rejects.toThrow(/permission denied/);

    resetDb({
      brand_profiles: [{ id: "bad,id", user_id: BRAND }],
      deals: [{ id: "d1d1d1d1-d1d1-41d1-81d1-d1d1d1d1d1d1", show_id: SHOW, brand_id: BRAND, created_at: "2026-01-01T00:00:00.000Z" }],
    });
    delete failures.brand_show_contacts;
    const history = await listShowDealHistory(BRAND, SHOW);
    expect(history).toHaveLength(1);
    expect(calls("deals")[0]?.or).toBeUndefined();
  });
});
