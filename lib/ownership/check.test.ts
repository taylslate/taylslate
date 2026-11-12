import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;

interface Filter {
  op: "eq" | "in" | "ilike";
  column: string;
  value: unknown;
}

interface Query {
  table: string;
  action: "select" | "insert" | "update";
  columns?: string;
  filters: Filter[];
  patch?: Row;
  rows?: Row[];
  limit?: number;
  orders: { column: string; ascending: boolean }[];
}

const state = vi.hoisted(() => ({
  tables: {
    show_profiles: [] as Row[],
    shows: [] as Row[],
    show_ownership_proofs: [] as Row[],
    agent_show_relationships: [] as Row[],
  },
  queries: [] as Query[],
  forceUnique: false,
  failTable: "",
  rpcMode: "ok" as "ok" | "fail" | "deny-minute" | "deny-day",
  seq: 0,
  clock: Date.parse("2026-06-01T00:00:00.000Z"),
}));

function matches(row: Row, filters: Filter[]): boolean {
  return filters.every((filter) => {
    if (filter.op === "eq") return row[filter.column] === filter.value;
    if (filter.op === "in") return (filter.value as unknown[]).includes(row[filter.column]);
    const token = String(filter.value)
      .replace(/^%/, "")
      .replace(/%$/, "")
      .replace(/\\([%_\\])/g, "$1")
      .toLowerCase();
    return String(row[filter.column] ?? "").toLowerCase().includes(token);
  });
}

function tableRows(name: string): Row[] {
  return state.tables[name as keyof typeof state.tables] ?? [];
}

function finish(query: Query, single: boolean): Promise<{ data: unknown; error: { code?: string; message?: string } | null }> {
  state.queries.push(query);
  if (state.failTable && state.failTable === query.table) {
    return Promise.resolve({ data: null, error: { code: "XX000", message: "secret-db-text" } });
  }
  const table = tableRows(query.table);
  if (query.action === "insert") {
    const inserted = (query.rows ?? []).map((row) => {
      state.clock += 1000;
      const stored = {
        ...row,
        id: row.id ?? `proof-${state.seq += 1}`,
        created_at: row.created_at ?? new Date(state.clock).toISOString(),
        updated_at: row.updated_at ?? new Date(state.clock).toISOString(),
        status: row.status ?? "pending",
        check_count: row.check_count ?? 0,
        miss_count: row.miss_count ?? 0,
      };
      table.push(stored);
      return stored;
    });
    return Promise.resolve({ data: inserted, error: null });
  }
  let rows = table.filter((row) => matches(row, query.filters));
  if (query.action === "update") {
    const patch = query.patch ?? {};
    if (patch.status === "verified") {
      const clash = rows.some((row) =>
        state.forceUnique ||
        table.some(
          (other) =>
            other !== row &&
            other.show_id === row.show_id &&
            other.status === "verified"
        )
      );
      if (clash) {
        const hash = rows[0]?.code_hash;
        return Promise.resolve({
          data: null,
          error: { code: "23505", message: `duplicate key ${String(hash)} SHOULD_NOT_LOG` },
        });
      }
    }
    for (const row of rows) Object.assign(row, patch);
    return Promise.resolve({ data: rows.map((row) => ({ id: row.id })), error: null });
  }
  for (const order of query.orders) {
    rows = [...rows].sort((a, b) => {
      const av = String(a[order.column] ?? "");
      const bv = String(b[order.column] ?? "");
      if (av === bv) return 0;
      const cmp = av < bv ? -1 : 1;
      return order.ascending ? cmp : -cmp;
    });
  }
  if (query.limit !== undefined) rows = rows.slice(0, query.limit);
  if (single) return Promise.resolve({ data: rows[0] ?? null, error: null });
  return Promise.resolve({ data: rows, error: null });
}

function builder(table: string) {
  const query: Query = { table, action: "select", filters: [], orders: [] };
  const api = {
    select(columns: string) {
      query.columns = columns;
      return api;
    },
    insert(payload: Row | Row[]) {
      query.action = "insert";
      query.rows = Array.isArray(payload) ? payload.map((row) => ({ ...row })) : [{ ...payload }];
      return api;
    },
    update(patch: Row) {
      query.action = "update";
      query.patch = patch;
      return api;
    },
    eq(column: string, value: unknown) {
      query.filters.push({ op: "eq", column, value });
      return api;
    },
    in(column: string, value: unknown[]) {
      query.filters.push({ op: "in", column, value });
      return api;
    },
    ilike(column: string, value: string) {
      query.filters.push({ op: "ilike", column, value });
      return api;
    },
    order(column: string, opts?: { ascending?: boolean }) {
      query.orders.push({ column, ascending: opts?.ascending !== false });
      return api;
    },
    limit(n: number) {
      query.limit = n;
      return api;
    },
    maybeSingle() {
      return finish(query, true);
    },
    then(
      resolve: (value: { data: unknown; error: { code?: string; message?: string } | null }) => unknown,
      reject?: (reason: unknown) => unknown
    ) {
      return finish(query, false).then(resolve, reject);
    },
  };
  return api;
}

vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: {
    from(table: string) {
      return builder(table);
    },
    rpc(_fn: string, args: { p_bucket: string }) {
      if (state.rpcMode === "fail") {
        return Promise.resolve({ data: null, error: { code: "XX000", message: "rate backend down" } });
      }
      if (state.rpcMode === "deny-minute" && args.p_bucket === "ownership_check_user_minute") {
        return Promise.resolve({ data: false, error: null });
      }
      if (state.rpcMode === "deny-day" && args.p_bucket === "ownership_check_user_day") {
        return Promise.resolve({ data: false, error: null });
      }
      if (state.rpcMode === "deny-day" && args.p_bucket === "ownership_start_user_day") {
        return Promise.resolve({ data: false, error: null });
      }
      return Promise.resolve({ data: true, error: null });
    },
  },
}));

const rssRead = vi.fn();
const ytRead = vi.fn();

vi.mock("./rss-proof", () => ({
  readRssProofText: (...args: unknown[]) => rssRead(...args),
}));

vi.mock("./youtube-proof", () => ({
  readYoutubeDescription: (...args: unknown[]) => ytRead(...args),
}));

import { hashOwnershipCode } from "./code";
import {
  OWNERSHIP_ERRORS,
  OWNERSHIP_MESSAGES,
  checkOwnership,
  enforceOwnershipCheck,
  enforceOwnershipStart,
  parseYoutubeChannelTarget,
  requestIsSameOrigin,
  startOwnership,
} from "./check";

const USER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const PROFILE = "33333333-3333-4333-8333-333333333333";
const SHOW_A = "00000000-0000-4000-8000-000000000001";
const SHOW_B = "00000000-0000-4000-8000-000000000002";
const SHOW_NAME = "Hidden Show Name";
const PODSCAN = "podscan-secret-99";
const FEED = "https://Feeds.Example.com/Show/";
const TARGET = "feeds.example.com/show";
const UC = "UC1234567890abcdefghij_-";

const logs: string[] = [];

function resetDb(): void {
  state.tables.show_profiles = [{ id: PROFILE, user_id: USER, feed_url: FEED }];
  state.tables.shows = [
    {
      id: SHOW_A,
      name: SHOW_NAME,
      podscan_id: PODSCAN,
      rss_url: "https://Feeds.Example.com/Show",
      youtube_channel_id: UC,
      ownership_status: "unclaimed",
    },
  ];
  state.tables.show_ownership_proofs = [];
  state.tables.agent_show_relationships = [];
  state.queries = [];
  state.forceUnique = false;
  state.failTable = "";
  state.rpcMode = "ok";
  state.seq = 0;
}

function proofs(): Row[] {
  return state.tables.show_ownership_proofs;
}

function assertNoSecrets(code?: string, hash?: string): void {
  const blob = logs.join("\n");
  if (code) expect(blob).not.toContain(code);
  if (hash) expect(blob).not.toContain(hash);
  expect(blob).not.toContain("secret-db-text");
  expect(blob).not.toContain("SHOULD_NOT_LOG");
  expect(blob).not.toContain(SHOW_NAME);
  expect(blob).not.toContain(SHOW_A);
}

async function startPodcast(now?: Date) {
  return startOwnership({
    userId: USER,
    showProfileId: PROFILE,
    medium: "podcast",
    now,
  });
}

describe("ownership check", () => {
  beforeEach(() => {
    resetDb();
    logs.length = 0;
    rssRead.mockReset();
    ytRead.mockReset();
    rssRead.mockResolvedValue({ status: "ok", text: "no code in the feed" });
    ytRead.mockResolvedValue({ status: "unavailable" });
    vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    });
    vi.spyOn(console, "info").mockImplementation((...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    });
    vi.spyOn(console, "warn").mockImplementation((...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    });
    vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    });
    vi.spyOn(console, "debug").mockImplementation((...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.NEXT_PUBLIC_SITE_URL;
  });

  it("returns 400 when the show profile has no feed and writes nothing", async () => {
    state.tables.show_profiles[0].feed_url = "  ";
    const result = await startPodcast();
    expect(result).toEqual({ ok: false, status: 400, error: OWNERSHIP_ERRORS.noFeed });
    expect(proofs()).toHaveLength(0);
  });

  it("returns 409 when the catalog has no match and writes nothing", async () => {
    state.tables.shows = [];
    proofs().push({
      id: "keep-pending",
      user_id: USER,
      show_id: SHOW_A,
      target: TARGET,
      status: "pending",
      code_hash: "abc",
      created_at: "2026-01-01T00:00:00.000Z",
    });
    const result = await startPodcast();
    expect(result).toEqual({ ok: false, status: 409, error: OWNERSHIP_ERRORS.noCatalog });
    expect(proofs()[0].status).toBe("pending");
    expect(proofs()[0].code_hash).toBe("abc");
  });

  it("returns the code once and stores only its hash", async () => {
    const older = {
      id: "other-target",
      user_id: USER,
      show_id: SHOW_B,
      show_profile_id: PROFILE,
      target: "other.example/feed",
      status: "pending",
      code_hash: "eeee",
      created_at: "2020-01-01T00:00:00.000Z",
    };
    proofs().push(older);
    const result = await startPodcast(new Date("2026-03-01T00:00:00.000Z"));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.code).toMatch(/^TAYLSLATE-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/);
    expect(result.message).toBe(OWNERSHIP_MESSAGES.paste);
    expect(result.target).toBe(TARGET);
    expect(result.medium).toBe("podcast");
    const mine = proofs().filter((row) => row.user_id === USER && row.target === TARGET);
    expect(mine).toHaveLength(1);
    expect(mine[0].code_hash).toBe(hashOwnershipCode(result.code));
    expect(mine[0].status).toBe("pending");
    expect(mine[0].method).toBe("rss_code");
    expect(mine[0].show_profile_id).toBe(PROFILE);
    expect(mine[0].show_id).toBe(SHOW_A);
    expect(mine[0].code_expires_at).toBe("2026-03-08T00:00:00.000Z");
    expect(JSON.stringify(mine[0])).not.toContain(result.code);
    expect(JSON.stringify(result)).not.toContain(SHOW_A);
    expect(JSON.stringify(result)).not.toContain(SHOW_NAME);
    expect(JSON.stringify(result)).not.toContain(PODSCAN);
    expect(older.status).toBe("pending");
    expect(state.queries.every((query) => !String(query.columns ?? "").includes("podscan"))).toBe(true);
    expect(state.queries.every((query) => !String(query.columns ?? "").includes("name"))).toBe(true);
    assertNoSecrets(result.code, String(mine[0].code_hash));
  });

  it("writes one proof per matching show, up to 5, and leaves another user's row alone", async () => {
    state.tables.shows = Array.from({ length: 6 }, (_, index) => ({
      id: `00000000-0000-4000-8000-00000000000${index + 1}`,
      name: SHOW_NAME,
      rss_url: "https://Feeds.Example.com/Show",
      ownership_status: "unclaimed",
    }));
    state.tables.shows.push({
      id: "00000000-0000-4000-8000-000000000099",
      name: "Other Feed",
      rss_url: "https://feeds.example.com/show-extra",
      ownership_status: "unclaimed",
    });
    const foreign = {
      id: "foreign-proof",
      user_id: OTHER,
      show_id: SHOW_A,
      target: TARGET,
      status: "pending",
      code_hash: "ffff",
      check_count: 0,
      miss_count: 0,
      created_at: "2026-01-01T00:00:00.000Z",
    };
    proofs().push({ ...foreign });
    const result = await startPodcast();
    expect(result.ok).toBe(true);
    const mine = proofs().filter((row) => row.user_id === USER);
    expect(mine).toHaveLength(5);
    expect(mine.map((row) => row.show_id)).toEqual([
      "00000000-0000-4000-8000-000000000001",
      "00000000-0000-4000-8000-000000000002",
      "00000000-0000-4000-8000-000000000003",
      "00000000-0000-4000-8000-000000000004",
      "00000000-0000-4000-8000-000000000005",
    ]);
    expect(mine.every((row) => row.code_hash === mine[0].code_hash)).toBe(true);
    expect(proofs().find((row) => row.id === "foreign-proof")).toEqual(foreign);
  });

  it("verifies a hit, clears the hash, and marks the show verified", async () => {
    const started = await startPodcast();
    if (!started.ok) throw new Error("start failed");
    rssRead.mockResolvedValue({ status: "ok", text: `channel ${started.code.toLowerCase()} notes` });
    const checked = await checkOwnership({ userId: USER, now: new Date("2026-03-02T00:00:00.000Z") });
    expect(checked).toEqual({ ok: true, outcome: "verified", message: OWNERSHIP_MESSAGES.verified });
    const row = proofs().find((item) => item.user_id === USER);
    expect(row?.status).toBe("verified");
    expect(row?.code_hash).toBeNull();
    expect(row?.verified_at).toBe("2026-03-02T00:00:00.000Z");
    expect(row?.check_count).toBe(1);
    expect(state.tables.shows[0].ownership_status).toBe("verified");
    expect(rssRead).toHaveBeenCalledWith(`https://${TARGET}`);
    expect(JSON.stringify(checked)).not.toContain(started.code);
    expect(JSON.stringify(checked)).not.toContain(SHOW_A);
    assertNoSecrets(started.code, hashOwnershipCode(started.code));
  });

  it("counts a miss, and the 5th miss becomes contested", async () => {
    const started = await startPodcast();
    if (!started.ok) throw new Error("start failed");
    const first = await checkOwnership({ userId: USER });
    expect(first).toEqual({ ok: true, outcome: "miss", message: OWNERSHIP_MESSAGES.miss });
    expect(proofs().find((row) => row.user_id === USER)?.miss_count).toBe(1);
    expect(proofs().find((row) => row.user_id === USER)?.status).toBe("pending");

    const row = proofs().find((item) => item.user_id === USER);
    if (!row) throw new Error("missing proof");
    row.miss_count = 4;
    const fifth = await checkOwnership({ userId: USER });
    expect(fifth).toEqual({ ok: true, outcome: "contested", message: OWNERSHIP_MESSAGES.review });
    expect(row.miss_count).toBe(5);
    expect(row.status).toBe("contested");
    expect(row.note).toBe("needs_admin_review");
    expect(JSON.stringify(fifth)).not.toContain(started.code);
  });

  it("expires a code without a fetch and clears the hash", async () => {
    const started = await startPodcast(new Date("2026-01-01T00:00:00.000Z"));
    if (!started.ok) throw new Error("start failed");
    const checked = await checkOwnership({ userId: USER, now: new Date("2026-01-08T00:00:00.000Z") });
    expect(checked).toEqual({ ok: true, outcome: "expired", message: OWNERSHIP_MESSAGES.review });
    const row = proofs().find((item) => item.user_id === USER);
    expect(row?.status).toBe("expired");
    expect(row?.code_hash).toBeNull();
    expect(row?.miss_count).toBe(0);
    expect(rssRead).not.toHaveBeenCalled();
    assertNoSecrets(started.code, hashOwnershipCode(started.code));
  });

  it("counts a blocked feed as a miss and does not return fetch detail", async () => {
    const started = await startPodcast();
    if (!started.ok) throw new Error("start failed");
    rssRead.mockResolvedValue({ status: "blocked" });
    const checked = await checkOwnership({ userId: USER });
    expect(checked).toEqual({ ok: true, outcome: "miss", message: OWNERSHIP_MESSAGES.miss });
    expect(proofs().find((row) => row.user_id === USER)?.miss_count).toBe(1);
    expect(JSON.stringify(checked)).not.toContain("blocked");
    expect(JSON.stringify(checked)).not.toContain("127.0.0.1");
  });

  it("sends an exclusive rep hit to review and does not verify the show", async () => {
    state.tables.agent_show_relationships.push({
      show_id: SHOW_A,
      agent_id: OTHER,
      status: "approved",
      is_exclusive: true,
    });
    const started = await startPodcast();
    if (!started.ok) throw new Error("start failed");
    rssRead.mockResolvedValue({ status: "ok", text: started.code });
    const checked = await checkOwnership({ userId: USER });
    expect(checked).toEqual({ ok: true, outcome: "contested", message: OWNERSHIP_MESSAGES.review });
    const row = proofs().find((item) => item.user_id === USER);
    expect(row?.status).toBe("contested");
    expect(row?.note).toBe("needs_admin_review");
    expect(state.tables.shows[0].ownership_status).toBe("unclaimed");
  });

  it("contests a show that is already verified", async () => {
    proofs().push({
      id: "already-verified",
      user_id: OTHER,
      show_id: SHOW_A,
      show_profile_id: PROFILE,
      status: "verified",
      code_hash: null,
      target: TARGET,
      created_at: "2020-01-01T00:00:00.000Z",
      check_count: 1,
      miss_count: 0,
    });
    const started = await startPodcast();
    if (!started.ok) throw new Error("start failed");
    rssRead.mockResolvedValue({ status: "ok", text: started.code });
    const checked = await checkOwnership({ userId: USER });
    expect(checked).toEqual({ ok: true, outcome: "contested", message: OWNERSHIP_MESSAGES.review });
    expect(proofs().find((row) => row.id === "already-verified")?.status).toBe("verified");
    expect(proofs().find((row) => row.user_id === USER)?.status).toBe("contested");
    expect(state.tables.shows[0].ownership_status).toBe("unclaimed");
  });

  it("treats a 23505 race as contested and does not log the hash", async () => {
    state.forceUnique = true;
    const started = await startPodcast();
    if (!started.ok) throw new Error("start failed");
    rssRead.mockResolvedValue({ status: "ok", text: started.code });
    const checked = await checkOwnership({ userId: USER });
    expect(checked).toEqual({ ok: true, outcome: "contested", message: OWNERSHIP_MESSAGES.review });
    const row = proofs().find((item) => item.user_id === USER);
    expect(row?.status).toBe("contested");
    expect(row?.note).toBe("needs_admin_review");
    expect(state.tables.shows[0].ownership_status).toBe("unclaimed");
    expect(logs.some((line) => line.includes("23505"))).toBe(true);
    assertNoSecrets(started.code, hashOwnershipCode(started.code));
  });

  it("verifies a YouTube channel description that contains the code", async () => {
    const started = await startOwnership({
      userId: USER,
      showProfileId: PROFILE,
      medium: "youtube",
      channel: UC,
    });
    if (!started.ok) throw new Error("start failed");
    ytRead.mockResolvedValue({ status: "ok", description: `About ${started.code.toLowerCase()}` });
    const checked = await checkOwnership({ userId: USER });
    expect(checked).toEqual({ ok: true, outcome: "verified", message: OWNERSHIP_MESSAGES.verified });
    expect(proofs().find((row) => row.user_id === USER)?.code_hash).toBeNull();
    expect(state.tables.shows[0].ownership_status).toBe("verified");
    expect(rssRead).not.toHaveBeenCalled();
    assertNoSecrets(started.code, hashOwnershipCode(started.code));
  });

  it("does not count a miss when YouTube is unavailable", async () => {
    state.tables.show_profiles[0].feed_url = null;
    const started = await startOwnership({
      userId: USER,
      showProfileId: PROFILE,
      medium: "youtube",
      channel: `https://www.youtube.com/channel/${UC}`,
    });
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    expect(started.target).toBe(UC);
    ytRead.mockResolvedValue({ status: "unavailable" });
    const checked = await checkOwnership({ userId: USER });
    expect(checked).toEqual({ ok: true, outcome: "unavailable", message: OWNERSHIP_MESSAGES.youtube });
    const row = proofs().find((item) => item.user_id === USER);
    expect(row?.miss_count).toBe(0);
    expect(row?.status).toBe("pending");
    expect(row?.check_count).toBe(1);
    expect(ytRead).toHaveBeenCalledWith(UC);
    expect(JSON.stringify(checked)).not.toContain(started.code);
    assertNoSecrets(started.code, hashOwnershipCode(started.code));
  });

  it("verifies one show and contests the exclusive show on the same code", async () => {
    state.tables.shows.push({
      id: SHOW_B,
      name: "Second Hidden",
      rss_url: "https://feeds.example.com/show",
      ownership_status: "unclaimed",
    });
    state.tables.agent_show_relationships.push({
      show_id: SHOW_B,
      agent_id: OTHER,
      status: "approved",
      is_exclusive: true,
    });
    const started = await startPodcast();
    if (!started.ok) throw new Error("start failed");
    rssRead.mockResolvedValue({ status: "ok", text: started.code });
    const checked = await checkOwnership({ userId: USER });
    expect(checked).toEqual({ ok: true, outcome: "contested", message: OWNERSHIP_MESSAGES.review });
    const mine = proofs().filter((row) => row.user_id === USER);
    expect(mine.find((row) => row.show_id === SHOW_A)?.status).toBe("verified");
    expect(mine.find((row) => row.show_id === SHOW_B)?.status).toBe("contested");
    expect(state.tables.shows.find((row) => row.id === SHOW_A)?.ownership_status).toBe("verified");
    expect(state.tables.shows.find((row) => row.id === SHOW_B)?.ownership_status).toBe("unclaimed");
  });

  it("does not read or change another user's proof on check", async () => {
    const started = await startPodcast();
    if (!started.ok) throw new Error("start failed");
    const foreign = {
      id: "foreign-proof",
      user_id: OTHER,
      show_id: SHOW_B,
      target: TARGET,
      status: "pending",
      code_hash: "abc123",
      check_count: 2,
      miss_count: 1,
      created_at: "2026-08-01T00:00:00.000Z",
    };
    proofs().push({ ...foreign });
    await checkOwnership({ userId: USER });
    expect(proofs().find((row) => row.id === "foreign-proof")).toEqual(foreign);
  });

  it("logs only the error code when a read fails", async () => {
    state.failTable = "show_profiles";
    const result = await startPodcast();
    expect(result).toEqual({ ok: false, status: 503, error: OWNERSHIP_ERRORS.unavailable });
    expect(logs.some((line) => line.includes("XX000"))).toBe(true);
    assertNoSecrets();
  });

  it("rate limits checks per minute and per day, and fails closed", async () => {
    state.rpcMode = "deny-minute";
    const minute = await enforceOwnershipCheck(USER);
    expect(minute?.status).toBe(429);
    expect(minute?.headers.get("Retry-After")).toBe("60");
    expect(await minute?.json()).toEqual({ error: OWNERSHIP_ERRORS.rate });

    state.rpcMode = "deny-day";
    const day = await enforceOwnershipCheck(USER);
    expect(day?.status).toBe(429);
    expect(day?.headers.get("Retry-After")).toBe("86400");

    const startDay = await enforceOwnershipStart(USER);
    expect(startDay?.status).toBe(429);
    expect(startDay?.headers.get("Retry-After")).toBe(String(24 * 60 * 60));

    state.rpcMode = "fail";
    const closed = await enforceOwnershipCheck(USER);
    expect(closed?.status).toBe(503);
    const body = await closed?.json();
    expect(body).toEqual({ error: "unavailable" });
    expect(JSON.stringify(body)).not.toContain("rate backend");
  });

  it("accepts a channel id and refuses a handle", () => {
    expect(parseYoutubeChannelTarget(UC)).toBe(UC);
    expect(parseYoutubeChannelTarget(`https://www.youtube.com/channel/${UC}?view=1`)).toBe(UC);
    expect(parseYoutubeChannelTarget(`https://m.youtube.com/channel/${UC}`)).toBe(UC);
    expect(parseYoutubeChannelTarget("https://www.youtube.com/@saunabox")).toBeNull();
    expect(parseYoutubeChannelTarget("youtube.com/@saunabox")).toBeNull();
    expect(parseYoutubeChannelTarget("not a channel")).toBeNull();
  });

  it("refuses a cross-origin request and accepts the www host", () => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://www.taylslate.com";
    expect(requestIsSameOrigin(null)).toBe(false);
    expect(requestIsSameOrigin("https://evil.example")).toBe(false);
    expect(requestIsSameOrigin("https://www.taylslate.com")).toBe(true);
    process.env.NEXT_PUBLIC_SITE_URL = "https://taylslate.com";
    expect(requestIsSameOrigin("https://www.taylslate.com")).toBe(true);
    delete process.env.NEXT_PUBLIC_SITE_URL;
    expect(requestIsSameOrigin("https://www.taylslate.com")).toBe(false);
  });
});
