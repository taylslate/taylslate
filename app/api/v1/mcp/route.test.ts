import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { MemoryAdmin } from "@/lib/api/memory-admin";
import type { DomainAdmin } from "../test-admin";

const bridge = vi.hoisted(() => ({
  keys: null as MemoryAdmin | null,
  data: null as DomainAdmin | null,
  actions: null as {
    rows: Record<string, unknown>[];
    mutations: { table: string; op: string }[];
    from: () => unknown;
  } | null,
  recordEvent: vi.fn(async () => undefined),
  oauthQueries: [] as string[],
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient: vi.fn(() => ({
    auth: { getUser: vi.fn(async () => ({ data: { user: null } })) },
  })),
}));

vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: {
    from: (table: string) => {
      if (table.startsWith("mcp_oauth_")) bridge.oauthQueries.push(table);
      if (table === "api_keys" || table === "profiles") return bridge.keys!.from(table);
      if (table === "api_write_actions") return bridge.actions!.from();
      return bridge.data!.from(table);
    },
    rpc: (name: string, args: { p_key_id: string; p_window_start: string }) => bridge.keys!.rpc(name, args),
  },
}));

vi.mock("@/lib/data/event-log", () => ({
  recordEvent: () => bridge.recordEvent(),
}));

import { createMemoryAdmin } from "@/lib/api/memory-admin";
import { createDomainAdmin } from "../test-admin";
import { createKey, revokeKey } from "@/lib/api/keys";
import { API_WRITE_MAX_BODY_BYTES } from "@/lib/api/v1/handler";
import { _setApiRateClockForTests } from "@/lib/api/rate-limit";
import { DELETE, GET, PATCH, POST, PUT } from "./route";

const BRAND = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const UNTIED = "99999999-9999-4999-8999-999999999999";
const SHOW_PUBLIC = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const SHOW_HIDDEN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3";
const CAMP = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1";
const CAMP_OTHER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb8";
const FIXED_NOW = new Date("2026-10-21T23:18:10.000Z");

function createActionAdmin() {
  const rows: Record<string, unknown>[] = [];
  const mutations: { table: string; op: string }[] = [];
  let tick = Date.parse("2026-10-21T12:00:00.000Z");

  function from() {
    const state = {
      op: "select" as "select" | "insert" | "update" | "delete",
      filters: [] as { column: string; value: unknown }[],
      columns: null as string | null,
      insertRow: null as Record<string, unknown> | null,
      patch: null as Record<string, unknown> | null,
      orders: [] as { column: string; ascending: boolean }[],
      max: null as number | null,
    };

    function project(row: Record<string, unknown>): Record<string, unknown> {
      if (!state.columns || state.columns.trim() === "*") return { ...row };
      const out: Record<string, unknown> = {};
      for (const column of state.columns.split(",").map((part) => part.trim())) out[column] = row[column];
      return out;
    }

    function matched() {
      return rows.filter((row) => state.filters.every((filter) => row[filter.column] === filter.value));
    }

    function execute() {
      if (state.op === "insert") {
        mutations.push({ table: "api_write_actions", op: "insert" });
        tick += 1000;
        const created: Record<string, unknown> = {
          decided_by: null,
          decided_at: null,
          status: "pending",
          ...(state.insertRow ?? {}),
          id: randomUUID(),
          created_at: new Date(tick).toISOString(),
        };
        rows.push(created);
        return { data: [project(created)], error: null as { code: string; message: string } | null };
      }
      if (state.op === "update") {
        mutations.push({ table: "api_write_actions", op: "update" });
        for (const row of matched()) Object.assign(row, state.patch);
      }
      if (state.op === "delete") mutations.push({ table: "api_write_actions", op: "delete" });
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
      return { data: list.map(project), error: null as { code: string; message: string } | null };
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
      or() {
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
        return Promise.resolve({ data: result.data?.[0] ?? null, error: result.error });
      },
      single() {
        const result = execute();
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

  return { rows, mutations, from };
}

function seqId(prefix: string, n: number): string {
  return `${prefix}-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
}

function campaignBody(budget = 25000) {
  return {
    idempotency_key: "campaign-key",
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

async function keyFor(brandId: string, scopes: string[]) {
  if (!bridge.keys!.profiles.some((row) => row.id === brandId)) {
    bridge.keys!.profiles.push({ id: brandId, role: "brand", plan: "operator" });
  }
  const created = await createKey({ brandId, scopes });
  return created.secret;
}

function rpc(
  token: string | undefined,
  message: unknown,
  headers: Record<string, string> = {},
  raw?: string
) {
  const requestHeaders = new Headers(headers);
  if (token) requestHeaders.set("authorization", `Bearer ${token}`);
  if (!requestHeaders.has("content-type")) requestHeaders.set("content-type", "application/json");
  const body = raw ?? (typeof message === "string" ? message : JSON.stringify(message));
  return POST(
    new NextRequest("https://www.taylslate.com/api/v1/mcp", {
      method: "POST",
      headers: requestHeaders,
      body,
    })
  );
}

function legacy(version: string, method: string, params: Record<string, unknown> = {}, id: number | string = 1) {
  return {
    message: { jsonrpc: "2.0", id, method, params },
    headers: { "mcp-protocol-version": version },
  };
}

function modern(method: string, params: Record<string, unknown> = {}, name?: string, id: number | string = 1) {
  const headers: Record<string, string> = {
    "mcp-protocol-version": "2026-07-28",
    "mcp-method": method,
  };
  if (name) headers["mcp-name"] = name;
  return {
    message: {
      jsonrpc: "2.0",
      id,
      method,
      params: {
        ...params,
        _meta: { "io.modelcontextprotocol/protocolVersion": "2026-07-28" },
      },
    },
    headers,
  };
}

beforeEach(() => {
  bridge.keys = createMemoryAdmin();
  bridge.data = createDomainAdmin();
  bridge.actions = createActionAdmin();
  bridge.recordEvent.mockClear();
  bridge.oauthQueries = [];
  _setApiRateClockForTests(() => FIXED_NOW);
  bridge.data.tables.shows.push(
    { id: SHOW_PUBLIC, name: "Public", is_discoverable: true, created_at: "2026-03-01T00:00:00.000Z" },
    { id: SHOW_HIDDEN, name: "Hidden", is_discoverable: false, created_at: "2026-03-02T00:00:00.000Z" }
  );
  bridge.data.tables.campaigns.push(
    {
      id: CAMP,
      user_id: BRAND,
      name: "Owned",
      status: "draft",
      budget_total: 25000,
      platforms: ["podcast"],
      brief: {},
      created_at: "2026-03-01T00:00:00.000Z",
      updated_at: "2026-03-01T00:00:00.000Z",
    },
    {
      id: CAMP_OTHER,
      user_id: OTHER,
      name: "Theirs",
      status: "draft",
      budget_total: 9000,
      platforms: ["podcast"],
      brief: {},
      created_at: "2026-03-02T00:00:00.000Z",
      updated_at: "2026-03-02T00:00:00.000Z",
    }
  );
});

afterEach(() => {
  _setApiRateClockForTests(null);
});

describe("POST /api/v1/mcp", () => {
  it("returns 401 for a missing key, a bad token, a revoked key, and an untied key", async () => {
    const savedSite = process.env.NEXT_PUBLIC_SITE_URL;
    delete process.env.NEXT_PUBLIC_SITE_URL;
    const missing = await rpc(undefined, legacy("2025-11-25", "ping").message, legacy("2025-11-25", "ping").headers);
    if (savedSite === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
    else process.env.NEXT_PUBLIC_SITE_URL = savedSite;
    expect(missing.status).toBe(401);
    expect(missing.headers.get("www-authenticate")).toBe("Bearer");
    expect(missing.headers.get("cache-control")).toBe("no-store");
    expect(await missing.json()).toEqual({ error: "Missing or invalid API key." });

    const bad = await rpc("not-a-key", legacy("2025-11-25", "ping").message, legacy("2025-11-25", "ping").headers);
    expect(bad.status).toBe(401);
    expect(await bad.json()).toEqual({ error: "Missing or invalid API key." });

    bridge.keys!.profiles.push({ id: BRAND, role: "brand", plan: "operator" });
    const created = await createKey({ brandId: BRAND, scopes: ["read"] });
    await revokeKey(created.id, BRAND);
    const revoked = await rpc(created.secret, legacy("2025-11-25", "ping").message, legacy("2025-11-25", "ping").headers);
    expect(revoked.status).toBe(401);
    expect(await revoked.json()).toEqual({ error: "API key is revoked." });

    const untied = await createKey({ brandId: UNTIED, scopes: ["read"] });
    const rejected = await rpc(untied.secret, legacy("2025-11-25", "ping").message, legacy("2025-11-25", "ping").headers);
    expect(rejected.status).toBe(401);
    expect(await rejected.json()).toEqual({ error: "API key is not tied to a user." });
    expect(bridge.keys!.keys.find((row) => row.brand_id === UNTIED)?.last_used_at).toBeNull();
  });

  it("does not query an OAuth table for a ts_live_ key", async () => {
    const secret = await keyFor(BRAND, ["read"]);
    const response = await rpc(secret, legacy("2025-11-25", "ping").message, legacy("2025-11-25", "ping").headers);
    expect(response.status).toBe(200);
    expect(bridge.oauthQueries).toEqual([]);
  });

  it("returns 503 for a ts_oat_ token when the OAuth table is missing", async () => {
    const savedSite = process.env.NEXT_PUBLIC_SITE_URL;
    process.env.NEXT_PUBLIC_SITE_URL = "https://www.taylslate.com";
    try {
      const token = `ts_oat_${"ab".repeat(32)}`;
      const response = await rpc(token, legacy("2025-11-25", "ping").message, legacy("2025-11-25", "ping").headers);
      expect(response.status).toBe(503);
      const body = await response.json();
      expect(body).toEqual({ error: "API request failed." });
      expect(JSON.stringify(body)).not.toContain("secret-db-text");
      expect(JSON.stringify(body)).not.toContain("unexpected table");
      expect(bridge.oauthQueries).toContain("mcp_oauth_tokens");
    } finally {
      if (savedSite === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
      else process.env.NEXT_PUBLIC_SITE_URL = savedSite;
    }
  });

  it("advertises protected-resource metadata on 401 when the origin is configured", async () => {
    const savedSite = process.env.NEXT_PUBLIC_SITE_URL;
    process.env.NEXT_PUBLIC_SITE_URL = "https://www.taylslate.com";
    try {
      const missing = await rpc(undefined, legacy("2025-11-25", "ping").message, legacy("2025-11-25", "ping").headers);
      expect(missing.status).toBe(401);
      expect(missing.headers.get("www-authenticate")).toBe(
        'Bearer resource_metadata="https://www.taylslate.com/.well-known/oauth-protected-resource/api/v1/mcp"'
      );
      const presented = await rpc("not-a-key", legacy("2025-11-25", "ping").message, legacy("2025-11-25", "ping").headers);
      expect(presented.headers.get("www-authenticate")).toBe(
        'Bearer error="invalid_token", resource_metadata="https://www.taylslate.com/.well-known/oauth-protected-resource/api/v1/mcp"'
      );
    } finally {
      if (savedSite === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
      else process.env.NEXT_PUBLIC_SITE_URL = savedSite;
    }
  });

  it("returns 403 for a foreign Origin and allows a missing Origin", async () => {
    const secret = await keyFor(BRAND, ["read"]);
    const foreign = await rpc(secret, legacy("2025-11-25", "ping").message, {
      ...legacy("2025-11-25", "ping").headers,
      origin: "https://evil.example",
    });
    expect(foreign.status).toBe(403);
    expect(foreign.headers.get("cache-control")).toBe("no-store");
    const body = await foreign.json();
    expect(body.error.code).toBe(-32600);
    expect(body.id).toBeUndefined();
    expect(bridge.recordEvent).not.toHaveBeenCalled();

    const open = await rpc(secret, legacy("2025-11-25", "ping").message, legacy("2025-11-25", "ping").headers);
    expect(open.status).toBe(200);
  });

  it("returns 429 with Retry-After after 60 calls in the same minute", async () => {
    const secret = await keyFor(BRAND, ["read"]);
    const call = legacy("2025-11-25", "ping");
    for (let n = 0; n < 60; n += 1) {
      const ok = await rpc(secret, call.message, call.headers);
      expect(ok.status).toBe(200);
    }
    const limited = await rpc(secret, call.message, call.headers);
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBe("50");
    expect(await limited.json()).toEqual({ error: "Rate limit exceeded." });
  });

  it("returns 413, 415, and 405", async () => {
    const secret = await keyFor(BRAND, ["read"]);
    const huge = await rpc(
      secret,
      null,
      { "content-type": "application/json" },
      JSON.stringify({ note: "x".repeat(API_WRITE_MAX_BODY_BYTES) })
    );
    expect(huge.status).toBe(413);
    expect(await huge.json()).toEqual({ error: "Request body is too large." });

    const text = await rpc(secret, null, { "content-type": "text/plain" }, "hello");
    expect(text.status).toBe(415);
    expect(await text.json()).toEqual({ error: "Request body must be JSON." });

    for (const handler of [GET, PUT, PATCH, DELETE]) {
      const denied = handler();
      expect(denied.status).toBe(405);
      expect(denied.headers.get("allow")).toBe("POST");
    }
  });

  it("returns 400 for a batch, 202 for a notification, and 400 for an unsupported version", async () => {
    const secret = await keyFor(BRAND, ["read"]);
    const batch = await rpc(secret, [legacy("2025-11-25", "ping").message]);
    expect(batch.status).toBe(400);
    expect(batch.headers.get("content-type")).toContain("application/json");
    expect(await batch.json()).toMatchObject({ error: { code: -32600 } });

    const note = await rpc(
      secret,
      { jsonrpc: "2.0", method: "notifications/initialized" },
      { "mcp-protocol-version": "2025-11-25" }
    );
    expect(note.status).toBe(202);
    expect(note.headers.get("cache-control")).toBe("no-store");
    expect(await note.text()).toBe("");

    const old = await rpc(
      secret,
      {
        jsonrpc: "2.0",
        id: 9,
        method: "ping",
        params: { _meta: { "io.modelcontextprotocol/protocolVersion": "1900-01-01" } },
      },
      { "mcp-protocol-version": "1900-01-01", "mcp-method": "ping" }
    );
    expect(old.status).toBe(400);
    expect(await old.json()).toEqual({
      jsonrpc: "2.0",
      id: 9,
      error: {
        code: -32022,
        message: "Unsupported protocol version",
        data: {
          supported: ["2026-07-28", "2025-11-25", "2025-06-18"],
          requested: "1900-01-01",
        },
      },
    });
  });

  it("initializes 2025 versions and lists tools on each version, filtered by scope", async () => {
    const reader = await keyFor(BRAND, ["read"]);
    const writer = await keyFor(OTHER, ["write:campaigns"]);
    for (const version of ["2025-11-25", "2025-06-18"]) {
      const opened = legacy(version, "initialize", {
        protocolVersion: version,
        capabilities: {},
        clientInfo: { name: "test", version: "0" },
      });
      const init = await rpc(reader, opened.message, opened.headers);
      expect(init.status).toBe(200);
      const initBody = await init.json();
      expect(initBody.result.protocolVersion).toBe(version);
      expect(initBody.result.serverInfo.name).toBe("taylslate");
      expect(Object.keys(initBody.result.capabilities)).toEqual(["tools"]);

      const listed = legacy(version, "tools/list");
      const tools = await rpc(reader, listed.message, listed.headers);
      const names = (await tools.json()).result.tools.map((tool: { name: string }) => tool.name);
      expect(names).toContain("list_shows");
      expect(names).not.toContain("propose_campaign");
      expect(names).not.toContain("propose_outreach");
    }

    const current = modern("tools/list");
    const modernList = await rpc(reader, current.message, current.headers);
    const modernBody = await modernList.json();
    expect(modernBody.result.resultType).toBe("complete");
    expect(modernBody.result.tools.map((tool: { name: string }) => tool.name)).not.toContain("propose_outreach");

    const writerList = modern("tools/list");
    const writerBody = await (await rpc(writer, writerList.message, writerList.headers)).json();
    expect(writerBody.result.tools.map((tool: { name: string }) => tool.name)).toEqual(["propose_campaign"]);

    const discovered = modern("server/discover");
    const discover = await rpc(reader, discovered.message, discovered.headers);
    expect((await discover.json()).result.supportedVersions).toEqual([
      "2026-07-28",
      "2025-11-25",
      "2025-06-18",
    ]);
  });

  it("returns a tool scope error and hides another brand's campaign", async () => {
    const reader = await keyFor(BRAND, ["read"]);
    const call = modern("tools/call", { name: "propose_campaign", arguments: campaignBody() }, "propose_campaign");
    const denied = await rpc(reader, call.message, call.headers);
    expect(denied.status).toBe(200);
    const deniedBody = await denied.json();
    expect(deniedBody.result.isError).toBe(true);
    expect(deniedBody.result.structuredContent).toEqual({
      error: "API key lacks the required scope.",
      status: 403,
    });
    expect(bridge.actions!.rows).toHaveLength(0);

    const other = await keyFor(OTHER, ["read"]);
    const hidden = modern("tools/call", { name: "get_campaign", arguments: { id: CAMP } }, "get_campaign");
    const missing = await rpc(other, hidden.message, hidden.headers);
    expect(missing.status).toBe(200);
    expect((await missing.json()).result.structuredContent).toEqual({ error: "Not found.", status: 404 });
  });

  it("clamps limit at 100", async () => {
    const secret = await keyFor(BRAND, ["read"]);
    bridge.data!.tables.campaigns.length = 0;
    for (let n = 1; n <= 101; n += 1) {
      bridge.data!.tables.campaigns.push({
        id: seqId("c1000000", n),
        user_id: BRAND,
        name: `Campaign ${n}`,
        status: "draft",
        budget_total: n,
        platforms: ["podcast"],
        brief: {},
        created_at: new Date(Date.UTC(2026, 0, 1, 0, 0, n)).toISOString(),
        updated_at: new Date(Date.UTC(2026, 0, 1, 0, 0, n)).toISOString(),
      });
    }
    const call = modern(
      "tools/call",
      { name: "list_campaigns", arguments: { limit: 5000 } },
      "list_campaigns"
    );
    const res = await rpc(secret, call.message, call.headers);
    const body = await res.json();
    expect(body.result.isError).toBe(false);
    expect(body.result.structuredContent.data).toHaveLength(100);
    expect(body.result.structuredContent.next_cursor).toEqual(expect.any(String));
    expect(body.result.content[0].text).toBe(JSON.stringify(body.result.structuredContent));
  });

  it("replays a propose, conflicts on a changed payload, and inserts one action row", async () => {
    const secret = await keyFor(BRAND, ["write:campaigns", "read"]);
    const firstCall = modern(
      "tools/call",
      { name: "propose_campaign", arguments: campaignBody() },
      "propose_campaign"
    );
    const created = await rpc(secret, firstCall.message, firstCall.headers);
    expect(created.status).toBe(200);
    const createdBody = await created.json();
    expect(createdBody.result.structuredContent.replayed).toBe(false);
    expect(createdBody.result.structuredContent.status).toBe("pending");
    const actionId = createdBody.result.structuredContent.action_id;

    const replay = await rpc(secret, firstCall.message, firstCall.headers);
    expect((await replay.json()).result.structuredContent).toEqual({
      action_id: actionId,
      status: "pending",
      replayed: true,
    });

    const clash = modern(
      "tools/call",
      { name: "propose_campaign", arguments: campaignBody(30000) },
      "propose_campaign"
    );
    const conflict = await rpc(secret, clash.message, clash.headers);
    expect((await conflict.json()).result).toMatchObject({
      isError: true,
      structuredContent: {
        error: "Idempotency key was already used with a different payload.",
        status: 409,
      },
    });
    expect(bridge.actions!.rows).toHaveLength(1);
    expect(bridge.actions!.mutations).toEqual([{ table: "api_write_actions", op: "insert" }]);
    expect(bridge.data!.tables.campaigns).toHaveLength(2);
    expect(bridge.recordEvent).toHaveBeenCalledTimes(3);
  });

  it("does not insert an outreach draft for a hidden show, and does not log the body or the key", async () => {
    const secret = await keyFor(BRAND, ["write:outreach"]);
    const sentinel = "OUTREACH-BODY-SENTINEL-9f3a-do-not-log";
    const draft = {
      idempotency_key: "draft-key-1",
      show_id: SHOW_HIDDEN,
      subject: "A sponsorship for your show",
      body: `We think this show fits the audience. ${sentinel} Three reads to start the test.`,
    };
    const lines: string[] = [];
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((name) =>
      vi.spyOn(console, name).mockImplementation((...args: unknown[]) => {
        lines.push(args.map((arg) => (typeof arg === "string" ? arg : JSON.stringify(arg))).join(" "));
      })
    );
    try {
      const hidden = modern("tools/call", { name: "propose_outreach", arguments: draft }, "propose_outreach");
      const denied = await rpc(secret, hidden.message, hidden.headers);
      expect((await denied.json()).result.structuredContent.status).toBe(404);
      expect(bridge.actions!.rows).toHaveLength(0);

      const visible = modern(
        "tools/call",
        {
          name: "propose_outreach",
          arguments: { ...draft, show_id: SHOW_PUBLIC, idempotency_key: "draft-key-2" },
        },
        "propose_outreach"
      );
      const ok = await rpc(secret, visible.message, visible.headers);
      const okBody = await ok.json();
      expect(okBody.result.structuredContent).toMatchObject({ status: "pending", replayed: false });
      expect(bridge.actions!.rows).toHaveLength(1);
      expect(bridge.actions!.mutations).toEqual([{ table: "api_write_actions", op: "insert" }]);
      expect(bridge.data!.tables.shows).toHaveLength(2);
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
    const joined = lines.join("\n");
    expect(joined).not.toContain(secret);
    expect(joined).not.toContain(sentinel);
    expect(joined).not.toContain("A sponsorship for your show");
    expect(joined).not.toContain("Bearer");
    expect(lines.some((line) => /^\[mcp\] method=\S+ tool=\S+ outcome=\d+ elapsed_ms=\d+$/.test(line))).toBe(true);
  });
});
