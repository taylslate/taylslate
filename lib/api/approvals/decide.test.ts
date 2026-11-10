import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ApiReadError } from "@/lib/api/v1/handler";

const BRAND = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const ACTION = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const SHOW = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1";
const PATTERN = "cccccccc-cccc-4ccc-8ccc-ccccccccccc1";
const CAMPAIGN = "dddddddd-dddd-4ddd-8ddd-ddddddddddd1";
const NOW = "2026-06-15T15:00:00.000Z";

const { getShow, createCampaign, getCampaignPatternById, logEvent, sendEmail, draftPitch, admin } =
  vi.hoisted(() => ({
    getShow: vi.fn(),
    createCampaign: vi.fn(),
    getCampaignPatternById: vi.fn(),
    logEvent: vi.fn(),
    sendEmail: vi.fn(),
    draftPitch: vi.fn(),
    admin: { current: null as ReturnType<typeof createMemoryAdmin> | null },
  }));

vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: { from: (table: string) => admin.current!.from(table) },
}));
vi.mock("@/lib/api/v1/reads", () => ({
  getShow: (...args: unknown[]) => getShow(...args),
}));
vi.mock("@/lib/data/queries", () => ({
  createCampaign: (...args: unknown[]) => createCampaign(...args),
}));
vi.mock("@/lib/data/reasoning-log", () => ({
  getCampaignPatternById: (...args: unknown[]) => getCampaignPatternById(...args),
}));
vi.mock("@/lib/data/events", () => ({
  logEvent: (...args: unknown[]) => logEvent(...args),
}));
vi.mock("@/lib/email/send", () => ({
  sendEmail: (...args: unknown[]) => sendEmail(...args),
}));
vi.mock("@/lib/llm/client", () => ({
  getAnthropic: () => { throw new Error("anthropic should not load"); },
}));
vi.mock("@/lib/prompts/outreach-pitch", () => ({
  draftOutreachPitch: (...args: unknown[]) => draftPitch(...args),
}));

import { decideAction, parseDecisionBody, isSameOriginRequest } from "@/lib/api/approvals/decide";
import { EXECUTION_ERROR } from "@/lib/api/approvals/execute";

function campaignPayload(extra: Record<string, unknown> = {}) {
  return {
    product: {
      brand_name: "Sauna Box",
      category: "Home",
      product_description: "A home sauna kit.",
      aov_bucket: "high",
      aov_reasoning: "Kits sell above two hundred dollars.",
      key_attributes: ["home"],
      source: "url",
      url: "https://saunabox.example",
    },
    customer_text: "SECRET_CUSTOMER_TEXT",
    goals: ["test_channel"],
    goals_context: "SECRET_GOALS_CONTEXT",
    budget_total: 25000,
    flight: { mode: "preset", preset: "next_30_days" },
    exclusions_text: "SECRET_EXCLUSIONS",
    ...extra,
  };
}

function outreachPayload() {
  return {
    show_id: SHOW,
    subject: "SECRET_SUBJECT",
    body: "We think this is a strong fit for the audience and would like to start with three reads.",
  };
}

function seed(row: Record<string, unknown>) {
  admin.current = createMemoryAdmin({
    api_write_actions: [row],
    api_keys: [],
    profiles: [],
  });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(NOW));
  getShow.mockReset();
  createCampaign.mockReset();
  getCampaignPatternById.mockReset();
  logEvent.mockReset();
  sendEmail.mockReset();
  draftPitch.mockReset();
  getShow.mockResolvedValue({ name: "Visible Show" });
  createCampaign.mockResolvedValue({ id: CAMPAIGN });
  getCampaignPatternById.mockResolvedValue(null);
  logEvent.mockResolvedValue(null);
  seed({
    id: ACTION,
    brand_id: BRAND,
    api_key_id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1",
    kind: "campaign.create",
    status: "pending",
    payload: campaignPayload(),
    payload_hash: "payload-hash-secret",
    idempotency_key: "idem-secret",
    created_at: NOW,
    decided_by: null,
    decided_at: null,
    decision_note: null,
    executed_at: null,
    result_campaign_id: null,
    execution_error: null,
    execution_started_at: null,
  });
});

describe("parseDecisionBody", () => {
  it("rejects unknown keys and a note that is not printable", () => {
    expect(parseDecisionBody({ decision: "approve", extra: true }).ok).toBe(false);
    expect(parseDecisionBody({ decision: "approve", note: "bad\nline" }).ok).toBe(false);
    expect(parseDecisionBody({ decision: "approve", note: "x".repeat(501) }).ok).toBe(false);
    const parsed = parseDecisionBody({ decision: "reject", note: "  looks good  " });
    expect(parsed).toEqual({ ok: true, decision: "reject", note: "looks good" });
  });
});

describe("decideAction", () => {
  it("approves a campaign once and creates one draft", async () => {
    const first = await decideAction({
      userId: BRAND,
      actionId: ACTION,
      decision: "approve",
      note: "Ship it",
    });
    const second = await decideAction({
      userId: BRAND,
      actionId: ACTION,
      decision: "approve",
      note: null,
    });
    expect(first.ok).toBe(true);
    if (first.ok) {
      expect(first.action.result_campaign_id).toBe(CAMPAIGN);
      expect(first.message).toBe("Approved.");
      expect(JSON.stringify(first)).not.toMatch(/payload_hash|key_hash|idempotency_key|SECRET_CUSTOMER/);
    }
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.httpStatus).toBe(409);
    expect(createCampaign).toHaveBeenCalledTimes(1);
    const args = createCampaign.mock.calls[0][0];
    expect(args).toMatchObject({
      user_id: BRAND,
      status: "draft",
      platforms: ["podcast", "youtube"],
      recommendations: [],
      budget_total: 25000,
      name: "Sauna Box - June 2026",
    });
    expect(args.brief.version).toBe(2);
    expect(args.brief.goals).toEqual(["test_channel"]);
    expect(args.name).not.toContain("\u2014");
    expect(loggedText()).not.toMatch(/SECRET_CUSTOMER|SECRET_EXCLUSIONS|SECRET_GOALS/);
    const row = admin.current!.rows("api_write_actions")[0];
    expect(row.status).toBe("approved");
    expect(row.decided_by).toBe(BRAND);
    expect(row.result_campaign_id).toBe(CAMPAIGN);
  });

  it("lets two concurrent approvals create one campaign", async () => {
    const [left, right] = await Promise.all([
      decideAction({ userId: BRAND, actionId: ACTION, decision: "approve", note: null }),
      decideAction({ userId: BRAND, actionId: ACTION, decision: "approve", note: null }),
    ]);
    const wins = [left, right].filter((result) => result.ok);
    expect(wins).toHaveLength(1);
    expect(createCampaign).toHaveBeenCalledTimes(1);
    expect(admin.current!.rows("api_write_actions")[0].status).toBe("approved");
  });

  it("lets two concurrent retries create one campaign", async () => {
    const row = admin.current!.rows("api_write_actions")[0];
    row.status = "approved";
    row.decided_by = BRAND;
    row.decided_at = NOW;
    const [left, right] = await Promise.all([
      decideAction({ userId: BRAND, actionId: ACTION, decision: "retry", note: null }),
      decideAction({ userId: BRAND, actionId: ACTION, decision: "retry", note: null }),
    ]);
    expect([left, right].filter((result) => result.ok)).toHaveLength(1);
    expect(createCampaign).toHaveBeenCalledTimes(1);
    expect(row.result_campaign_id).toBe(CAMPAIGN);
  });

  it("expires a pending row older than 14 days", async () => {
    admin.current!.rows("api_write_actions")[0].created_at = "2026-05-01T15:00:00.000Z";
    const result = await decideAction({
      userId: BRAND,
      actionId: ACTION,
      decision: "approve",
      note: null,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.httpStatus).toBe(409);
      expect(result.status).toBe("expired");
    }
    expect(createCampaign).not.toHaveBeenCalled();
    expect(admin.current!.rows("api_write_actions")[0].status).toBe("expired");
  });

  it("rejects without creating a campaign", async () => {
    const result = await decideAction({
      userId: BRAND,
      actionId: ACTION,
      decision: "reject",
      note: null,
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.message).toBe("Rejected.");
    expect(createCampaign).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
    expect(admin.current!.mutations.every((item) => item.table === "api_write_actions" && item.op === "update")).toBe(true);
    expect(logEvent).toHaveBeenCalledWith(expect.objectContaining({
      eventType: "api_action.rejected",
      entityType: "api_action",
      entityId: ACTION,
      payload: { action_id: ACTION, kind: "campaign.create" },
    }));
  });

  it("returns 404 for another brand", async () => {
    const result = await decideAction({
      userId: OTHER,
      actionId: ACTION,
      decision: "approve",
      note: null,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.httpStatus).toBe(404);
    expect(createCampaign).not.toHaveBeenCalled();
    expect(admin.current!.rows("api_write_actions")[0].status).toBe("pending");
  });

  it("records an outreach approval and does not send", async () => {
    const row = admin.current!.rows("api_write_actions")[0];
    row.kind = "outreach.draft";
    row.payload = outreachPayload();
    const result = await decideAction({
      userId: BRAND,
      actionId: ACTION,
      decision: "approve",
      note: null,
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.message).toBe("Approved. Nothing was sent.");
    expect(getShow).toHaveBeenCalledWith(BRAND, SHOW);
    expect(sendEmail).not.toHaveBeenCalled();
    expect(draftPitch).not.toHaveBeenCalled();
    expect(createCampaign).not.toHaveBeenCalled();
    expect(admin.current!.mutations.some((item) => item.op === "insert")).toBe(false);
    expect(row.status).toBe("approved");
    expect(loggedText()).not.toContain("SECRET_SUBJECT");
  });

  it("does not decide an outreach draft when the show is gone", async () => {
    const row = admin.current!.rows("api_write_actions")[0];
    row.kind = "outreach.draft";
    row.payload = outreachPayload();
    getShow.mockRejectedValue(new ApiReadError(404, "Not found."));
    const result = await decideAction({
      userId: BRAND,
      actionId: ACTION,
      decision: "approve",
      note: null,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.httpStatus).toBe(409);
      expect(result.error).toBe("This show is no longer available.");
    }
    expect(row.status).toBe("pending");
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("fails execution when the reused pattern belongs to someone else", async () => {
    const row = admin.current!.rows("api_write_actions")[0];
    row.payload = campaignPayload({
      customer_context: { reused_from_pattern_id: PATTERN },
    });
    getCampaignPatternById.mockResolvedValue({
      id: PATTERN,
      customer_id: OTHER,
      product_attributes: { brand_name: "Other Brand" },
    });
    const result = await decideAction({
      userId: BRAND,
      actionId: ACTION,
      decision: "approve",
      note: null,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.httpStatus).toBe(502);
      expect(result.error).toBe(EXECUTION_ERROR);
      expect(result.error).not.toMatch(/duplicate|constraint|sql/i);
    }
    expect(createCampaign).not.toHaveBeenCalled();
    expect(row.status).toBe("approved");
    expect(row.execution_error).toBe(EXECUTION_ERROR);
    expect(row.result_campaign_id).toBeNull();
  });
});

describe("approval modules do not send", () => {
  it("does not import email, Resend, or Anthropic", () => {
    const files = [
      "decide.ts",
      "execute.ts",
      "list.ts",
      join(__dirname, "../../../app/api/settings/agent-actions/route.ts"),
      join(__dirname, "../../../app/api/settings/agent-actions/[id]/route.ts"),
      join(__dirname, "../../../app/(dashboard)/settings/agent-actions/agent-actions-client.tsx"),
    ];
    for (const file of files) {
      const path = file.startsWith("/") || file.includes("app/") ? file : join(__dirname, file);
      const text = readFileSync(path, "utf8");
      expect(text).not.toMatch(/sendEmail|from "resend"|@anthropic-ai|lib\/email|lib\/llm|outreach-pitch|dangerouslySetInnerHTML/);
    }
  });
});

describe("isSameOriginRequest", () => {
  it("requires the origin host to match the request host", () => {
    const same = new Request("http://localhost/api/settings/agent-actions/x", {
      headers: { origin: "http://localhost", host: "localhost" },
    });
    const cross = new Request("http://localhost/api/settings/agent-actions/x", {
      headers: { origin: "https://evil.example", host: "localhost" },
    });
    expect(isSameOriginRequest(same)).toBe(true);
    expect(isSameOriginRequest(cross)).toBe(false);
  });
});

function loggedText(): string {
  return JSON.stringify(logEvent.mock.calls);
}

type Filter =
  | { op: "eq"; column: string; value: unknown }
  | { op: "gte" | "lt"; column: string; value: unknown }
  | { op: "is"; column: string; value: unknown }
  | { op: "in"; column: string; value: unknown[] };

function createMemoryAdmin(seed: Record<string, Record<string, unknown>[]>) {
  const tables = new Map<string, Record<string, unknown>[]>();
  for (const [name, rows] of Object.entries(seed)) tables.set(name, rows.map((row) => ({ ...row })));
  const mutations: Array<{ table: string; op: string }> = [];

  function rows(table: string): Record<string, unknown>[] {
    let list = tables.get(table);
    if (!list) {
      list = [];
      tables.set(table, list);
    }
    return list;
  }

  function from(table: string) {
    const state = {
      filters: [] as Filter[],
      ors: [] as string[],
      orders: [] as Array<{ column: string; ascending: boolean }>,
      max: null as number | null,
      columns: null as string | null,
      patch: null as Record<string, unknown> | null,
    };

    function matched(): Record<string, unknown>[] {
      return rows(table).filter((row) => {
        for (const filter of state.filters) {
          if (!filterMatches(row, filter)) return false;
        }
        for (const expression of state.ors) {
          if (!orMatch(row, expression)) return false;
        }
        return true;
      });
    }

    function project(row: Record<string, unknown>): Record<string, unknown> {
      if (!state.columns || state.columns.trim() === "*") return { ...row };
      const out: Record<string, unknown> = {};
      for (const column of state.columns.split(",").map((part) => part.trim())) {
        out[column] = row[column];
      }
      return out;
    }

    function execute() {
      const found = matched();
      if (state.patch) {
        mutations.push({ table, op: "update" });
        for (const row of found) Object.assign(row, state.patch);
      }
      let list = found;
      if (state.orders.length > 0) {
        list = [...list].sort((left, right) => {
          for (const order of state.orders) {
            const a = left[order.column] == null ? "" : String(left[order.column]);
            const b = right[order.column] == null ? "" : String(right[order.column]);
            if (a === b) continue;
            const cmp = a < b ? -1 : 1;
            return order.ascending ? cmp : -cmp;
          }
          return 0;
        });
      }
      if (state.max != null) list = list.slice(0, state.max);
      return { data: list.map(project), error: null };
    }

    const builder = {
      select(columns?: string) {
        state.columns = columns ?? "*";
        return builder;
      },
      update(patch: Record<string, unknown>) {
        state.patch = patch;
        return builder;
      },
      eq(column: string, value: unknown) {
        state.filters.push({ op: "eq", column, value });
        return builder;
      },
      gte(column: string, value: unknown) {
        state.filters.push({ op: "gte", column, value });
        return builder;
      },
      lt(column: string, value: unknown) {
        state.filters.push({ op: "lt", column, value });
        return builder;
      },
      is(column: string, value: unknown) {
        state.filters.push({ op: "is", column, value });
        return builder;
      },
      in(column: string, value: unknown[]) {
        state.filters.push({ op: "in", column, value });
        return builder;
      },
      or(expression: string) {
        state.ors.push(expression);
        return builder;
      },
      order(column: string, options?: { ascending?: boolean }) {
        state.orders.push({ column, ascending: options?.ascending !== false });
        return builder;
      },
      limit(count: number) {
        state.max = count;
        return builder;
      },
      maybeSingle() {
        const result = execute();
        return Promise.resolve({ data: result.data[0] ?? null, error: result.error });
      },
      then(onFulfilled: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) {
        try {
          return Promise.resolve(onFulfilled(execute()));
        } catch (err) {
          if (onRejected) return Promise.resolve(onRejected(err));
          return Promise.reject(err);
        }
      },
    };
    return builder;
  }

  return { from, rows, mutations };
}

function filterMatches(row: Record<string, unknown>, filter: Filter): boolean {
  const left = row[filter.column];
  if (filter.op === "eq") return left === filter.value;
  if (filter.op === "in") return filter.value.includes(left);
  if (filter.op === "is") return filter.value === null ? left == null : left === filter.value;
  const cmp = compare(left, filter.value);
  if (filter.op === "gte") return cmp >= 0;
  if (filter.op === "lt") return cmp < 0;
  return false;
}

function compare(left: unknown, right: unknown): number {
  const a = left == null ? "" : String(left);
  const b = right == null ? "" : String(right);
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

type Term =
  | { kind: "cmp"; column: string; op: string; value: string }
  | { kind: "and" | "or"; terms: Term[] }
  | { kind: "never" };

function orMatch(row: Record<string, unknown>, expression: string): boolean {
  return splitTop(expression).some((part) => termMatches(row, parseTerm(part.trim())));
}

function termMatches(row: Record<string, unknown>, term: Term): boolean {
  if (term.kind === "never") return false;
  if (term.kind === "and") return term.terms.every((child) => termMatches(row, child));
  if (term.kind === "or") return term.terms.some((child) => termMatches(row, child));
  if (term.kind !== "cmp") return false;
  const left = row[term.column];
  if (term.op === "is") return term.value === "null" ? left == null : String(left) === term.value;
  if (term.op === "eq") return left == null ? term.value === "null" : String(left) === term.value;
  const cmp = compare(left, term.value);
  if (term.op === "lt") return cmp < 0;
  if (term.op === "gt") return cmp > 0;
  if (term.op === "lte") return cmp <= 0;
  if (term.op === "gte") return cmp >= 0;
  return false;
}

function parseTerm(part: string): Term {
  const trimmed = part.trim();
  if (trimmed.startsWith("and(") && trimmed.endsWith(")")) {
    return { kind: "and", terms: splitTop(trimmed.slice(4, -1)).map(parseTerm) };
  }
  if (trimmed.startsWith("or(") && trimmed.endsWith(")")) {
    return { kind: "or", terms: splitTop(trimmed.slice(3, -1)).map(parseTerm) };
  }
  const match = /^([a-z_][a-z0-9_]*)\.(eq|lt|gt|lte|gte|in|is)\.(.*)$/i.exec(trimmed);
  if (!match) return { kind: "never" };
  let raw = match[3];
  if (raw.startsWith('"') && raw.endsWith('"') && raw.length >= 2) raw = raw.slice(1, -1);
  return { kind: "cmp", column: match[1], op: match[2].toLowerCase(), value: raw };
}

function splitTop(input: string): string[] {
  const parts: string[] = [];
  let current = "";
  let depth = 0;
  let quote = false;
  for (const char of input) {
    if (char === '"') {
      quote = !quote;
      current += char;
      continue;
    }
    if (!quote && char === "(") depth += 1;
    if (!quote && char === ")") depth -= 1;
    if (!quote && depth === 0 && char === ",") {
      parts.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  if (current.length > 0) parts.push(current);
  return parts;
}
