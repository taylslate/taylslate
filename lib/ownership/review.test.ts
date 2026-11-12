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
    profiles: [] as Row[],
  },
  queries: [] as Query[],
  emails: {} as Record<string, string | null>,
  forceUnique: false,
  missingColumn: false,
  fail: null as { table: string; action: "select" | "insert" | "update"; code: string; message: string } | null,
  seq: 0,
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

function finish(query: Query, single: boolean) {
  state.queries.push(query);
  if (state.missingColumn && query.action === "select" && (query.columns ?? "").includes("decision_note")) {
    return Promise.resolve({
      data: null,
      error: { code: "42703", message: 'column "decision_note" does not exist' },
    });
  }
  if (state.fail && state.fail.table === query.table && state.fail.action === query.action) {
    const error = { code: state.fail.code, message: state.fail.message };
    state.fail = null;
    return Promise.resolve({ data: null, error });
  }
  const table = tableRows(query.table);
  if (query.action === "insert") {
    const inserted = (query.rows ?? []).map((row) => {
      state.seq += 1;
      const stored = { ...row, id: row.id ?? `proof-${state.seq}` };
      table.push(stored);
      return stored;
    });
    return Promise.resolve({ data: inserted, error: null });
  }
  let rows = table.filter((row) => matches(row, query.filters));
  if (query.action === "update") {
    const patch = query.patch ?? {};
    if (patch.status === "verified") {
      const clash =
        state.forceUnique ||
        rows.some((row) =>
          table.some((other) => other !== row && other.show_id === row.show_id && other.status === "verified")
        );
      if (clash && rows.length > 0) {
        return Promise.resolve({
          data: null,
          error: { code: "23505", message: "duplicate key secret-db-text code_hash owner@example.com" },
        });
      }
    }
    for (const row of rows) Object.assign(row, patch);
    if (single) return Promise.resolve({ data: rows[0] ?? null, error: null });
    return Promise.resolve({ data: rows.map((row) => ({ ...row })), error: null });
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
  return Promise.resolve({ data: rows.map((row) => ({ ...row })), error: null });
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
    then(resolve: (value: { data: unknown; error: { code?: string; message?: string } | null }) => unknown, reject?: (reason: unknown) => unknown) {
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
  },
}));

vi.mock("@/lib/auth/auth-email", () => ({
  getAuthEmail: async (id: string) => (id in state.emails ? state.emails[id] : null),
}));

const releaseHeldPayoutsForShow = vi.hoisted(() => vi.fn());

vi.mock("@/lib/payouts/release", () => ({
  releaseHeldPayoutsForShow: (...args: unknown[]) => releaseHeldPayoutsForShow(...args),
}));

import {
  OWNERSHIP_ALREADY_DECIDED,
  OWNERSHIP_ALREADY_VERIFIED,
  OWNERSHIP_APPROVE_FAILED,
  OWNERSHIP_DUPLICATE,
  OWNERSHIP_EXPLANATION_ERROR,
  OWNERSHIP_LINK_ERROR,
  OWNERSHIP_REASON_REQUIRED,
  OWNERSHIP_REVIEW_MIGRATION,
  OWNERSHIP_SIBLING_NOTE,
  approveOwnershipProof,
  getOwnershipDetail,
  listOwnershipQueue,
  rejectOwnershipProof,
  requestManualOwnership,
} from "./review";
import { OWNERSHIP_ERRORS, OWNERSHIP_MESSAGES } from "./check";

const ADMIN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const PROFILE = "33333333-3333-4333-8333-333333333333";
const SHOW_A = "00000000-0000-4000-8000-000000000001";
const SHOW_B = "00000000-0000-4000-8000-000000000002";
const SHOW_C = "00000000-0000-4000-8000-000000000003";
const PROOF = "44444444-4444-4444-8444-444444444444";
const REP = "55555555-5555-4555-8555-555555555555";
const FEED = "https://feeds.example.com/show";
const TARGET = "feeds.example.com/show";
const UC = "UC1234567890abcdefghij_-";
const HASH = "hash-secret-do-not-leak";
const EXPLANATION = "I host this show and can add a line to the description.";

function proofs(): Row[] {
  return state.tables.show_ownership_proofs;
}

function writes(table: string): Query[] {
  return state.queries.filter((query) => query.table === table && query.action !== "select");
}

describe("ownership review", () => {
  beforeEach(() => {
    state.tables.show_profiles = [{ id: PROFILE, user_id: USER, feed_url: FEED }];
    state.tables.shows = [
      { id: SHOW_A, name: "Odd Lots", rss_url: FEED, youtube_channel_id: null, ownership_status: "unclaimed" },
      { id: SHOW_B, name: "Sibling", rss_url: FEED, youtube_channel_id: UC, ownership_status: "unclaimed" },
    ];
    state.tables.profiles = [{ id: REP, company_name: "Northwind", full_name: "Lee" }];
    state.tables.agent_show_relationships = [
      { id: "rel-1", show_id: SHOW_A, agent_id: REP, status: "approved", is_exclusive: true },
    ];
    state.tables.show_ownership_proofs = [];
    state.queries = [];
    state.emails = { [USER]: "owner@example.com", [ADMIN]: "admin@example.com", [OTHER]: "other@example.com" };
    state.forceUnique = false;
    state.missingColumn = false;
    state.fail = null;
    state.seq = 0;
    releaseHeldPayoutsForShow.mockReset();
    releaseHeldPayoutsForShow.mockResolvedValue({ released: 0, held: 0, failed: 0 });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("lists contested and open expired proofs oldest first, without a hash or profile id", async () => {
    proofs().push(
      {
        id: PROOF,
        show_id: SHOW_A,
        user_id: USER,
        show_profile_id: PROFILE,
        method: "rss_code",
        status: "contested",
        target: TARGET,
        note: "needs_admin_review",
        miss_count: 5,
        last_checked_at: "2026-01-02T00:00:00.000Z",
        created_at: "2026-01-02T00:00:00.000Z",
        code_hash: HASH,
      },
      {
        id: "expired-old",
        show_id: SHOW_B,
        user_id: USER,
        show_profile_id: PROFILE,
        method: "admin",
        status: "expired",
        target: TARGET,
        note: "old",
        created_at: "2026-01-01T00:00:00.000Z",
        code_hash: HASH,
      },
      {
        id: "newer",
        show_id: SHOW_B,
        user_id: USER,
        status: "pending",
        created_at: "2026-03-01T00:00:00.000Z",
        code_hash: HASH,
      },
      {
        id: "expired-kept",
        show_id: SHOW_A,
        user_id: OTHER,
        method: "youtube_code",
        status: "expired",
        target: UC,
        note: "still open",
        created_at: "2026-01-03T00:00:00.000Z",
        code_hash: HASH,
      }
    );
    const listed = await listOwnershipQueue({ status: null });
    expect(listed.ok).toBe(true);
    if (!listed.ok) return;
    expect(listed.proofs.map((row) => row.id)).toEqual([PROOF, "expired-kept"]);
    expect(listed.proofs[0]).toMatchObject({
      show_name: "Odd Lots",
      method: "rss_code",
      requester_email: "owner@example.com",
      miss_count: 5,
      note: "needs_admin_review",
      exclusive_rep: true,
      rep_label: "Northwind",
    });
    expect(listed.proofs[1].exclusive_rep).toBe(true);
    const body = JSON.stringify(listed);
    expect(body).not.toContain(HASH);
    expect(body).not.toContain(PROFILE);
    expect(body).not.toContain("show_profile_id");
    expect(body).not.toContain("code_hash");
    const contested = await listOwnershipQueue({ status: "contested" });
    expect(contested.ok && contested.proofs.map((row) => row.id)).toEqual([PROOF]);
  });

  it("returns at most 100 proofs", async () => {
    for (let i = 0; i < 101; i += 1) {
      proofs().push({
        id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
        show_id: SHOW_A,
        user_id: USER,
        method: "admin",
        status: "contested",
        target: TARGET,
        created_at: new Date(Date.parse("2026-01-01T00:00:00.000Z") + i * 1000).toISOString(),
      });
    }
    const listed = await listOwnershipQueue({ status: "contested" });
    expect(listed.ok && listed.proofs).toHaveLength(100);
    if (!listed.ok) return;
    expect(listed.proofs[0].id.endsWith("000000000000")).toBe(true);
    expect(listed.proofs.some((row) => row.id.endsWith("000000000100"))).toBe(false);
  });

  it("returns the show, other proofs, and rep links, and 404 for an unknown id", async () => {
    proofs().push(
      {
        id: PROOF,
        show_id: SHOW_A,
        user_id: USER,
        show_profile_id: PROFILE,
        method: "admin",
        status: "contested",
        target: TARGET,
        note: "Manual review: I host it",
        created_at: "2026-02-01T00:00:00.000Z",
        code_hash: HASH,
      },
      {
        id: "other-proof",
        show_id: SHOW_A,
        user_id: OTHER,
        method: "rss_code",
        status: "rejected",
        created_at: "2026-01-01T00:00:00.000Z",
        decided_at: "2026-01-02T00:00:00.000Z",
        decided_by: ADMIN,
        code_hash: HASH,
      }
    );
    const detail = await getOwnershipDetail(PROOF);
    expect(detail.ok).toBe(true);
    if (!detail.ok) return;
    expect(detail.detail.proof).toMatchObject({
      show_name: "Odd Lots",
      rss_url: FEED,
      ownership_status: "unclaimed",
      requester_email: "owner@example.com",
    });
    expect(detail.detail.other_proofs).toEqual([
      expect.objectContaining({
        status: "rejected",
        method: "rss_code",
        decided_by_email: "admin@example.com",
      }),
    ]);
    expect(detail.detail.rep_links).toEqual([
      { rep_label: "Northwind", status: "approved", is_exclusive: true },
    ]);
    const body = JSON.stringify(detail);
    expect(body).not.toContain(HASH);
    expect(body).not.toContain(PROFILE);
    expect(body).not.toContain(ADMIN);
    const missing = await getOwnershipDetail("99999999-9999-4999-8999-999999999999");
    expect(missing).toEqual({ ok: false, status: 404, error: "Not found" });
    expect(await getOwnershipDetail("not-a-uuid")).toEqual({ ok: false, status: 400, error: "Bad request." });
  });

  it("approves once, verifies the show, rejects the other open proofs, and leaves rep links", async () => {
    const beforeLinks = JSON.stringify(state.tables.agent_show_relationships);
    proofs().push(
      {
        id: PROOF,
        show_id: SHOW_A,
        user_id: USER,
        status: "contested",
        code_hash: HASH,
        note: "needs_admin_review",
        created_at: "2026-02-01T00:00:00.000Z",
      },
      { id: "pending-sib", show_id: SHOW_A, user_id: OTHER, status: "pending", code_hash: HASH },
      { id: "expired-sib", show_id: SHOW_A, user_id: OTHER, status: "expired", code_hash: HASH },
      { id: "kept", show_id: SHOW_A, user_id: OTHER, status: "rejected", decision_note: "Kept." },
      { id: "other-show", show_id: SHOW_B, user_id: USER, status: "verified" }
    );
    const result = await approveOwnershipProof({
      proofId: PROOF,
      adminId: ADMIN,
      now: new Date("2026-04-01T00:00:00.000Z"),
    });
    expect(result).toEqual({ ok: true });
    const approved = proofs().find((row) => row.id === PROOF);
    expect(approved).toMatchObject({
      status: "verified",
      decided_by: ADMIN,
      decided_at: "2026-04-01T00:00:00.000Z",
      verified_at: "2026-04-01T00:00:00.000Z",
      code_hash: null,
    });
    expect(proofs().find((row) => row.id === "pending-sib")).toMatchObject({
      status: "rejected",
      decision_note: OWNERSHIP_SIBLING_NOTE,
      decided_by: ADMIN,
    });
    expect(proofs().find((row) => row.id === "expired-sib")?.status).toBe("rejected");
    expect(proofs().find((row) => row.id === "kept")?.decision_note).toBe("Kept.");
    expect(proofs().find((row) => row.id === "other-show")?.status).toBe("verified");
    expect(state.tables.shows.find((row) => row.id === SHOW_A)?.ownership_status).toBe("verified");
    expect(state.tables.shows.find((row) => row.id === SHOW_B)?.ownership_status).toBe("unclaimed");
    expect(JSON.stringify(state.tables.agent_show_relationships)).toBe(beforeLinks);
    expect(writes("agent_show_relationships")).toEqual([]);
    expect(releaseHeldPayoutsForShow).toHaveBeenCalledTimes(1);
    expect(releaseHeldPayoutsForShow).toHaveBeenCalledWith(SHOW_A);
  });

  it("returns 409 and changes nothing on a lost race or a verified owner", async () => {
    proofs().push({ id: PROOF, show_id: SHOW_A, user_id: USER, status: "verified", code_hash: HASH });
    const lost = await approveOwnershipProof({ proofId: PROOF, adminId: ADMIN });
    expect(lost).toEqual({ ok: false, status: 409, error: OWNERSHIP_ALREADY_DECIDED });
    expect(proofs()[0].status).toBe("verified");
    expect(proofs()[0].code_hash).toBe(HASH);

    proofs()[0].status = "contested";
    proofs().push({ id: "held", show_id: SHOW_A, user_id: OTHER, status: "verified" });
    const logs: string[] = [];
    vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    });
    const clash = await approveOwnershipProof({ proofId: PROOF, adminId: ADMIN });
    expect(clash).toEqual({ ok: false, status: 409, error: OWNERSHIP_ALREADY_VERIFIED });
    expect(proofs().find((row) => row.id === PROOF)?.status).toBe("contested");
    expect(state.tables.shows[0].ownership_status).toBe("unclaimed");
    expect(logs.join("\n")).not.toContain("secret-db-text");
    expect(logs.join("\n")).not.toContain(HASH);
    expect(JSON.stringify(clash)).not.toContain("secret-db-text");
  });

  it("logs only the error code when a later approve step fails", async () => {
    proofs().push({ id: PROOF, show_id: SHOW_A, user_id: USER, status: "expired" });
    state.fail = { table: "shows", action: "update", code: "XX000", message: "secret-db-text owner@example.com" };
    const logs: string[] = [];
    vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    });
    const result = await approveOwnershipProof({ proofId: PROOF, adminId: ADMIN });
    expect(result).toEqual({ ok: false, status: 500, error: OWNERSHIP_APPROVE_FAILED });
    expect(proofs()[0].status).toBe("verified");
    expect(logs.join("\n")).toContain("XX000");
    expect(logs.join("\n")).not.toContain("secret-db-text");
    expect(logs.join("\n")).not.toContain("owner@example.com");
    expect(JSON.stringify(result)).not.toContain(PROOF);
  });

  it("retries the show update and sibling rejection when the proof is already verified by an admin", async () => {
    proofs().push(
      { id: PROOF, show_id: SHOW_A, user_id: USER, status: "contested", code_hash: HASH },
      { id: "pending-sib", show_id: SHOW_A, user_id: OTHER, status: "pending" },
      { id: "expired-sib", show_id: SHOW_A, user_id: OTHER, status: "expired" }
    );
    state.fail = { table: "shows", action: "update", code: "XX000", message: "secret-db-text" };
    const failed = await approveOwnershipProof({
      proofId: PROOF,
      adminId: ADMIN,
      now: new Date("2026-04-01T00:00:00.000Z"),
    });
    expect(failed).toEqual({ ok: false, status: 500, error: OWNERSHIP_APPROVE_FAILED });
    expect(proofs().find((row) => row.id === PROOF)?.status).toBe("verified");
    expect(state.tables.shows.find((row) => row.id === SHOW_A)?.ownership_status).toBe("unclaimed");
    expect(proofs().find((row) => row.id === "pending-sib")?.status).toBe("pending");

    const again = await approveOwnershipProof({
      proofId: PROOF,
      adminId: ADMIN,
      now: new Date("2026-04-02T00:00:00.000Z"),
    });
    expect(again).toEqual({ ok: true });
    expect(proofs().find((row) => row.id === PROOF)).toMatchObject({
      status: "verified",
      decided_by: ADMIN,
      code_hash: null,
    });
    expect(state.tables.shows.find((row) => row.id === SHOW_A)?.ownership_status).toBe("verified");
    expect(proofs().find((row) => row.id === "pending-sib")).toMatchObject({
      status: "rejected",
      decision_note: OWNERSHIP_SIBLING_NOTE,
      decided_by: ADMIN,
    });
    expect(proofs().find((row) => row.id === "expired-sib")?.status).toBe("rejected");
    expect(writes("agent_show_relationships")).toEqual([]);
    expect(releaseHeldPayoutsForShow).toHaveBeenCalledTimes(1);
    expect(releaseHeldPayoutsForShow).toHaveBeenCalledWith(SHOW_A);

    const ownerProof = "66666666-6666-4666-8666-666666666666";
    proofs().push({ id: ownerProof, show_id: SHOW_B, user_id: USER, status: "verified", code_hash: null });
    const ownerVerified = await approveOwnershipProof({ proofId: ownerProof, adminId: ADMIN });
    expect(ownerVerified).toEqual({ ok: false, status: 409, error: OWNERSHIP_ALREADY_DECIDED });
    expect(state.tables.shows.find((row) => row.id === SHOW_B)?.ownership_status).toBe("unclaimed");
  });

  it("rejects with a reason and leaves ownership_status unchanged", async () => {
    proofs().push({ id: PROOF, show_id: SHOW_A, user_id: USER, status: "contested", note: "needs_admin_review" });
    const missing = await rejectOwnershipProof({ proofId: PROOF, adminId: ADMIN, reason: "  " });
    expect(missing).toEqual({ ok: false, status: 400, error: OWNERSHIP_REASON_REQUIRED });
    const long = await rejectOwnershipProof({ proofId: PROOF, adminId: ADMIN, reason: "n".repeat(501) });
    expect(long).toEqual({ ok: false, status: 400, error: OWNERSHIP_REASON_REQUIRED });
    expect(proofs()[0].status).toBe("contested");
    const result = await rejectOwnershipProof({
      proofId: PROOF,
      adminId: ADMIN,
      reason: "  The feed does not match this show.  ",
      now: new Date("2026-04-02T00:00:00.000Z"),
    });
    expect(result).toEqual({ ok: true });
    expect(proofs()[0]).toMatchObject({
      status: "rejected",
      decision_note: "The feed does not match this show.",
      decided_by: ADMIN,
      note: "needs_admin_review",
    });
    expect(state.tables.shows[0].ownership_status).toBe("unclaimed");
    expect(writes("shows")).toEqual([]);
    expect(releaseHeldPayoutsForShow).not.toHaveBeenCalled();
  });

  it("asks for manual review once per show and refuses a duplicate, a miss, and an http link", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const http = await requestManualOwnership({
      userId: USER,
      showProfileId: PROFILE,
      medium: "podcast",
      explanation: EXPLANATION,
      link: "http://example.com/proof",
    });
    expect(http).toEqual({ ok: false, status: 400, error: OWNERSHIP_LINK_ERROR });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(proofs()).toHaveLength(0);

    const short = await requestManualOwnership({
      userId: USER,
      showProfileId: PROFILE,
      medium: "podcast",
      explanation: "too short",
    });
    expect(short).toEqual({ ok: false, status: 400, error: OWNERSHIP_EXPLANATION_ERROR });

    state.tables.shows = [{ id: SHOW_C, name: "Missing", rss_url: "https://other.example/feed", ownership_status: "unclaimed" }];
    const none = await requestManualOwnership({
      userId: USER,
      showProfileId: PROFILE,
      medium: "podcast",
      explanation: EXPLANATION,
    });
    expect(none).toEqual({ ok: false, status: 409, error: OWNERSHIP_ERRORS.noCatalog });
    expect(proofs()).toHaveLength(0);

    state.tables.shows = [
      { id: SHOW_A, name: "Odd Lots", rss_url: FEED, ownership_status: "unclaimed" },
      { id: SHOW_B, name: "Sibling", rss_url: `${FEED}/`, ownership_status: "unclaimed" },
    ];
    const ok = await requestManualOwnership({
      userId: USER,
      showProfileId: PROFILE,
      medium: "podcast",
      explanation: EXPLANATION,
      link: "https://example.com/proof",
      channel: "ignored",
    });
    expect(ok).toEqual({ ok: true, message: OWNERSHIP_MESSAGES.review });
    expect(proofs()).toHaveLength(2);
    expect(proofs().every((row) => row.method === "admin" && row.status === "contested")).toBe(true);
    expect(proofs().every((row) => row.user_id === USER && row.show_profile_id === PROFILE)).toBe(true);
    expect(proofs().every((row) => row.target === TARGET)).toBe(true);
    expect(proofs()[0].note).toBe(`Manual review: ${EXPLANATION} Link: https://example.com/proof`);
    expect(proofs().every((row) => row.code_hash == null)).toBe(true);

    const again = await requestManualOwnership({
      userId: USER,
      showProfileId: PROFILE,
      medium: "podcast",
      explanation: EXPLANATION,
    });
    expect(again).toEqual({ ok: false, status: 409, error: OWNERSHIP_DUPLICATE });
    expect(proofs()).toHaveLength(2);
    expect(writes("agent_show_relationships")).toEqual([]);
  });

  it("returns 503 and writes nothing when decision_note is missing", async () => {
    state.missingColumn = true;
    proofs().push({ id: PROOF, show_id: SHOW_A, user_id: USER, status: "contested" });
    const listed = await listOwnershipQueue({ status: null });
    expect(listed).toEqual({ ok: false, status: 503, error: OWNERSHIP_REVIEW_MIGRATION });
    const approved = await approveOwnershipProof({ proofId: PROOF, adminId: ADMIN });
    expect(approved).toEqual({ ok: false, status: 503, error: OWNERSHIP_REVIEW_MIGRATION });
    expect(proofs()[0].status).toBe("contested");
    expect(writes("show_ownership_proofs")).toEqual([]);
  });

  it("stores a YouTube manual request against the channel id", async () => {
    state.tables.shows = [{ id: SHOW_A, name: "Odd Lots", youtube_channel_id: UC, ownership_status: "unclaimed" }];
    const youtube = await requestManualOwnership({
      userId: USER,
      showProfileId: PROFILE,
      medium: "youtube",
      explanation: EXPLANATION,
      channel: `https://www.youtube.com/channel/${UC}`,
    });
    expect(youtube).toEqual({ ok: true, message: OWNERSHIP_MESSAGES.review });
    expect(proofs()[0]).toMatchObject({ method: "admin", status: "contested", target: UC, show_id: SHOW_A });
    expect(proofs()[0].note).toBe(`Manual review: ${EXPLANATION}`);
  });

  it("keeps the approve response when payout release throws", async () => {
    proofs().push({ id: PROOF, show_id: SHOW_A, user_id: USER, status: "contested" });
    releaseHeldPayoutsForShow.mockRejectedValueOnce(new Error("secret-db-text"));
    const logs: string[] = [];
    vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    });
    const result = await approveOwnershipProof({ proofId: PROOF, adminId: ADMIN });
    expect(result).toEqual({ ok: true });
    expect(releaseHeldPayoutsForShow).toHaveBeenCalledWith(SHOW_A);
    expect(JSON.stringify(result)).not.toContain("secret-db-text");
    expect(logs.join("\n")).not.toContain("secret-db-text");
    expect(logs.join("\n")).toContain("Error");
  });
});
