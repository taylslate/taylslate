import { beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import type { MemoryAdmin } from "@/lib/api/memory-admin";

const bridge = vi.hoisted(() => ({
  keys: null as MemoryAdmin | null,
  actions: null as { from: () => unknown } | null,
  recordEvent: vi.fn(async () => undefined),
}));

vi.mock("@/lib/supabase/admin", () => {
  function emptyBuilder() {
    const builder = {
      select() {
        return builder;
      },
      eq() {
        return builder;
      },
      order() {
        return builder;
      },
      limit() {
        return builder;
      },
      or() {
        return builder;
      },
      in() {
        return builder;
      },
      maybeSingle: async () => ({ data: null, error: null }),
      then(onFulfilled: (value: { data: unknown[]; error: null }) => unknown) {
        return Promise.resolve(onFulfilled({ data: [], error: null }));
      },
    };
    return builder;
  }

  return {
    supabaseAdmin: {
      from: (table: string) => {
        if (table === "api_keys" || table === "profiles") return bridge.keys!.from(table);
        if (table === "api_write_actions") return bridge.actions!.from();
        return emptyBuilder();
      },
      rpc: (name: string, args: { p_key_id: string; p_window_start: string }) =>
        bridge.keys!.rpc(name, args),
    },
  };
});

vi.mock("@/lib/data/event-log", () => ({
  recordEvent: () => bridge.recordEvent(),
}));

import { createMemoryAdmin } from "@/lib/api/memory-admin";
import { createKey, revokeKey } from "@/lib/api/keys";
import { GET as health } from "@/app/api/v1/health/route";
import { GET as listCampaigns, POST as createCampaign } from "@/app/api/v1/campaigns/route";
import { POST as mcp } from "@/app/api/v1/mcp/route";

const BRAND = "11111111-1111-4111-8111-111111111111";
const PLAN_DENIED = {
  error: "Your plan does not include API access.",
  code: "plan_no_api_access",
};

function createActionAdmin() {
  const rows: Record<string, unknown>[] = [];

  function from() {
    const state = {
      op: "select" as "select" | "insert",
      filters: [] as { column: string; value: unknown }[],
      columns: null as string | null,
      insertRow: null as Record<string, unknown> | null,
    };

    function project(row: Record<string, unknown>): Record<string, unknown> {
      if (!state.columns || state.columns.trim() === "*") return { ...row };
      const out: Record<string, unknown> = {};
      for (const column of state.columns.split(",").map((part) => part.trim())) {
        out[column] = row[column];
      }
      return out;
    }

    function matched() {
      return rows.filter((row) => state.filters.every((filter) => row[filter.column] === filter.value));
    }

    function execute() {
      if (state.op === "insert") {
        const created: Record<string, unknown> = {
          status: "pending",
          ...(state.insertRow ?? {}),
          id: randomUUID(),
          created_at: new Date().toISOString(),
        };
        rows.push(created);
        return { data: [project(created)], error: null as { code: string; message: string } | null };
      }
      return { data: matched().map(project), error: null as { code: string; message: string } | null };
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
      eq(column: string, value: unknown) {
        state.filters.push({ column, value });
        return builder;
      },
      order() {
        return builder;
      },
      limit() {
        return builder;
      },
      maybeSingle() {
        const result = execute();
        return Promise.resolve({ data: result.data[0] ?? null, error: result.error });
      },
      single() {
        const result = execute();
        if (result.data.length !== 1) {
          return Promise.resolve({ data: null, error: { code: "PGRST116", message: "expected one" } });
        }
        return Promise.resolve({ data: result.data[0], error: null });
      },
    };
    return builder;
  }

  return { from };
}

function campaignBody() {
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
    budget_total: 25000,
    flight: { mode: "preset", preset: "next_30_days" },
  };
}

function bearer(token: string) {
  return { authorization: `Bearer ${token}` };
}

function callHealth(token: string) {
  return health(
    new NextRequest("https://www.taylslate.com/api/v1/health", { headers: bearer(token) })
  );
}

function callRead(token: string) {
  return listCampaigns(
    new NextRequest("https://www.taylslate.com/api/v1/campaigns", { headers: bearer(token) }),
    { params: Promise.resolve({}) }
  );
}

function callWrite(token: string) {
  return createCampaign(
    new NextRequest("https://www.taylslate.com/api/v1/campaigns", {
      method: "POST",
      headers: {
        ...bearer(token),
        "content-type": "application/json",
        "idempotency-key": "campaign-key",
      },
      body: JSON.stringify(campaignBody()),
    }),
    { params: Promise.resolve({}) }
  );
}

function callMcp(token: string) {
  const message = {
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: {
      name: "list_campaigns",
      arguments: {},
      _meta: { "io.modelcontextprotocol/protocolVersion": "2026-07-28" },
    },
  };
  return mcp(
    new NextRequest("https://www.taylslate.com/api/v1/mcp", {
      method: "POST",
      headers: {
        ...bearer(token),
        "content-type": "application/json",
        "mcp-protocol-version": "2026-07-28",
        "mcp-method": "tools/call",
        "mcp-name": "list_campaigns",
      },
      body: JSON.stringify(message),
    })
  );
}

beforeEach(() => {
  bridge.keys = createMemoryAdmin();
  bridge.actions = createActionAdmin();
  bridge.recordEvent.mockClear();
});

describe("plan gate on v1 and MCP", () => {
  it("rejects a downgraded key and allows it again on operator", async () => {
    const profile = { id: BRAND, role: "brand", plan: "operator" };
    bridge.keys!.profiles.push(profile);
    const created = await createKey({
      brandId: BRAND,
      scopes: ["read", "write:campaigns"],
    });
    profile.plan = "starter";

    const denied = [
      await callHealth(created.secret),
      await callRead(created.secret),
      await callWrite(created.secret),
      await callMcp(created.secret),
    ];
    for (const res of denied) {
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual(PLAN_DENIED);
    }
    expect(denied[3].headers.get("www-authenticate")).toBeNull();
    expect(bridge.keys!.keys[0].last_used_at).toBeNull();
    expect(bridge.recordEvent).not.toHaveBeenCalled();

    profile.plan = "operator";
    const allowedHealth = await callHealth(created.secret);
    expect(allowedHealth.status).toBe(200);
    expect(await allowedHealth.json()).toEqual({
      brandId: BRAND,
      scopes: ["read", "write:campaigns"],
    });

    const allowedRead = await callRead(created.secret);
    expect(allowedRead.status).toBe(200);
    expect(await allowedRead.json()).toEqual({ data: [], next_cursor: null });

    const allowedMcp = await callMcp(created.secret);
    expect(allowedMcp.status).toBe(200);
    const mcpBody = await allowedMcp.json();
    expect(mcpBody.result.isError).toBe(false);
    expect(mcpBody.result.structuredContent.data).toEqual([]);

    const allowedWrite = await callWrite(created.secret);
    expect(allowedWrite.status).toBe(202);
    const replay = await callWrite(created.secret);
    expect(replay.status).toBe(200);

    expect(bridge.keys!.keys[0].last_used_at).toEqual(expect.any(String));
    expect(bridge.recordEvent).toHaveBeenCalled();
    expect(bridge.recordEvent.mock.calls.length).toBeGreaterThan(0);
  });

  it("returns 401 with no code for a revoked key", async () => {
    bridge.keys!.profiles.push({ id: BRAND, role: "brand", plan: "starter" });
    const created = await createKey({ brandId: BRAND, scopes: ["read"] });
    await revokeKey(created.id, BRAND);
    const res = await callHealth(created.secret);
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body).toEqual({ error: "API key is revoked." });
    expect(body).not.toHaveProperty("code");
  });
});
