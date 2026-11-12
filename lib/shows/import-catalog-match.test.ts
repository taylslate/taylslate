import { beforeEach, describe, expect, it, vi } from "vitest";

const { adminFrom } = vi.hoisted(() => ({
  adminFrom: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: { from: (...args: unknown[]) => adminFrom(...args) },
}));

import { findCatalogDuplicates } from "./import-catalog-match";

const CALLER = "agent-1";
const OTHER = "agent-2";
const SHOW_ID = "show-9f3c1a20-4b6e-4c11-9a2d-aaaaaaaaaaaa";
const SHOW_NAME = "daily";

interface CatalogShow {
  id: string;
  name: string;
  agent_id: string | null;
  is_discoverable: boolean;
  rss_url: string | null;
}

function install(options: {
  name?: CatalogShow[];
  rss?: CatalogShow[];
  errorOn?: "name" | "rss_url";
}) {
  const queries: Array<{ select: string; column: string; pattern: string; limit: number }> = [];
  adminFrom.mockImplementation((table: string) => {
    expect(table).toBe("shows");
    const state = { select: "", column: "", pattern: "" };
    const builder = {
      select(columns: string) {
        state.select = columns;
        return builder;
      },
      ilike(column: string, pattern: string) {
        state.column = column;
        state.pattern = pattern;
        return builder;
      },
      limit(limit: number) {
        queries.push({ ...state, limit });
        if (options.errorOn === state.column) {
          return Promise.resolve({
            data: null,
            error: { message: `${SHOW_ID} ${SHOW_NAME}`, code: "XX000" },
          });
        }
        const data = state.column === "rss_url" ? (options.rss ?? []) : (options.name ?? []);
        return Promise.resolve({ data, error: null });
      },
    };
    return builder;
  });
  return queries;
}

const discoverable: CatalogShow = {
  id: SHOW_ID,
  name: SHOW_NAME,
  agent_id: OTHER,
  is_discoverable: true,
  rss_url: null,
};

beforeEach(() => {
  adminFrom.mockReset();
});

describe("findCatalogDuplicates", () => {
  it("matches a discoverable show on the normalized name", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const queries = install({ name: [discoverable] });

    const duplicates = await findCatalogDuplicates(
      [{ name: "The Daily Podcast" }],
      CALLER
    );

    expect(duplicates).toEqual(new Set([0]));
    expect(JSON.stringify([...duplicates])).not.toContain(SHOW_ID);
    expect(JSON.stringify([...duplicates])).not.toContain(SHOW_NAME);
    expect(queries).toEqual([
      {
        select: "id, name, agent_id, is_discoverable, rss_url",
        column: "name",
        pattern: "%daily%",
        limit: 25,
      },
    ]);
    const logged = JSON.stringify([
      ...warn.mock.calls,
      ...log.mock.calls,
      ...info.mock.calls,
      ...error.mock.calls,
    ]);
    expect(logged).not.toContain(SHOW_ID);
    expect(logged).not.toContain(SHOW_NAME);
    warn.mockRestore();
    log.mockRestore();
    info.mockRestore();
    error.mockRestore();
  });

  it("matches the caller's own hidden show by name", async () => {
    install({
      name: [
        {
          id: SHOW_ID,
          name: "Daily",
          agent_id: CALLER,
          is_discoverable: false,
          rss_url: null,
        },
      ],
    });
    const duplicates = await findCatalogDuplicates([{ name: "daily" }], CALLER);
    expect(duplicates).toEqual(new Set([0]));
  });

  it("does not match another rep's hidden show by name", async () => {
    install({
      name: [
        {
          id: SHOW_ID,
          name: "The Daily Podcast",
          agent_id: OTHER,
          is_discoverable: false,
          rss_url: null,
        },
      ],
    });
    const duplicates = await findCatalogDuplicates(
      [{ name: "The Daily Podcast" }],
      CALLER
    );
    expect(duplicates).toEqual(new Set());
  });

  it("does not treat another rep's hidden show with the same feed as a duplicate", async () => {
    install({
      rss: [
        {
          id: SHOW_ID,
          name: "Hidden Feed",
          agent_id: OTHER,
          is_discoverable: false,
          rss_url: "http://feeds.example.com/show",
        },
      ],
    });
    const duplicates = await findCatalogDuplicates(
      [
        {
          name: "Something Else",
          rss_url: "https://feeds.example.com/show/",
        },
      ],
      CALLER
    );
    expect(duplicates).toEqual(new Set());
    expect(JSON.stringify([...duplicates])).not.toContain(SHOW_ID);
  });

  it("matches the same feed on a discoverable show or the caller's own show", async () => {
    const hiddenFeed = {
      id: SHOW_ID,
      name: "Hidden Feed",
      agent_id: OTHER,
      is_discoverable: false,
      rss_url: "http://feeds.example.com/show",
    };
    const queries = install({ rss: [{ ...hiddenFeed, is_discoverable: true }] });
    const row = { name: "Something Else", rss_url: "https://feeds.example.com/show/" };
    const discoverable = await findCatalogDuplicates([row], CALLER);
    expect(discoverable).toEqual(new Set([0]));
    expect(queries).toContainEqual({
      select: "id, name, agent_id, is_discoverable, rss_url",
      column: "rss_url",
      pattern: "%feeds.example.com/show%",
      limit: 10,
    });

    install({ rss: [{ ...hiddenFeed, agent_id: CALLER }] });
    const own = await findCatalogDuplicates([row], CALLER);
    expect(own).toEqual(new Set([0]));
  });

  it("looks up name tokens in chunks of 20", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const queries: string[] = [];
    adminFrom.mockImplementation((table: string) => {
      expect(table).toBe("shows");
      const state = { column: "" };
      const builder = {
        select() {
          return builder;
        },
        ilike(column: string) {
          state.column = column;
          return builder;
        },
        limit() {
          const token = state.column;
          inFlight += 1;
          maxInFlight = Math.max(maxInFlight, inFlight);
          queries.push(token);
          return new Promise((resolve) => {
            queueMicrotask(() => {
              inFlight -= 1;
              resolve({ data: [], error: null });
            });
          });
        },
      };
      return builder;
    });

    const rows = Array.from({ length: 21 }, (_, index) => ({
      name: `Token${String(index + 1).padStart(2, "0")}name`,
    }));
    const duplicates = await findCatalogDuplicates(rows, CALLER);
    expect(duplicates).toEqual(new Set());
    expect(queries).toHaveLength(21);
    expect(maxInFlight).toBe(20);
  });

  it("returns an empty set when nothing matches", async () => {
    install({
      name: [
        {
          id: SHOW_ID,
          name: "Daily News",
          agent_id: null,
          is_discoverable: true,
          rss_url: null,
        },
      ],
    });
    const duplicates = await findCatalogDuplicates([{ name: "daily" }], CALLER);
    expect(duplicates).toEqual(new Set());
  });

  it("throws when a lookup fails and does not log the show", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    install({ errorOn: "name" });
    const thrown = await findCatalogDuplicates([{ name: "The Daily Podcast" }], CALLER).catch(
      (failure: unknown) => failure
    );
    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toBe("Show lookup failed.");
    expect((thrown as Error).message).not.toContain(SHOW_ID);
    expect((thrown as Error).message).not.toContain(SHOW_NAME);
    const logged = JSON.stringify([...warn.mock.calls, ...error.mock.calls]);
    expect(logged).not.toContain(SHOW_ID);
    expect(logged).not.toContain(SHOW_NAME);
    warn.mockRestore();
    error.mockRestore();
  });
});
