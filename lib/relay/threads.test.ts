import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;

const tables: Record<string, Row[]> = {};
let failCode: string | null = null;

function from(table: string) {
  const query: { op: string; values: Row; filters: Array<[string, unknown]> } = {
    op: "select",
    values: {},
    filters: [],
  };
  const run = () => {
    if (failCode) return { data: null, error: { code: failCode, message: "secret host@example.test" } };
    const rows = tables[table] ?? [];
    const matched = rows.filter((row) => query.filters.every(([column, value]) => row[column] === value));
    if (query.op === "insert") {
      const tokenTaken = rows.some((row) => row.address_token === query.values.address_token);
      const outreachTaken = rows.some((row) => row.outreach_id === query.values.outreach_id);
      if (tokenTaken || outreachTaken) return { data: null, error: { code: "23505", message: "duplicate" } };
      const row = { id: `thread-${rows.length + 1}`, deal_id: null, created_at: "2026-11-24T00:00:00.000Z", ...query.values };
      rows.push(row);
      tables[table] = rows;
      return { data: row, error: null };
    }
    if (query.op === "update") {
      for (const row of matched) Object.assign(row, query.values);
      return { data: null, error: null };
    }
    return { data: matched[0] ?? null, error: null };
  };
  const api = {
    insert(values: Row) {
      query.op = "insert";
      query.values = values;
      return api;
    },
    update(values: Row) {
      query.op = "update";
      query.values = values;
      return api;
    },
    select() {
      return api;
    },
    eq(column: string, value: unknown) {
      query.filters.push([column, value]);
      return api;
    },
    single: async () => run(),
    maybeSingle: async () => run(),
    then(resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) {
      return Promise.resolve(run()).then(resolve, reject);
    },
  };
  return api;
}

vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: { from: (table: string) => from(table) },
}));

import { createRelayThread, findThreadByToken, linkThreadToDeal } from "./threads";

const input = {
  outreachId: "11111111-1111-4111-8111-111111111111",
  brandUserId: "22222222-2222-4222-8222-222222222222",
  brandProfileId: "33333333-3333-4333-8333-333333333333",
  brandDisplayName: "Aurora",
  showDisplayName: "Daily",
};

describe("relay threads", () => {
  beforeEach(() => {
    for (const key of Object.keys(tables)) delete tables[key];
    tables.relay_threads = [];
    failCode = null;
  });

  it("creates a thread whose token is not a function of the outreach id", async () => {
    const first = await createRelayThread(input);
    tables.relay_threads = [];
    const second = await createRelayThread(input);
    expect(first?.address_token).toMatch(/^[a-z2-7]{26}$/);
    expect(second?.address_token).toMatch(/^[a-z2-7]{26}$/);
    expect(first?.address_token).not.toBe(second?.address_token);
    expect(first?.address_token).not.toContain(input.outreachId.slice(0, 8));
  });

  it("returns the existing row when the outreach already has a thread", async () => {
    const first = await createRelayThread(input);
    const again = await createRelayThread(input);
    expect(again?.id).toBe(first?.id);
    expect(again?.address_token).toBe(first?.address_token);
    expect(tables.relay_threads).toHaveLength(1);
  });

  it("returns null and logs only the code when the table is missing", async () => {
    failCode = "42P01";
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await createRelayThread(input)).toBeNull();
    expect(warn).toHaveBeenCalledWith("[relay] thread create failed", "42P01");
    expect(warn.mock.calls.flat().join(" ")).not.toContain("host@example.test");
    expect(warn.mock.calls.flat().join(" ")).not.toContain("message");
    warn.mockRestore();
  });

  it("finds the thread for its token and no other token", async () => {
    const created = await createRelayThread(input);
    expect(await findThreadByToken(created!.address_token)).toMatchObject({ id: created!.id });
    expect(await findThreadByToken("not-a-token")).toBeNull();
    expect(await findThreadByToken("zzzzzzzzzzzzzzzzzzzzzzzzzz")).toBeNull();
  });

  it("links the deal and fails soft", async () => {
    const created = await createRelayThread(input);
    expect(await linkThreadToDeal(input.outreachId, "44444444-4444-4444-8444-444444444444")).toBeNull();
    expect(tables.relay_threads[0].deal_id).toBe("44444444-4444-4444-8444-444444444444");
    expect(tables.relay_threads[0].id).toBe(created?.id);
    failCode = "42P01";
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await linkThreadToDeal(input.outreachId, "55555555-5555-4555-8555-555555555555")).toBeNull();
    expect(warn).toHaveBeenCalledWith("[relay] thread link failed", "42P01");
    warn.mockRestore();
  });
});
