import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const BRAND = "11111111-1111-4111-8111-111111111111";
const ACTION = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const KEY = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1";

const { getAuthenticatedUser, getShow, tables } = vi.hoisted(() => ({
  getAuthenticatedUser: vi.fn(),
  getShow: vi.fn(),
  tables: {
    profiles: [] as Record<string, unknown>[],
    api_write_actions: [] as Record<string, unknown>[],
    api_keys: [] as Record<string, unknown>[],
  },
}));

vi.mock("@/lib/data/queries", () => ({
  getAuthenticatedUser: (...args: unknown[]) => getAuthenticatedUser(...args),
  createCampaign: vi.fn(),
}));
vi.mock("@/lib/api/v1/reads", () => ({
  getShow: (...args: unknown[]) => getShow(...args),
}));
vi.mock("@/lib/data/events", () => ({ logEvent: vi.fn() }));
vi.mock("@/lib/data/reasoning-log", () => ({ getCampaignPatternById: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: { from: (table: string) => query(table) },
}));

import { GET } from "./route";

function query(table: string) {
  const filters: Array<(row: Record<string, unknown>) => boolean> = [];
  let patch: Record<string, unknown> | null = null;
  const source =
    table === "profiles"
      ? tables.profiles
      : table === "api_keys"
        ? tables.api_keys
        : tables.api_write_actions;
  const api = {
    select() {
      return api;
    },
    update(next: Record<string, unknown>) {
      patch = next;
      return api;
    },
    eq(column: string, value: unknown) {
      filters.push((row) => row[column] === value);
      return api;
    },
    gte(column: string, value: unknown) {
      filters.push((row) => String(row[column] ?? "") >= String(value));
      return api;
    },
    lt(column: string, value: unknown) {
      filters.push((row) => String(row[column] ?? "") < String(value));
      return api;
    },
    is(column: string, value: unknown) {
      filters.push((row) => (value === null ? row[column] == null : row[column] === value));
      return api;
    },
    in(column: string, values: unknown[]) {
      filters.push((row) => values.includes(row[column]));
      return api;
    },
    or() {
      return api;
    },
    order() {
      return api;
    },
    limit() {
      return api;
    },
    maybeSingle() {
      return Promise.resolve().then(() => finish(true));
    },
    then(onFulfilled: (value: unknown) => unknown) {
      return Promise.resolve().then(() => onFulfilled(finish(false)));
    },
  };
  function finish(one: boolean) {
    const found = source.filter((row) => filters.every((filter) => filter(row)));
    if (patch) for (const row of found) Object.assign(row, patch);
    if (one) return { data: found[0] ? { ...found[0] } : null, error: null };
    return { data: found.map((row) => ({ ...row })), error: null };
  }
  return api;
}

function request(path: string, body?: unknown, origin = "http://localhost") {
  return new NextRequest(`http://localhost${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { origin, host: "localhost", "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

beforeEach(() => {
  getAuthenticatedUser.mockReset();
  getShow.mockReset();
  getAuthenticatedUser.mockResolvedValue({ id: BRAND, email: "brand@example.com" });
  getShow.mockResolvedValue({ name: "Visible Show" });
  tables.profiles = [{ id: BRAND, role: "brand" }];
  tables.api_keys = [
    {
      id: KEY,
      brand_id: BRAND,
      name: "Planner",
      prefix: "0123456789abcdef",
      key_hash: "key-hash-secret",
    },
  ];
  tables.api_write_actions = [
    {
      id: ACTION,
      brand_id: BRAND,
      api_key_id: KEY,
      kind: "outreach.draft",
      status: "pending",
      created_at: new Date().toISOString(),
      decided_at: null,
      decision_note: null,
      executed_at: null,
      result_campaign_id: null,
      execution_error: null,
      execution_started_at: null,
      payload_hash: "payload-hash-secret",
      idempotency_key: "idem-secret",
      payload: {
        show_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1",
        subject: "Hello",
        body: "We think this is a strong fit for the audience and would like to start with three reads.",
      },
    },
  ];
});

describe("GET /api/settings/agent-actions", () => {
  it("returns 401 without a session", async () => {
    getAuthenticatedUser.mockResolvedValue(null);
    const response = await GET(request("/api/settings/agent-actions"));
    expect(response.status).toBe(401);
  });

  it("returns 403 for a show and an agent", async () => {
    tables.profiles = [{ id: BRAND, role: "show" }];
    expect((await GET(request("/api/settings/agent-actions"))).status).toBe(403);
    tables.profiles = [{ id: BRAND, role: "agent" }];
    expect((await GET(request("/api/settings/agent-actions"))).status).toBe(403);
  });

  it("does not return payload_hash, key_hash, or idempotency_key", async () => {
    const response = await GET(request("/api/settings/agent-actions"));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(jsonKeys(body).has("payload_hash")).toBe(false);
    expect(jsonKeys(body).has("key_hash")).toBe(false);
    expect(jsonKeys(body).has("idempotency_key")).toBe(false);
    expect(JSON.stringify(body)).not.toMatch(/payload-hash-secret|key-hash-secret|idem-secret/);
  });
});

function jsonKeys(value: unknown, into = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) jsonKeys(item, into);
    return into;
  }
  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      into.add(key);
      jsonKeys(child, into);
    }
  }
  return into;
}
