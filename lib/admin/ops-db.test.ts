import { describe, expect, it, vi } from "vitest";
import { createSupabaseOpsDb } from "@/lib/admin/ops-db";

function builder(result: { data: unknown; error: { code?: string; message?: string } | null; count: number | null }) {
  const writes = { insert: 0, update: 0, delete: 0, upsert: 0 };
  const api = {
    select: vi.fn(() => api),
    eq: vi.fn(() => api),
    gte: vi.fn(() => api),
    in: vi.fn(() => api),
    ilike: vi.fn(() => api),
    or: vi.fn(() => api),
    neq: vi.fn(() => api),
    not: vi.fn(() => api),
    order: vi.fn(() => api),
    range: vi.fn(() => api),
    insert: vi.fn(() => {
      writes.insert += 1;
      return api;
    }),
    update: vi.fn(() => {
      writes.update += 1;
      return api;
    }),
    delete: vi.fn(() => {
      writes.delete += 1;
      return api;
    }),
    upsert: vi.fn(() => {
      writes.upsert += 1;
      return api;
    }),
    then: (resolve: (value: typeof result) => unknown) => resolve(result),
  };
  return { api, writes };
}

describe("createSupabaseOpsDb", () => {
  it("selects with filters and does not call a write method", async () => {
    const { api, writes } = builder({ data: [{ id: "1" }], error: null, count: 4 });
    const from = vi.fn(() => api);
    const db = createSupabaseOpsDb({ from } as never);
    const result = await db.select({
      table: "profiles",
      columns: "id, email",
      eq: { role: "brand" },
      order: { column: "created_at", ascending: false },
      limit: 40,
    });
    expect(from).toHaveBeenCalledWith("profiles");
    expect(api.select).toHaveBeenCalledWith("id, email", { count: "exact", head: false });
    expect(api.eq).toHaveBeenCalledWith("role", "brand");
    expect(api.range).toHaveBeenCalledWith(0, 39);
    expect(result).toEqual({ rows: [{ id: "1" }], count: 4, error: null });
    expect(writes).toEqual({ insert: 0, update: 0, delete: 0, upsert: 0 });
  });

  it("returns an empty result for an empty in list without querying", async () => {
    const from = vi.fn();
    const db = createSupabaseOpsDb({ from });
    const result = await db.select({
      table: "deals",
      columns: "id",
      in: { show_id: [] },
    });
    expect(result).toEqual({ rows: [], count: 0, error: null });
    expect(from).not.toHaveBeenCalled();
  });

  it("maps a read error and does not return rows", async () => {
    const { api } = builder({
      data: [{ id: "secret" }],
      error: { code: "PGRST205", message: "Could not find the table" },
      count: null,
    });
    const db = createSupabaseOpsDb({ from: () => api } as never);
    const result = await db.select({ table: "youtube_channels", columns: "*", head: true });
    expect(api.range).not.toHaveBeenCalled();
    expect(result.rows).toEqual([]);
    expect(result.error).toEqual({ code: "PGRST205", message: "Could not find the table" });
  });
});
