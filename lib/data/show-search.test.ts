import { beforeEach, describe, expect, it, vi } from "vitest";

const calls = {
  from: [] as string[],
  ilike: [] as Array<[string, string]>,
  or: [] as unknown[],
  eq: [] as Array<[string, unknown]>,
  limit: [] as number[],
};

function builder() {
  const api: Record<string, unknown> = {};
  const self = () => api;
  api.select = vi.fn(self);
  api.eq = vi.fn((column: string, value: unknown) => {
    calls.eq.push([column, value]);
    return api;
  });
  api.order = vi.fn(self);
  api.in = vi.fn(self);
  api.ilike = vi.fn((column: string, value: string) => {
    calls.ilike.push([column, value]);
    return api;
  });
  api.or = vi.fn((value: unknown) => {
    calls.or.push(value);
    return api;
  });
  api.contains = vi.fn(self);
  api.gte = vi.fn(self);
  api.lte = vi.fn(self);
  api.limit = vi.fn((count: number) => {
    calls.limit.push(count);
    return api;
  });
  api.then = (
    resolve: (value: { data: unknown[]; error: null }) => unknown,
    reject?: (reason: unknown) => unknown
  ) => Promise.resolve({ data: [], error: null }).then(resolve, reject);
  return api;
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from(table: string) {
      calls.from.push(table);
      return builder();
    },
  }),
}));

import { getShowsFiltered } from "./queries";

beforeEach(() => {
  calls.from.length = 0;
  calls.ilike.length = 0;
  calls.or.length = 0;
  calls.eq.length = 0;
  calls.limit.length = 0;
});

describe("getShowsFiltered name search", () => {
  it("returns no rows and does not query when the term is only a star", async () => {
    await expect(getShowsFiltered({ search: "*" })).resolves.toEqual([]);
    expect(calls.from).toEqual([]);
  });

  it("escapes percent and still applies discoverable and the limit cap", async () => {
    await getShowsFiltered({ search: "%", limit: 250 });
    expect(calls.from).toEqual(["shows"]);
    expect(calls.ilike).toEqual([["name", "%\\%%"]]);
    expect(calls.eq).toContainEqual(["is_discoverable", true]);
    expect(calls.limit).toEqual([100]);
    expect(calls.or).toEqual([]);
  });

  it("keeps a comma and a closing parenthesis literal", async () => {
    await getShowsFiltered({ search: "a,b)", limit: 10 });
    expect(calls.ilike).toEqual([["name", "%a,b)%"]]);
    expect(calls.or).toEqual([]);
    expect(calls.eq).toContainEqual(["is_discoverable", true]);
    expect(calls.limit).toEqual([10]);
  });
});
