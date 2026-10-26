import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { MemoryAdmin } from "@/lib/api/memory-admin";

const bridge = vi.hoisted(() => ({
  keys: null as MemoryAdmin | null,
  data: null as {
    rows: (table: string) => Record<string, unknown>[];
    mutations: { table: string; op: string }[];
    from: (table: string) => unknown;
  } | null,
  recordEvent: vi.fn(async () => undefined),
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient: vi.fn(() => ({
    auth: { getUser: vi.fn(async () => ({ data: { user: null } })) },
  })),
}));

vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: {
    from: (table: string) => {
      if (table === "api_keys" || table === "profiles") return bridge.keys!.from(table);
      return bridge.data!.from(table);
    },
    rpc: (name: string, args: { p_key_id: string; p_window_start: string }) =>
      bridge.keys!.rpc(name, args),
  },
}));

vi.mock("@/lib/data/event-log", () => ({
  recordEvent: () => bridge.recordEvent(),
}));

import { createMemoryAdmin } from "@/lib/api/memory-admin";
import { createKey } from "@/lib/api/keys";
import { API_WRITE_MAX_BODY_BYTES } from "@/lib/api/v1/handler";
import { POST as createCampaign } from "./campaigns/route";
import { GET as listCampaigns } from "./campaigns/route";
import { POST as createOutreach } from "./outreach/route";
import { GET as listActions } from "./actions/route";
import { GET as getAction } from "./actions/[id]/route";

const BRAND = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const UNTIED = "99999999-9999-4999-8999-999999999999";
const PROFILE = "33333333-3333-4333-8333-333333333333";
const SHOW_PUBLIC = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const SHOW_OWNED = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";
const SHOW_HIDDEN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3";

function campaignBody(budget = 25000) {
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
    customer_text: "People who want a sauna at home.",
    goals: ["test_channel"],
    budget_total: budget,
    flight: { mode: "preset", preset: "next_30_days" },
  };
}

function draftBody(showId: string) {
  return {
    show_id: showId,
    subject: "A sponsorship for your show",
    body: "We think this is a strong fit for the audience and would like to start with three reads.",
  };
}

function post(
  handler: (req: Request, route: { params: Promise<Record<string, never>> }) => Promise<Response>,
  path: string,
  token: string | undefined,
  body: unknown,
  headers: Record<string, string> = {}
) {
  const requestHeaders = new Headers(headers);
  if (token) requestHeaders.set("authorization", `Bearer ${token}`);
  if (!requestHeaders.has("content-type")) requestHeaders.set("content-type", "application/json");
  const payload = typeof body === "string" ? body : JSON.stringify(body);
  const req = new NextRequest(`https://www.taylslate.com${path}`, {
    method: "POST",
    headers: requestHeaders,
    body: payload,
  });
  return handler(req, { params: Promise.resolve({}) });
}

function get(
  handler: (req: Request, route: { params: Promise<Record<string, never>> }) => Promise<Response>,
  path: string,
  token?: string
) {
  const headers = new Headers();
  if (token) headers.set("authorization", `Bearer ${token}`);
  const req = new NextRequest(`https://www.taylslate.com${path}`, { headers });
  return handler(req, { params: Promise.resolve({}) });
}

function getById(
  handler: (req: Request, route: { params: Promise<{ id: string }> }) => Promise<Response>,
  path: string,
  token: string | undefined,
  id: string
) {
  const headers = new Headers();
  if (token) headers.set("authorization", `Bearer ${token}`);
  const req = new NextRequest(`https://www.taylslate.com${path}`, { headers });
  return handler(req, { params: Promise.resolve({ id }) });
}

async function keyFor(brandId: string, scopes: string[]) {
  bridge.keys!.profiles.push({ id: brandId });
  const created = await createKey({ brandId, scopes });
  return created.secret;
}

beforeEach(() => {
  bridge.keys = createMemoryAdmin();
  bridge.data = createWriteAdmin();
  bridge.recordEvent.mockClear();
  bridge.data.rows("shows").push(
    { id: SHOW_PUBLIC, is_discoverable: true },
    { id: SHOW_OWNED, is_discoverable: false },
    { id: SHOW_HIDDEN, is_discoverable: false }
  );
  bridge.data.rows("deals").push({
    id: "cccccccc-cccc-4ccc-8ccc-ccccccccccc1",
    show_id: SHOW_OWNED,
    brand_id: BRAND,
  });
  bridge.data.rows("brand_profiles").push({ id: PROFILE, user_id: BRAND });
});

afterEach(() => {
  bridge.keys = null;
  bridge.data = null;
});

describe("POST /api/v1 writes", () => {
  it("returns 202, replays the original action, and rejects a payload mismatch", async () => {
    const secret = await keyFor(BRAND, ["write:campaigns"]);
    const created = await post(createCampaign, "/api/v1/campaigns", secret, campaignBody(), {
      "idempotency-key": "campaign-key",
    });
    expect(created.status).toBe(202);
    expect(created.headers.get("cache-control")).toBe("no-store");
    const createdBody = await created.json();
    expect(createdBody).toEqual({ action_id: createdBody.action_id, status: "pending" });

    const replay = await post(createCampaign, "/api/v1/campaigns", secret, campaignBody(), {
      "idempotency-key": "campaign-key",
    });
    expect(replay.status).toBe(200);
    expect(await replay.json()).toEqual(createdBody);

    const clash = await post(createCampaign, "/api/v1/campaigns", secret, campaignBody(30000), {
      "idempotency-key": "campaign-key",
    });
    expect(clash.status).toBe(409);
    expect(bridge.data!.rows("api_write_actions")).toHaveLength(1);
    expect(bridge.data!.mutations.map((row) => row.table)).toEqual(["api_write_actions"]);
  });

  it("gives a read-only key 403 and an untied key 401", async () => {
    const reader = await keyFor(BRAND, ["read"]);
    const denied = await post(createCampaign, "/api/v1/campaigns", reader, campaignBody(), {
      "idempotency-key": "read-only",
    });
    expect(denied.status).toBe(403);
    expect(await denied.json()).toEqual({ error: "API key lacks the required scope." });

    const untied = await createKey({ brandId: UNTIED, scopes: ["write:campaigns"] });
    const rejected = await post(createCampaign, "/api/v1/campaigns", untied.secret, campaignBody(), {
      "idempotency-key": "untied",
    });
    expect(rejected.status).toBe(401);
    expect(await rejected.json()).toEqual({ error: "API key is not tied to a user." });
    expect(bridge.keys!.keys.find((row) => row.brand_id === UNTIED)?.last_used_at).toBeNull();
    expect(bridge.data!.rows("api_write_actions")).toHaveLength(0);
  });

  it("returns 413 over 64 KB, 415 for a non-JSON body, and 422 for an invalid campaign", async () => {
    const secret = await keyFor(BRAND, ["write:campaigns"]);
    const huge = await post(
      createCampaign,
      "/api/v1/campaigns",
      secret,
      { note: "x".repeat(API_WRITE_MAX_BODY_BYTES) },
      { "idempotency-key": "too-big" }
    );
    expect(huge.status).toBe(413);

    const text = await post(createCampaign, "/api/v1/campaigns", secret, "hello", {
      "content-type": "text/plain",
      "idempotency-key": "not-json",
    });
    expect(text.status).toBe(415);

    const invalid = await post(
      createCampaign,
      "/api/v1/campaigns",
      secret,
      campaignBody(100),
      { "idempotency-key": "bad-budget" }
    );
    expect(invalid.status).toBe(422);
    expect(bridge.data!.rows("api_write_actions")).toHaveLength(0);
  });

  it("returns 404 for a hidden unowned show and 202 for a visible one", async () => {
    const secret = await keyFor(BRAND, ["write:outreach"]);
    const hidden = await post(createOutreach, "/api/v1/outreach", secret, draftBody(SHOW_HIDDEN), {
      "idempotency-key": "hidden-show",
    });
    expect(hidden.status).toBe(404);
    const visible = await post(createOutreach, "/api/v1/outreach", secret, draftBody(SHOW_PUBLIC), {
      "idempotency-key": "public-show",
    });
    expect(visible.status).toBe(202);
    const owned = await post(createOutreach, "/api/v1/outreach", secret, draftBody(SHOW_OWNED), {
      "idempotency-key": "owned-show",
    });
    expect(owned.status).toBe(202);
    expect(bridge.data!.mutations.every((row) => row.table === "api_write_actions")).toBe(true);
    expect(bridge.data!.rows("shows")).toHaveLength(3);
    expect(bridge.data!.rows("deals")).toHaveLength(1);
  });

  it("hides an action from another brand", async () => {
    const writer = await keyFor(BRAND, ["write:campaigns", "read"]);
    const other = await keyFor(OTHER, ["read"]);
    const created = await post(createCampaign, "/api/v1/campaigns", writer, campaignBody(), {
      "idempotency-key": "brand-a",
    });
    const body = await created.json();
    const foreign = await getById(getAction, `/api/v1/actions/${body.action_id}`, other, body.action_id);
    expect(foreign.status).toBe(404);
    const own = await getById(getAction, `/api/v1/actions/${body.action_id}`, writer, body.action_id);
    expect(own.status).toBe(200);
    expect((await own.json()).data.id).toBe(body.action_id);

    const page = await get(listActions, "/api/v1/actions?limit=1", other);
    expect(page.status).toBe(200);
    expect(await page.json()).toEqual({ data: [], next_cursor: null });

    const listed = await get(listActions, "/api/v1/actions", writer);
    const listedBody = await listed.json();
    expect(listedBody.data).toHaveLength(1);
    expect(listedBody.data[0].kind).toBe("campaign.create");
  });

  it("leaves GET /api/v1/campaigns on the read scope", async () => {
    const secret = await keyFor(BRAND, ["read"]);
    const res = await get(listCampaigns, "/api/v1/campaigns", secret);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: [], next_cursor: null });
    expect(bridge.data!.mutations).toEqual([]);
  });
});
interface Mutation {
  table: string;
  op: "insert" | "update" | "delete";
}

function createWriteAdmin() {
  const tables = new Map<string, Record<string, unknown>[]>();
  const mutations: Mutation[] = [];
  let tick = Date.parse("2026-10-21T12:00:00.000Z");
  let conflictOnce = false;

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
      op: "select" as "select" | "insert" | "update" | "delete",
      filters: [] as { column: string; value: unknown }[],
      ors: [] as string[],
      orders: [] as { column: string; ascending: boolean }[],
      max: null as number | null,
      columns: null as string | null,
      insertRow: null as Record<string, unknown> | null,
      patch: null as Record<string, unknown> | null,
    };

    function matched(): Record<string, unknown>[] {
      return rows(table).filter((row) => {
        for (const filter of state.filters) {
          if (row[filter.column] !== filter.value) return false;
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

    function materialize(input: Record<string, unknown>): Record<string, unknown> {
      tick += 1000;
      return {
        decided_by: null,
        decided_at: null,
        status: "pending",
        ...input,
        id: randomUUID(),
        created_at: new Date(tick).toISOString(),
      };
    }

    function execute(): { data: Record<string, unknown>[] | null; error: { code: string; message: string } | null } {
      if (state.op === "insert") {
        mutations.push({ table, op: "insert" });
        const input = { ...(state.insertRow ?? {}) };
        const exists = rows(table).some(
          (row) =>
            row.brand_id === input.brand_id && row.idempotency_key === input.idempotency_key
        );
        if (table === "api_write_actions" && (exists || conflictOnce)) {
          conflictOnce = false;
          if (!exists) rows(table).push(materialize(input));
          return { data: null, error: { code: "23505", message: "duplicate" } };
        }
        const created = table === "api_write_actions" ? materialize(input) : { id: randomUUID(), ...input };
        rows(table).push(created);
        return { data: [project(created)], error: null };
      }
      if (state.op === "update") {
        mutations.push({ table, op: "update" });
        for (const row of matched()) Object.assign(row, state.patch);
      }
      if (state.op === "delete") {
        mutations.push({ table, op: "delete" });
        const drop = new Set(matched());
        tables.set(
          table,
          rows(table).filter((row) => !drop.has(row))
        );
      }
      let list = matched();
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
      insert(row: Record<string, unknown>) {
        state.op = "insert";
        state.insertRow = row;
        return builder;
      },
      update(patch: Record<string, unknown>) {
        state.op = "update";
        state.patch = patch;
        return builder;
      },
      delete() {
        state.op = "delete";
        return builder;
      },
      eq(column: string, value: unknown) {
        state.filters.push({ column, value });
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
        if (result.error) return Promise.resolve({ data: null, error: result.error });
        const data = result.data ?? [];
        if (data.length > 1) {
          return Promise.resolve({ data: null, error: { code: "PGRST116", message: "multiple" } });
        }
        return Promise.resolve({ data: data[0] ?? null, error: null });
      },
      single() {
        const result = execute();
        if (result.error) return Promise.resolve({ data: null, error: result.error });
        if (result.data?.length !== 1) {
          return Promise.resolve({ data: null, error: { code: "PGRST116", message: "expected one" } });
        }
        return Promise.resolve({ data: result.data[0], error: null });
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

  return {
    mutations,
    rows,
    from,
    armConflict() {
      conflictOnce = true;
    },
  };
}

function orMatch(row: Record<string, unknown>, expression: string): boolean {
  return splitTopLevel(expression).some((part) => matchesTerm(row, parseTerm(part.trim())));
}

function matchesTerm(row: Record<string, unknown>, term: Term): boolean {
  if (term.kind === "never") return false;
  if (term.kind === "and") return term.terms.every((child) => matchesTerm(row, child));
  if (term.kind === "or") return term.terms.some((child) => matchesTerm(row, child));
  const left = row[term.column];
  if (term.op === "in") {
    return inValues(term.value).some((item) => valuesEqual(left, item));
  }
  if (term.op === "eq") return valuesEqual(left, term.value);
  const cmp = compare(left, term.value);
  if (term.op === "lt") return cmp < 0;
  if (term.op === "gt") return cmp > 0;
  if (term.op === "lte") return cmp <= 0;
  if (term.op === "gte") return cmp >= 0;
  return false;
}

function valuesEqual(left: unknown, right: string): boolean {
  if (typeof left === "boolean" || typeof left === "number") return String(left) === right;
  if (left == null) return right === "null";
  return String(left) === right;
}

function compare(left: unknown, right: string): number {
  const a = left == null ? "" : String(left);
  if (a < right) return -1;
  if (a > right) return 1;
  return 0;
}

function inValues(raw: string): string[] {
  const inner = raw.startsWith("(") && raw.endsWith(")") ? raw.slice(1, -1) : raw;
  if (inner.trim() === "") return [];
  return inner.split(",").map((part) => part.trim()).filter((part) => part.length > 0);
}

type Term =
  | { kind: "cmp"; column: string; op: string; value: string }
  | { kind: "and"; terms: Term[] }
  | { kind: "or"; terms: Term[] }
  | { kind: "never" };

function parseTerm(part: string): Term {
  const trimmed = part.trim();
  if (trimmed.startsWith("and(") && trimmed.endsWith(")")) {
    return { kind: "and", terms: splitTopLevel(trimmed.slice(4, -1)).map(parseTerm) };
  }
  const match = /^([a-z_][a-z0-9_]*)\.(eq|lt|gt|lte|gte|in)\.(.*)$/i.exec(trimmed);
  if (!match) return { kind: "never" };
  let raw = match[3];
  if (raw.startsWith('"') && raw.endsWith('"') && raw.length >= 2) raw = raw.slice(1, -1);
  return { kind: "cmp", column: match[1], op: match[2].toLowerCase(), value: raw };
}

function splitTopLevel(input: string): string[] {
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
    if (!quote && char === "(") {
      depth += 1;
      current += char;
      continue;
    }
    if (!quote && char === ")") {
      depth -= 1;
      current += char;
      continue;
    }
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
