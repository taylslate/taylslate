import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { statsFreshCutoff } from "./store";

type Row = Record<string, unknown>;
type DbError = { message: string; code: string } | null;

const state = {
  channels: [] as Row[],
  shows: [] as Row[],
  channelError: null as DbError,
  showError: null as DbError,
  fromCalls: [] as string[],
  selects: [] as string[],
  patterns: [] as string[],
  limits: [] as number[],
};

function project(row: Row, columns: string): Row {
  if (columns.trim() === "*") return { ...row };
  const out: Row = {};
  for (const column of columns.split(",").map((part) => part.trim()).filter(Boolean)) {
    if (column in row) out[column] = row[column];
  }
  return out;
}

function likeMatch(value: unknown, pattern: string): boolean {
  if (typeof value !== "string") return false;
  let source = "";
  for (let i = 0; i < pattern.length; i += 1) {
    const char = pattern[i];
    if (char === "\\" && i + 1 < pattern.length) {
      source += pattern[i + 1].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      i += 1;
      continue;
    }
    if (char === "%") source += "[\\s\\S]*";
    else if (char === "_") source += "[\\s\\S]";
    else source += char.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${source}$`, "i").test(value);
}

class Query {
  private columns = "*";
  private filters: Array<(row: Row) => boolean> = [];
  private ordering: ((a: Row, b: Row) => number) | null = null;
  private max: number | null = null;

  constructor(private table: string) {}

  select(columns: string) {
    this.columns = columns;
    state.selects.push(`${this.table}:${columns}`);
    return this;
  }

  eq(column: string, value: unknown) {
    this.filters.push((row) => row[column] === value);
    return this;
  }

  is(column: string, value: unknown) {
    this.filters.push((row) => (value === null ? row[column] == null : row[column] === value));
    return this;
  }

  gte(column: string, value: unknown) {
    this.filters.push((row) => String(row[column] ?? "") >= String(value ?? ""));
    return this;
  }

  ilike(column: string, pattern: string) {
    state.patterns.push(pattern);
    this.filters.push((row) => likeMatch(row[column], pattern));
    return this;
  }

  in(column: string, values: unknown[]) {
    const allowed = new Set(values);
    this.filters.push((row) => allowed.has(row[column]));
    return this;
  }

  order(column: string, options?: { ascending?: boolean; nullsFirst?: boolean }) {
    const ascending = options?.ascending ?? true;
    const nullsFirst = options?.nullsFirst ?? false;
    this.ordering = (a, b) => {
      const av = a[column];
      const bv = b[column];
      const aNull = av == null;
      const bNull = bv == null;
      if (aNull || bNull) {
        if (aNull && bNull) return 0;
        if (aNull) return nullsFirst ? -1 : 1;
        return nullsFirst ? 1 : -1;
      }
      const delta = Number(av) - Number(bv);
      return ascending ? delta : -delta;
    };
    return this;
  }

  limit(count: number) {
    this.max = count;
    state.limits.push(count);
    return this;
  }

  maybeSingle() {
    return this.execute(true);
  }

  then<T>(
    onFulfilled: (value: { data: unknown; error: DbError }) => T,
    onRejected?: (reason: unknown) => T
  ) {
    return this.execute(false).then(onFulfilled, onRejected);
  }

  private execute(single: boolean): Promise<{ data: unknown; error: DbError }> {
    const error = this.table === "youtube_channels" ? state.channelError : this.table === "shows" ? state.showError : { message: "missing", code: "42P01" };
    if (error) return Promise.resolve({ data: null, error });
    const source = this.table === "youtube_channels" ? state.channels : state.shows;
    let rows = source.map((row) => ({ ...row }));
    for (const filter of this.filters) rows = rows.filter(filter);
    if (this.ordering) rows.sort(this.ordering);
    if (this.max != null) rows = rows.slice(0, this.max);
    const projected = rows.map((row) => project(row, this.columns));
    return Promise.resolve({ data: single ? projected[0] ?? null : projected, error: null });
  }
}

vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: {
    from(table: string) {
      state.fromCalls.push(table);
      return new Query(table);
    },
  },
}));

import { SAFE_COLUMNS, getLibraryCreator, searchLibraryCreators } from "./brand-read";

const NOW = new Date("2026-11-11T00:00:00.000Z");
const FRESH = statsFreshCutoff(NOW);
const STALE = new Date(new Date(FRESH).getTime() - 24 * 60 * 60 * 1000).toISOString();
const CREATOR_KEYS = [
  "channelId",
  "title",
  "thumbnailUrl",
  "country",
  "subscriberCount",
  "videoCount",
  "averageViews",
  "averageViewsLabel",
  "nicheTags",
  "youtubeUrl",
];

function channelId(n: number): string {
  return `UC${n.toString(36).padStart(22, "a")}`;
}

function row(overrides: Row = {}): Row {
  return {
    channel_id: channelId(1),
    title: "Lab Notes",
    thumbnail_url: "https://i.ytimg.com/vi/lab/hqdefault.jpg",
    country: "US",
    subscriber_count: 12000,
    video_count: 40,
    avg_recent_views: 22000,
    avg_views_method: "recent",
    niche_tags: ["Health", "Home"],
    description: "A public channel description.",
    total_view_count: 2_000_000,
    stats_refreshed_at: FRESH,
    show_id: null,
    passed_market_filter: true,
    brand_flag: null,
    source: "category",
    source_query: "lab",
    keywords: ["secret-keyword"],
    topic_categories: ["https://en.wikipedia.org/wiki/Health"],
    contact_address: "hidden@creator.test",
    ...overrides,
  };
}

beforeEach(() => {
  state.channels = [];
  state.shows = [];
  state.channelError = null;
  state.showError = null;
  state.fromCalls = [];
  state.selects = [];
  state.patterns = [];
  state.limits = [];
});

describe("SAFE_COLUMNS", () => {
  it("keeps filter columns off the returned shape and out of the select list", () => {
    const source = readFileSync(new URL("./brand-read.ts", import.meta.url), "utf8");
    expect(source.includes("youtube_channel_emails")).toBe(false);
    const columns = SAFE_COLUMNS.split(",").map((part) => part.trim());
    expect(SAFE_COLUMNS.toLowerCase().includes("email")).toBe(false);
    for (const forbidden of [
      "source",
      "source_query",
      "keywords",
      "topic_categories",
      "tagged_at",
      "niche_tags_version",
      "created_at",
      "first_seen_at",
    ]) {
      expect(columns).not.toContain(forbidden);
    }
    expect(columns).toEqual(
      expect.arrayContaining([
        "channel_id",
        "title",
        "description",
        "total_view_count",
        "avg_views_method",
        "stats_refreshed_at",
        "show_id",
        "passed_market_filter",
        "brand_flag",
      ])
    );
  });
});

describe("searchLibraryCreators", () => {
  it("returns the public shape and drops internal columns", async () => {
    state.channels = [row()];
    const [creator] = await searchLibraryCreators({ query: "Lab", now: NOW });
    expect(Object.keys(creator)).toEqual(CREATOR_KEYS);
    expect(creator).toEqual({
      channelId: channelId(1),
      title: "Lab Notes",
      thumbnailUrl: "https://i.ytimg.com/vi/lab/hqdefault.jpg",
      country: "US",
      subscriberCount: 12000,
      videoCount: 40,
      averageViews: 22000,
      averageViewsLabel: "recent",
      nicheTags: ["Health", "Home"],
      youtubeUrl: `https://www.youtube.com/channel/${channelId(1)}`,
    });
    expect(creator).not.toHaveProperty("description");
    expect(creator).not.toHaveProperty("brand_flag");
    expect(creator).not.toHaveProperty("show_id");
    expect(creator).not.toHaveProperty("source");
    expect(creator).not.toHaveProperty("source_query");
    expect(creator).not.toHaveProperty("keywords");
    expect(JSON.stringify(creator)).not.toContain("hidden@creator.test");
    expect(JSON.stringify(creator)).not.toContain("secret-keyword");
    expect(state.selects[0]).toBe(`youtube_channels:${SAFE_COLUMNS}`);
  });

  it.each([
    ["not passed", { passed_market_filter: false }],
    ["brand flagged", { brand_flag: "seller" }],
    ["stale by 31 days", { stats_refreshed_at: STALE }],
    ["under the video floor", { video_count: 9 }],
    ["under the recent view floor", { avg_views_method: "recent", avg_recent_views: 9999 }],
    ["under the fallback view floor", { avg_views_method: "estimated", avg_recent_views: 4999 }],
    ["linked by show_id", { show_id: "11111111-1111-4111-8111-111111111111" }],
  ])("excludes a channel that is %s", async (_label, patch) => {
    state.channels = [row(patch)];
    await expect(searchLibraryCreators({ query: "Lab", now: NOW })).resolves.toEqual([]);
  });

  it("drops a channel linked from shows.youtube_channel_id", async () => {
    const linked = channelId(1);
    const open = channelId(2);
    state.channels = [
      row({ channel_id: linked, title: "Lab Linked", avg_recent_views: 90000 }),
      row({ channel_id: open, title: "Lab Open", avg_recent_views: 80000 }),
    ];
    state.shows = [{ youtube_channel_id: linked }];
    const result = await searchLibraryCreators({ query: "Lab", now: NOW });
    expect(result.map((item) => item.channelId)).toEqual([open]);
    expect(state.fromCalls).toEqual(["youtube_channels", "shows"]);
  });

  it("escapes wildcard characters, including a term that is already escaped", async () => {
    state.channels = [
      row({ channel_id: channelId(1), title: "100%_off lab" }),
      row({ channel_id: channelId(2), title: "1000off lab" }),
      row({ channel_id: channelId(3), title: "Anything else" }),
    ];
    const literal = await searchLibraryCreators({ query: "100%_off", now: NOW });
    expect(literal.map((item) => item.channelId)).toEqual([channelId(1)]);
    expect(state.patterns).toEqual(["%100\\%\\_off%"]);

    state.patterns = [];
    const again = await searchLibraryCreators({ query: "100\\%\\_off", now: NOW });
    expect(again.map((item) => item.channelId)).toEqual([channelId(1)]);
    expect(state.patterns).toEqual(["%100\\%\\_off%"]);

    state.patterns = [];
    state.channels = [
      row({ channel_id: channelId(2), title: "1000off lab" }),
      row({ channel_id: channelId(3), title: "Anything else" }),
    ];
    const wildcard = await searchLibraryCreators({ query: "%", now: NOW });
    expect(wildcard).toEqual([]);
    expect(state.patterns).toEqual(["%\\%%"]);
  });

  it("caps the page at 20 and sorts null view counts last", async () => {
    state.channels = Array.from({ length: 25 }, (_, index) =>
      row({
        channel_id: channelId(index + 1),
        title: `Lab ${index + 1}`,
        avg_recent_views: 100000 - index,
      })
    );
    state.channels.push(
      row({
        channel_id: channelId(90),
        title: "Lab missing views",
        avg_recent_views: null,
        avg_views_method: "estimated",
        total_view_count: 200000,
        video_count: 20,
      })
    );
    const capped = await searchLibraryCreators({ query: "Lab", limit: 100, now: NOW });
    expect(capped).toHaveLength(20);
    expect(capped[0].channelId).toBe(channelId(1));
    expect(capped[19].channelId).toBe(channelId(20));
    expect(capped.map((item) => item.channelId)).not.toContain(channelId(21));
    expect(capped.map((item) => item.channelId)).not.toContain(channelId(90));

    state.channels = [
      row({
        channel_id: channelId(2),
        title: "Lab missing",
        avg_recent_views: null,
        avg_views_method: "estimated",
        total_view_count: 200000,
        video_count: 20,
      }),
      row({ channel_id: channelId(1), title: "Lab recent", avg_recent_views: 50000 }),
    ];
    const ordered = await searchLibraryCreators({ query: "Lab", now: NOW });
    expect(ordered.map((item) => item.channelId)).toEqual([channelId(1), channelId(2)]);
    expect(ordered[1].averageViewsLabel).toBe("average");
  });

  it("fills 20 when the first page by views includes rows under the floors", async () => {
    state.channels = Array.from({ length: 25 }, (_, index) =>
      row({
        channel_id: channelId(index + 1),
        title: `Lab ${index + 1}`,
        avg_recent_views: 100000 - index,
        video_count: index < 5 ? 9 : 40,
      })
    );
    const result = await searchLibraryCreators({ query: "Lab", now: NOW });
    expect(state.limits).toEqual([60]);
    expect(result).toHaveLength(20);
    expect(result.map((item) => item.channelId)).toEqual(
      Array.from({ length: 20 }, (_, index) => channelId(index + 6))
    );
    expect(state.fromCalls.filter((table) => table === "shows")).toHaveLength(1);
  });

  it("drops a star and does not query when the term is only stars", async () => {
    state.channels = [
      row({ channel_id: channelId(1), title: "ab show" }),
      row({ channel_id: channelId(2), title: "ax show" }),
    ];
    const starred = await searchLibraryCreators({ query: "a*b", now: NOW });
    expect(state.patterns).toEqual(["%ab%"]);
    expect(starred.map((item) => item.channelId)).toEqual([channelId(1)]);

    state.fromCalls = [];
    state.patterns = [];
    state.limits = [];
    await expect(searchLibraryCreators({ query: "*", now: NOW })).resolves.toEqual([]);
    expect(state.fromCalls).toEqual([]);
    expect(state.patterns).toEqual([]);
    expect(state.limits).toEqual([]);
  });

  it("returns an empty list for a blank query without reading", async () => {
    state.channels = [row()];
    await expect(searchLibraryCreators({ query: "   ", now: NOW })).resolves.toEqual([]);
    expect(state.fromCalls).toEqual([]);
  });

  it("returns an empty list when the library table is missing", async () => {
    state.channels = [row()];
    state.channelError = { code: "PGRST205", message: "Could not find the table public.youtube_channels" };
    await expect(searchLibraryCreators({ query: "Lab", now: NOW })).resolves.toEqual([]);
  });

  it("throws a plain error that does not include the query", async () => {
    state.channelError = { code: "XX000", message: "canceling statement" };
    const logs: string[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    });
    await expect(searchLibraryCreators({ query: "person@example.com", now: NOW })).rejects.toThrow(
      "Could not read library creators."
    );
    expect(logs.join("\n")).not.toContain("person@example.com");
    spy.mockRestore();
  });

  it("throws when the show link lookup fails", async () => {
    state.channels = [row()];
    state.showError = { code: "XX000", message: "connection reset" };
    await expect(searchLibraryCreators({ query: "Lab", now: NOW })).rejects.toThrow(
      "Could not read library creators."
    );
  });
});

describe("getLibraryCreator", () => {
  it("returns null for a bad channel id without a query", async () => {
    state.channels = [row()];
    await expect(getLibraryCreator("not-a-channel", NOW)).resolves.toBeNull();
    await expect(getLibraryCreator("UC_short", NOW)).resolves.toBeNull();
    expect(state.fromCalls).toEqual([]);
  });

  it("returns the public profile and cuts the description to 300 characters", async () => {
    const description = `${"A".repeat(300)}TAIL`;
    state.channels = [row({ description, avg_views_method: "estimated", avg_recent_views: 8000 })];
    const profile = await getLibraryCreator(channelId(1), NOW);
    expect(profile).not.toBeNull();
    expect(Array.from(profile!.description)).toHaveLength(300);
    expect(profile!.description).not.toContain("TAIL");
    expect(profile!.averageViewsLabel).toBe("average");
    expect(Object.keys(profile!)).toEqual([...CREATOR_KEYS, "description"]);
    expect(JSON.stringify(profile)).not.toContain("hidden@creator.test");
  });

  it("returns null when the channel is ineligible or already a show", async () => {
    state.channels = [row({ stats_refreshed_at: STALE })];
    await expect(getLibraryCreator(channelId(1), NOW)).resolves.toBeNull();

    state.channels = [row()];
    state.shows = [{ youtube_channel_id: channelId(1) }];
    await expect(getLibraryCreator(channelId(1), NOW)).resolves.toBeNull();
  });

  it("returns null when the library table is missing", async () => {
    state.channelError = { code: "42P01", message: "relation youtube_channels does not exist" };
    await expect(getLibraryCreator(channelId(1), NOW)).resolves.toBeNull();
  });
});
