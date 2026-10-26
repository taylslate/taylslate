import { beforeEach, describe, expect, it, vi } from "vitest";
import { normalizeShowMatchKey } from "@/lib/imports/past-campaigns";

const bridge = vi.hoisted(() => ({
  impl: null as null | ((table: string) => unknown),
  isShowsAdmin: vi.fn(async (_userId: string) => false),
}));

vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: {
    from: (table: string) => {
      if (!bridge.impl) throw new Error("admin mock is not ready");
      return bridge.impl(table);
    },
  },
}));

vi.mock("@/lib/shows/can-edit-show", () => ({
  isShowsAdmin: (userId: string) => bridge.isShowsAdmin(userId),
}));

import {
  ROSTER_IMPORT_MAX_BYTES,
  ROSTER_IMPORT_MAX_ROWS,
  RosterImportError,
  assertRosterImportBytes,
  importRoster,
  normalizeRosterShowName,
  parseRosterImport,
  parseRosterMode,
  youtubeChannelIdFromInput,
  type RosterImportResultRow,
} from "./roster-import";

const AGENT = "agent-a";
const OTHER = "agent-b";
const UC = "UC1234567890123456789012";
const SECRET = "secret-contact@hidden.test";
const SHOW_SELECT =
  "id, name, rss_url, youtube_channel_id, apple_id, is_discoverable, agent_id";

type Filter =
  | { kind: "eq"; column: string; value: unknown }
  | { kind: "in"; column: string; value: unknown[] }
  | { kind: "ilike"; column: string; value: string };

interface MemOp {
  op: "select" | "insert" | "delete" | "update";
  table: string;
  row: Record<string, unknown> | null;
  columns: string | null;
}

interface Mem {
  from: (table: string) => unknown;
  shows: Record<string, unknown>[];
  links: Record<string, unknown>[];
  ops: MemOp[];
  failLink: { message: string; code: string } | null;
  failDelete: boolean;
}

function createMem(): Mem {
  const shows: Record<string, unknown>[] = [];
  const links: Record<string, unknown>[] = [];
  const ops: MemOp[] = [];
  const mem: Mem = {
    from,
    shows,
    links,
    ops,
    failLink: null,
    failDelete: false,
  };
  let showSeq = 0;
  let linkSeq = 0;

  function tableRows(table: string): Record<string, unknown>[] {
    if (table === "shows") return shows;
    if (table === "agent_show_relationships") return links;
    throw new Error(`unexpected table ${table}`);
  }

  function from(table: string) {
    const query: {
      op: MemOp["op"];
      columns: string | null;
      filters: Filter[];
      limit: number | null;
      insertRow: Record<string, unknown> | null;
    } = {
      op: "select",
      columns: null,
      filters: [],
      limit: null,
      insertRow: null,
    };

    const run = () => {
      ops.push({
        op: query.op,
        table,
        row: query.insertRow ? { ...query.insertRow } : null,
        columns: query.columns,
      });
      if (query.op === "update") {
        return { data: null, error: { message: "updates are not part of import", code: "P0001" } };
      }
      if (query.op === "delete") {
        if (mem.failDelete) {
          return { data: null, error: { message: "delete failed", code: "42501" } };
        }
        const rows = tableRows(table);
        const kept = rows.filter((row) => !matches(row, query.filters));
        rows.splice(0, rows.length, ...kept);
        return { data: null, error: null };
      }
      if (query.op === "insert") {
        const row = { ...(query.insertRow ?? {}) };
        if (table === "agent_show_relationships") {
          if (mem.failLink) return { data: null, error: mem.failLink };
          const duplicate = links.some(
            (link) => link.agent_id === row.agent_id && link.show_id === row.show_id
          );
          if (duplicate) return { data: null, error: { message: "duplicate", code: "23505" } };
          row.id = `link-${++linkSeq}`;
          links.push(row);
          return { data: project(row, query.columns), error: null };
        }
        row.id = `show-${++showSeq}`;
        shows.push(row);
        return { data: project(row, query.columns), error: null };
      }
      let matched = tableRows(table).filter((row) => matches(row, query.filters));
      if (query.limit !== null) matched = matched.slice(0, query.limit);
      return {
        data: matched.map((row) => project(row, query.columns)),
        error: null,
      };
    };

    const builder: Record<string, unknown> = {};
    builder.select = (cols?: string) => {
      query.columns = typeof cols === "string" ? cols : "*";
      return builder;
    };
    builder.insert = (row: Record<string, unknown>) => {
      query.op = "insert";
      query.insertRow = row;
      return builder;
    };
    builder.update = (row: Record<string, unknown>) => {
      query.op = "update";
      query.insertRow = row;
      return builder;
    };
    builder.delete = () => {
      query.op = "delete";
      return builder;
    };
    builder.eq = (column: string, value: unknown) => {
      query.filters.push({ kind: "eq", column, value });
      return builder;
    };
    builder.in = (column: string, value: unknown[]) => {
      query.filters.push({ kind: "in", column, value });
      return builder;
    };
    builder.ilike = (column: string, value: string) => {
      query.filters.push({ kind: "ilike", column, value });
      return builder;
    };
    builder.limit = (value: number) => {
      query.limit = value;
      return builder;
    };
    builder.single = async () => {
      const result = run();
      if (result.error) return { data: null, error: result.error };
      const data = Array.isArray(result.data) ? (result.data[0] ?? null) : result.data;
      return { data, error: null };
    };
    builder.then = (
      resolve: (value: unknown) => unknown,
      reject?: (reason: unknown) => unknown
    ) => Promise.resolve(run()).then(resolve, reject);
    return builder;
  }

  return mem;
}

function project(row: Record<string, unknown>, columns: string | null): Record<string, unknown> {
  if (!columns || columns.trim() === "*") return { ...row };
  const out: Record<string, unknown> = {};
  for (const column of columns.split(",").map((part) => part.trim())) {
    out[column] = row[column];
  }
  return out;
}

function matches(row: Record<string, unknown>, filters: Filter[]): boolean {
  return filters.every((filter) => {
    const value = row[filter.column];
    if (filter.kind === "eq") return value === filter.value;
    if (filter.kind === "in") return filter.value.includes(value);
    return ilike(value, filter.value);
  });
}

function ilike(value: unknown, pattern: string): boolean {
  if (typeof value !== "string") return false;
  let expression = "";
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === "\\" && i + 1 < pattern.length) {
      expression += pattern[i + 1].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      i++;
      continue;
    }
    if (ch === "%") expression += ".*";
    else if (ch === "_") expression += ".";
    else expression += ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${expression}$`, "i").test(value);
}

let mem: Mem;

beforeEach(() => {
  mem = createMem();
  bridge.impl = mem.from;
  bridge.isShowsAdmin.mockReset();
  bridge.isShowsAdmin.mockResolvedValue(false);
});

function catalog(row: Record<string, unknown>) {
  mem.shows.push(row);
}

function link(row: Record<string, unknown>) {
  mem.links.push(row);
}

async function run(
  mode: "preview" | "commit",
  body: unknown,
  contentType = "application/json"
): Promise<RosterImportResultRow[]> {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  const rows = parseRosterImport(text, contentType);
  return importRoster({ agentId: AGENT, mode, rows });
}

function writes() {
  return mem.ops.filter((op) => op.op !== "select");
}

function showInserts() {
  return mem.ops.filter((op) => op.op === "insert" && op.table === "shows");
}

function linkInserts() {
  return mem.ops.filter(
    (op) => op.op === "insert" && op.table === "agent_show_relationships"
  );
}

describe("parseRosterImport", () => {
  it("reads JSON rows and CSV text, and ignores podscan and agent id", () => {
    const json = parseRosterImport(
      JSON.stringify({
        rows: [
          {
            name: "Night Desk",
            platform: "podcast",
            podscan_id: "pd_secret",
            agent_id: OTHER,
            is_claimed: true,
            ownership_status: "verified",
            is_exclusive: false,
          },
        ],
      }),
      "application/json"
    );
    expect(json).toHaveLength(1);
    expect(json[0].isExclusive).toBe(false);
    expect(JSON.stringify(json[0])).not.toContain("pd_secret");
    expect(JSON.stringify(json[0])).not.toContain(OTHER);
    expect(JSON.stringify(json[0])).not.toContain("verified");

    const csv = [
      "name,platform,rss_url,apple_url,youtube_channel_id,contact_email,is_exclusive",
      "Night Desk,podcast,https://feeds.example.com/night,https://podcasts.apple.com/us/podcast/night/id1234567890,UC1234567890123456789012,host@example.com,yes",
    ].join("\n");
    const parsed = parseRosterImport(csv, "text/csv");
    expect(parsed[0]).toMatchObject({
      name: "Night Desk",
      platform: "podcast",
      rssUrl: "https://feeds.example.com/night",
      appleId: "1234567890",
      youtubeChannelId: UC,
      contactEmail: "host@example.com",
      isExclusive: true,
    });
  });

  it("rejects more than 500 rows and a body over 1 MB", () => {
    const header = "name,platform";
    const lines = [header];
    for (let i = 0; i < ROSTER_IMPORT_MAX_ROWS + 1; i++) lines.push(`Show ${i},podcast`);
    expect(() => parseRosterImport(lines.join("\n"), "text/csv")).toThrow(RosterImportError);
    try {
      parseRosterImport(lines.join("\n"), "text/csv");
    } catch (error) {
      expect(error).toBeInstanceOf(RosterImportError);
      expect((error as RosterImportError).status).toBe(400);
    }

    const ok = ["name,platform"];
    for (let i = 0; i < ROSTER_IMPORT_MAX_ROWS; i++) ok.push(`Show ${i},podcast`);
    expect(parseRosterImport(ok.join("\n"), "text/csv")).toHaveLength(ROSTER_IMPORT_MAX_ROWS);

    expect(() => assertRosterImportBytes(ROSTER_IMPORT_MAX_BYTES + 1)).toThrow(RosterImportError);
    try {
      assertRosterImportBytes(ROSTER_IMPORT_MAX_BYTES + 1);
    } catch (error) {
      expect((error as RosterImportError).status).toBe(413);
    }
    expect(() => assertRosterImportBytes(ROSTER_IMPORT_MAX_BYTES)).not.toThrow();
  });

  it("folds show names the same way as the past-campaign matcher", () => {
    const samples = [
      "The Acquired Podcast!",
      "My-Show",
      "Joe\u2019s Podcast",
      "The\u00A0Acquired\u00A0Podcast",
      "\u0130 Podcast",
      "ΣΊΣΥΦΟΣ",
    ];
    for (const sample of samples) {
      expect(normalizeRosterShowName(sample)).toBe(normalizeShowMatchKey(sample));
    }
  });
});

describe("importRoster matching", () => {
  it("matches a feed by normalized rss_url and ignores a different path", async () => {
    catalog({
      id: "show-rss",
      name: "Stored Mixed Case",
      rss_url: "HTTPS://Feeds.Example.com/Show/",
      is_discoverable: true,
      agent_id: OTHER,
      contact_email: SECRET,
      audience_size: 99999,
    });
    catalog({
      id: "show-other-feed",
      name: "Other Feed",
      rss_url: "https://feeds.example.com/other",
      is_discoverable: true,
      agent_id: null,
    });

    const preview = await run("preview", {
      rows: [{ name: "Imported", platform: "podcast", rss_url: "http://feeds.example.com/show" }],
    });
    expect(preview[0]).toMatchObject({
      class: "link_existing",
      match_tier: "rss_url",
      show_id: "show-rss",
      show_name: "Stored Mixed Case",
      needs_confirm: false,
      committed: false,
    });
    expect(JSON.stringify(preview)).not.toContain(SECRET);
    expect(JSON.stringify(preview)).not.toContain("99999");
    expect(writes()).toEqual([]);

    const missed = await run("preview", {
      rows: [{ name: "Imported", platform: "podcast", rss_url: "https://feeds.example.com/show/extra" }],
    });
    expect(missed[0].class).toBe("new_show");
    expect(missed[0].show_id).toBeNull();
  });

  it("matches a YouTube UC id and a /channel URL, and does not call YouTube", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("no network"));
    catalog({
      id: "show-yt",
      name: "Channel",
      youtube_channel_id: UC,
      is_discoverable: true,
      agent_id: null,
    });

    const byId = await run("preview", {
      rows: [{ name: "Imported", platform: "youtube", youtube_channel_id: UC }],
    });
    expect(byId[0]).toMatchObject({
      class: "link_existing",
      match_tier: "youtube_channel_id",
      show_id: "show-yt",
    });

    const byUrl = await run("preview", {
      rows: [
        {
          name: "Imported",
          platform: "youtube",
          youtube_channel_id: `https://www.youtube.com/channel/${UC}?view=videos`,
        },
      ],
    });
    expect(byUrl[0].show_id).toBe("show-yt");
    expect(byUrl[0].match_tier).toBe("youtube_channel_id");

    const handle = await run("preview", {
      rows: [
        {
          name: "Brand New Handle Show",
          platform: "youtube",
          youtube_channel_id: "https://www.youtube.com/@host",
        },
      ],
    });
    expect(handle[0].class).toBe("new_show");
    expect(handle[0].show_id).toBeNull();
    expect(youtubeChannelIdFromInput("https://www.youtube.com/@host")).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("matches an Apple id only against shows.apple_id", async () => {
    catalog({
      id: "show-apple",
      name: "Apple Show",
      apple_id: "1234567890",
      is_discoverable: true,
      agent_id: null,
    });
    catalog({
      id: "show-decoy",
      name: "Decoy",
      rss_url: "https://podcasts.apple.com/us/podcast/foo/id1234567890",
      contact_email: "id1234567890@example.com",
      is_discoverable: true,
      agent_id: null,
    });

    const matched = await run("preview", {
      rows: [
        {
          name: "Imported",
          platform: "podcast",
          apple_url: "https://podcasts.apple.com/us/podcast/foo/id1234567890",
        },
      ],
    });
    expect(matched[0]).toMatchObject({
      class: "link_existing",
      match_tier: "apple_id",
      show_id: "show-apple",
    });
  });

  it("suggests one normalized name and links it only when confirm is set", async () => {
    catalog({
      id: "show-name",
      name: "The Acquired Podcast",
      is_discoverable: true,
      agent_id: OTHER,
      contact_email: SECRET,
    });

    const preview = await run("preview", {
      rows: [{ name: "Acquired", platform: "podcast" }],
    });
    expect(preview[0]).toMatchObject({
      class: "link_existing",
      match_tier: "name",
      show_id: "show-name",
      show_name: "The Acquired Podcast",
      needs_confirm: true,
      committed: false,
    });
    expect(writes()).toEqual([]);

    mem.ops.length = 0;
    const held = await run("commit", {
      rows: [{ name: "Acquired", platform: "podcast" }],
    });
    expect(held[0].needs_confirm).toBe(true);
    expect(held[0].committed).toBe(false);
    expect(linkInserts()).toEqual([]);
    expect(showInserts()).toEqual([]);

    const linked = await run("commit", {
      rows: [{ name: "Acquired!", platform: "podcast", confirm: true }],
    });
    expect(linked[0]).toMatchObject({
      class: "link_existing",
      match_tier: "name",
      show_id: "show-name",
      needs_confirm: false,
      committed: true,
    });
    expect(showInserts()).toEqual([]);
    expect(mem.ops.some((op) => op.op === "update")).toBe(false);
    expect(linkInserts()).toHaveLength(1);
    expect(linkInserts()[0].row).toMatchObject({
      agent_id: AGENT,
      show_id: "show-name",
      status: "pending",
      source: "import",
      is_exclusive: true,
    });
  });

  it("does not suggest a hidden show owned by another agent, but a feed match returns id and name", async () => {
    catalog({
      id: "show-hidden",
      name: "Secret Desk",
      rss_url: "https://feeds.example.com/secret",
      is_discoverable: false,
      agent_id: OTHER,
      contact_email: SECRET,
      audience_size: 42,
      podscan_id: "pd_hidden",
    });

    const byName = await run("preview", {
      rows: [{ name: "Secret Desk", platform: "podcast" }],
    });
    expect(byName[0].class).toBe("new_show");
    expect(byName[0].show_id).toBeNull();
    expect(JSON.stringify(byName)).not.toContain("show-hidden");
    expect(JSON.stringify(byName)).not.toContain(SECRET);

    const byRss = await run("preview", {
      rows: [
        {
          name: "Different",
          platform: "podcast",
          rss_url: "https://feeds.example.com/secret",
        },
      ],
    });
    expect(byRss[0]).toMatchObject({
      class: "link_existing",
      match_tier: "rss_url",
      show_id: "show-hidden",
      show_name: "Secret Desk",
    });
    expect(JSON.stringify(byRss)).not.toContain(SECRET);
    expect(JSON.stringify(byRss)).not.toContain("pd_hidden");
    expect(Object.keys(byRss[0]).sort()).toEqual(
      [
        "class",
        "committed",
        "exclusive_conflict",
        "index",
        "is_exclusive",
        "link_id",
        "match_tier",
        "needs_confirm",
        "reasons",
        "show_id",
        "show_name",
      ].sort()
    );
  });

  it("can suggest the caller's own hidden show by name", async () => {
    catalog({
      id: "show-own",
      name: "Desk",
      is_discoverable: false,
      agent_id: AGENT,
    });
    const rows = await run("preview", {
      rows: [{ name: "The Desk Show", platform: "podcast" }],
    });
    expect(rows[0]).toMatchObject({
      class: "link_existing",
      match_tier: "name",
      show_id: "show-own",
      needs_confirm: true,
    });
  });

  it("does not fuzzy-match a longer name", async () => {
    catalog({
      id: "show-short",
      name: "Night Desk",
      is_discoverable: true,
      agent_id: null,
    });
    const rows = await run("preview", {
      rows: [{ name: "Night Desk Extra", platform: "podcast" }],
    });
    expect(rows[0].class).toBe("new_show");
    expect(rows[0].show_id).toBeNull();
  });

  it("rejects an ambiguous name and an ambiguous feed", async () => {
    catalog({
      id: "show-a",
      name: "Acquired",
      is_discoverable: true,
      agent_id: null,
    });
    catalog({
      id: "show-b",
      name: "The Acquired Podcast",
      is_discoverable: true,
      agent_id: null,
    });
    const names = await run("preview", {
      rows: [{ name: "Acquired", platform: "podcast" }],
    });
    expect(names[0].class).toBe("invalid");
    expect(names[0].show_id).toBeNull();
    expect(names[0].reasons[0]).toBe("Name matches more than one show.");

    mem.shows.length = 0;
    catalog({
      id: "feed-a",
      name: "One",
      rss_url: "https://feeds.example.com/same",
      is_discoverable: false,
      agent_id: OTHER,
    });
    catalog({
      id: "feed-b",
      name: "Two",
      rss_url: "http://feeds.example.com/same/",
      is_discoverable: true,
      agent_id: null,
    });
    const feeds = await run("preview", {
      rows: [{ name: "Imported", platform: "podcast", rss_url: "https://feeds.example.com/same" }],
    });
    expect(feeds[0].class).toBe("invalid");
    expect(feeds[0].show_id).toBeNull();
    expect(JSON.stringify(feeds)).not.toContain("feed-a");
  });

  it("prefers a feed match over a different name suggestion", async () => {
    catalog({
      id: "show-feed",
      name: "Feed Show",
      rss_url: "https://feeds.example.com/exact",
      is_discoverable: true,
      agent_id: null,
    });
    catalog({
      id: "show-name",
      name: "Acquired",
      is_discoverable: true,
      agent_id: null,
    });
    const rows = await run("preview", {
      rows: [
        {
          name: "Acquired",
          platform: "podcast",
          rss_url: "https://feeds.example.com/exact",
          confirm: true,
        },
      ],
    });
    expect(rows[0]).toMatchObject({
      class: "link_existing",
      match_tier: "rss_url",
      show_id: "show-feed",
    });
  });
});

describe("importRoster commit", () => {
  it("inserts a non-discoverable show for the caller and never writes is_claimed", async () => {
    const rows = await run("commit", {
      rows: [
        {
          name: "Fresh Show",
          platform: "podcast",
          contact_email: "host@example.com",
          rss_url: "https://feeds.example.com/fresh",
          podscan_id: "pd_ignore",
          agent_id: OTHER,
          is_claimed: true,
          ownership_status: "verified",
          is_exclusive: "false",
        },
      ],
    });
    expect(rows[0]).toMatchObject({
      class: "new_show",
      committed: true,
      show_id: "show-1",
      is_exclusive: false,
    });
    expect(showInserts()).toHaveLength(1);
    const show = showInserts()[0].row ?? {};
    expect(show).toMatchObject({
      name: "Fresh Show",
      platform: "podcast",
      agent_id: AGENT,
      is_discoverable: false,
      contact_email: "host@example.com",
      rss_url: "https://feeds.example.com/fresh",
    });
    expect(show).not.toHaveProperty("is_claimed");
    expect(show).not.toHaveProperty("ownership_status");
    expect(show).not.toHaveProperty("is_exclusive");
    expect(show).not.toHaveProperty("podscan_id");
    expect(show).not.toHaveProperty("is_verified");
    expect(linkInserts()[0].row).toMatchObject({
      agent_id: AGENT,
      show_id: "show-1",
      status: "pending",
      source: "import",
      is_exclusive: false,
    });
    expect(Object.keys(linkInserts()[0].row ?? {})).not.toContain("exclusive_conflict");
    expect(bridge.isShowsAdmin).toHaveBeenCalledWith(AGENT);
    expect(mem.ops.every((op) => op.table === "shows" || op.table === "agent_show_relationships")).toBe(
      true
    );
    expect(mem.ops.filter((op) => op.table === "shows" && op.op === "select").every((op) => op.columns === SHOW_SELECT)).toBe(
      true
    );
  });

  it("lets a shows admin insert a discoverable show and still omits is_claimed", async () => {
    bridge.isShowsAdmin.mockResolvedValue(true);
    await run("commit", {
      rows: [{ name: "Admin Show", platform: "youtube" }],
    });
    expect(showInserts()[0].row).toMatchObject({
      agent_id: AGENT,
      is_discoverable: true,
      platform: "youtube",
    });
    expect(showInserts()[0].row).not.toHaveProperty("is_claimed");
    expect(showInserts()[0].row).not.toHaveProperty("ownership_status");
  });

  it("does not update a show when linking one that already exists", async () => {
    catalog({
      id: "show-live",
      name: "Live",
      rss_url: "https://feeds.example.com/live",
      is_discoverable: true,
      agent_id: OTHER,
      audience_size: 10,
    });
    const rows = await run("commit", {
      rows: [
        {
          name: "Different",
          platform: "podcast",
          rss_url: "https://feeds.example.com/live",
          contact_email: "new@example.com",
        },
      ],
    });
    expect(rows[0]).toMatchObject({
      class: "link_existing",
      show_id: "show-live",
      committed: true,
    });
    expect(showInserts()).toEqual([]);
    expect(mem.ops.some((op) => op.op === "update")).toBe(false);
    expect(mem.ops.some((op) => op.op === "delete")).toBe(false);
    expect(mem.shows[0].audience_size).toBe(10);
    expect(mem.shows[0].contact_email).toBeUndefined();
    expect(linkInserts()[0].row).toMatchObject({
      show_id: "show-live",
      status: "pending",
      source: "import",
      is_exclusive: true,
    });
  });

  it("reports an approved exclusive link and still creates a pending one", async () => {
    catalog({
      id: "show-ex",
      name: "Exclusive",
      rss_url: "https://feeds.example.com/ex",
      is_discoverable: true,
      agent_id: OTHER,
    });
    link({
      id: "link-other",
      agent_id: OTHER,
      show_id: "show-ex",
      status: "approved",
      is_exclusive: true,
    });
    const rows = await run("commit", {
      rows: [{ name: "Imported", platform: "podcast", rss_url: "https://feeds.example.com/ex" }],
    });
    expect(rows[0]).toMatchObject({
      class: "exclusive_conflict",
      exclusive_conflict: true,
      committed: true,
      show_id: "show-ex",
    });
    expect(linkInserts()).toHaveLength(1);
    expect(linkInserts()[0].row).toEqual({
      agent_id: AGENT,
      show_id: "show-ex",
      is_exclusive: true,
      status: "pending",
      source: "import",
    });
    expect(mem.shows).toHaveLength(1);
  });

  it("does not treat another agent's pending exclusive link as a conflict", async () => {
    catalog({
      id: "show-pend",
      name: "Pending",
      apple_id: "1234567890",
      is_discoverable: true,
      agent_id: null,
    });
    link({
      id: "link-pending",
      agent_id: OTHER,
      show_id: "show-pend",
      status: "pending",
      is_exclusive: true,
    });
    const rows = await run("preview", {
      rows: [{ name: "Imported", platform: "podcast", apple_url: "id1234567890" }],
    });
    expect(rows[0]).toMatchObject({
      class: "link_existing",
      exclusive_conflict: false,
      match_tier: "apple_id",
    });
  });

  it.each(["pending", "approved", "rejected"] as const)(
    "treats an existing %s link as already on the roster",
    async (status) => {
      catalog({
        id: "show-own",
        name: "Own",
        rss_url: "https://feeds.example.com/own",
        is_discoverable: true,
        agent_id: AGENT,
      });
      link({
        id: "link-own",
        agent_id: AGENT,
        show_id: "show-own",
        status,
        is_exclusive: false,
      });
      const rows = await run("commit", {
        rows: [{ name: "Own", platform: "podcast", rss_url: "https://feeds.example.com/own" }],
      });
      expect(rows[0]).toMatchObject({
        class: "already_on_roster",
        link_id: "link-own",
        committed: false,
      });
      expect(linkInserts()).toEqual([]);
      expect(showInserts()).toEqual([]);
    }
  );

  it("does not insert a second link when the same roster is committed again", async () => {
    const body = {
      rows: [{ name: "Twice", platform: "podcast", rss_url: "https://feeds.example.com/twice" }],
    };
    const first = await run("commit", body);
    expect(first[0].class).toBe("new_show");
    expect(linkInserts()).toHaveLength(1);
    const second = await run("commit", body);
    expect(second[0]).toMatchObject({
      class: "already_on_roster",
      show_id: first[0].show_id,
      committed: false,
    });
    expect(linkInserts()).toHaveLength(1);
    expect(showInserts()).toHaveLength(1);
  });

  it("removes a show created in this request when the roster link insert fails", async () => {
    mem.failLink = { message: "insert denied", code: "42501" };
    const rows = await run("commit", {
      rows: [{ name: "Rollback", platform: "podcast" }],
    });
    expect(rows[0].committed).toBe(false);
    expect(rows[0].reasons[0]).toBe(
      "Could not add the roster link. The new show was removed."
    );
    expect(mem.shows).toEqual([]);
    expect(mem.links).toEqual([]);
    expect(mem.ops.some((op) => op.op === "delete" && op.table === "shows")).toBe(true);
  });

  it("ignores podscan_id and does not read show_profiles", async () => {
    catalog({
      id: "show-pod",
      name: "Unrelated",
      podscan_id: "pd_123",
      is_discoverable: true,
      agent_id: null,
    });
    const rows = await run("commit", {
      rows: [{ name: "Not The Unrelated Show", platform: "podcast", podscan_id: "pd_123" }],
    });
    expect(rows[0].class).toBe("new_show");
    expect(rows[0].show_id).not.toBe("show-pod");
    expect(showInserts()[0].row).not.toHaveProperty("podscan_id");
    expect(mem.ops.some((op) => op.table === "show_profiles")).toBe(false);
  });

  it("links the second row in one file to the show the first row just created", async () => {
    const rows = await run("commit", {
      rows: [
        { name: "First", platform: "podcast", rss_url: "https://feeds.example.com/same" },
        { name: "Second", platform: "podcast", rss_url: "http://feeds.example.com/same/" },
      ],
    });
    expect(rows[0].class).toBe("new_show");
    expect(rows[1]).toMatchObject({
      class: "already_on_roster",
      show_id: rows[0].show_id,
      committed: false,
    });
    expect(showInserts()).toHaveLength(1);
    expect(linkInserts()).toHaveLength(1);
  });

  it("marks an invalid platform and does not write", async () => {
    const rows = await run("commit", {
      rows: [{ name: "Nope", platform: "shorts" }],
    });
    expect(rows[0].class).toBe("invalid");
    expect(rows[0].reasons).toContain("Platform must be podcast or youtube.");
    expect(writes()).toEqual([]);
  });
});

describe("parseRosterMode", () => {
  it("defaults to preview and accepts commit", () => {
    expect(parseRosterMode(null)).toBe("preview");
    expect(parseRosterMode("")).toBe("preview");
    expect(parseRosterMode("PREVIEW")).toBe("preview");
    expect(parseRosterMode("commit")).toBe("commit");
    expect(parseRosterMode("approve")).toBeNull();
  });
});
