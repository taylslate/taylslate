import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";

const bridge = vi.hoisted(() => ({
  admin: null as ReturnType<typeof createWriteAdmin> | null,
}));

vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: {
    from: (table: string) => bridge.admin!.from(table),
  },
}));

import { ApiReadError, ApiWriteError, type ApiWriteContext } from "@/lib/api/v1/handler";
import {
  getWriteAction,
  listWriteActions,
  recordCampaignCreate,
  recordOutreachDraft,
  validateCampaignCreate,
  validateOutreachDraft,
} from "@/lib/api/v1/writes";

const BRAND = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const KEY = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa9";
const PROFILE = "33333333-3333-4333-8333-333333333333";
const SHOW_PUBLIC = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const SHOW_OWNED = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";
const SHOW_HIDDEN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3";
const PATTERN = "dddddddd-dddd-4ddd-8ddd-ddddddddddd1";

function ctx(body: unknown, idempotencyKey = "campaign-1"): ApiWriteContext {
  return { brandId: BRAND, keyId: KEY, idempotencyKey, body };
}

function campaignBody(budget = 25000): Record<string, unknown> {
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

function draftBody(showId: string): Record<string, unknown> {
  return {
    show_id: showId,
    subject: "A sponsorship for your show",
    body: "We think this is a strong fit for the audience and would like to start with three reads.",
  };
}

beforeEach(() => {
  bridge.admin = createWriteAdmin();
});

afterEach(() => {
  bridge.admin = null;
});

describe("campaign.create validation", () => {
  it("accepts the brief fields a manual create accepts", () => {
    const payload = validateCampaignCreate(campaignBody());
    expect(payload.budget_total).toBe(25000);
    expect(payload.goals).toEqual(["test_channel"]);
    expect(payload.product?.brand_name).toBe("Sauna Box");
    expect(payload.flight).toEqual({ mode: "preset", preset: "next_30_days" });
  });

  it("accepts a reused pattern without a new product", () => {
    const payload = validateCampaignCreate({
      customer_context: { reused_from_pattern_id: PATTERN },
      goals: ["scale_winner", "direct_response"],
      budget_total: 20000,
      flight: { mode: "preset", preset: "asap" },
    });
    expect(payload.product).toBeUndefined();
    expect(payload.customer_context?.reused_from_pattern_id).toBe(PATTERN);
  });

  it("rejects a short budget, a bad goal, and an unknown field", () => {
    expect(() => validateCampaignCreate(campaignBody(4999))).toThrow(ApiWriteError);
    expect(() => validateCampaignCreate(campaignBody(4999))).toThrow(/at least \$5,000/);
    const goals = campaignBody();
    goals.goals = ["not-a-goal"];
    expect(() => validateCampaignCreate(goals)).toThrow(/campaign goals/);
    const extra = campaignBody();
    extra.platforms = ["podcast"];
    expect(() => validateCampaignCreate(extra)).toThrow(/Unknown field platforms/);
  });

  it("rejects a flight whose end is before its start", () => {
    const body = campaignBody();
    body.flight = { mode: "dates", start_date: "2026-12-02", end_date: "2026-12-01" };
    expect(() => validateCampaignCreate(body)).toThrow(/on or after the start date/);
  });
});

describe("outreach.draft validation", () => {
  it("caps subject and body length", () => {
    expect(() =>
      validateOutreachDraft({ ...draftBody(SHOW_PUBLIC), subject: "x".repeat(201) })
    ).toThrow(/subject is too long/);
    expect(() =>
      validateOutreachDraft({ ...draftBody(SHOW_PUBLIC), body: "too short" })
    ).toThrow(/body is too short/);
    expect(() =>
      validateOutreachDraft({ ...draftBody(SHOW_PUBLIC), body: "y".repeat(5001) })
    ).toThrow(/body is too long/);
    expect(() => validateOutreachDraft({ subject: "Hi", body: "x".repeat(30) })).toThrow(
      /show_id is required/
    );
  });

  it("returns 404 for a show id that is not a uuid", () => {
    try {
      validateOutreachDraft({ ...draftBody("discovered-1"), show_id: "discovered-1" });
      throw new Error("expected 404");
    } catch (err) {
      expect(err).toBeInstanceOf(ApiWriteError);
      expect((err as ApiWriteError).status).toBe(404);
    }
  });
});

describe("record pending actions", () => {
  it("inserts only api_write_actions and replays the same payload", async () => {
    const created = await recordCampaignCreate(ctx(campaignBody()));
    expect(created).toMatchObject({ status: "pending", replay: false });
    const again = await recordCampaignCreate(ctx(campaignBody()));
    expect(again).toEqual({ ...created, replay: true });
    expect(bridge.admin!.mutations).toEqual([
      { table: "api_write_actions", op: "insert" },
    ]);
    expect(bridge.admin!.rows("api_write_actions")).toHaveLength(1);
    expect(bridge.admin!.rows("campaigns")).toHaveLength(0);
  });

  it("returns 409 when the same key is reused with a different payload", async () => {
    await recordCampaignCreate(ctx(campaignBody(25000), "same"));
    await expect(recordCampaignCreate(ctx(campaignBody(26000), "same"))).rejects.toMatchObject({
      status: 409,
    });
    expect(bridge.admin!.rows("api_write_actions")).toHaveLength(1);
  });

  it("returns the original action when a concurrent insert wins the unique key", async () => {
    bridge.admin!.armConflict();
    const recorded = await recordCampaignCreate(ctx(campaignBody(), "race"));
    expect(recorded.replay).toBe(true);
    expect(recorded.status).toBe("pending");
    expect(bridge.admin!.rows("api_write_actions")).toHaveLength(1);
  });

  it("replays an already decided row instead of inserting another pending one", async () => {
    const created = await recordCampaignCreate(ctx(campaignBody(), "decided"));
    bridge.admin!.rows("api_write_actions")[0].status = "approved";
    const again = await recordCampaignCreate(ctx(campaignBody(), "decided"));
    expect(again).toEqual({ actionId: created.actionId, status: "approved", replay: true });
    expect(bridge.admin!.mutations.filter((row) => row.op === "insert")).toHaveLength(1);
  });

  it("does not write when outreach targets a hidden unowned show", async () => {
    bridge.admin!.rows("shows").push({ id: SHOW_HIDDEN, is_discoverable: false });
    await expect(recordOutreachDraft(ctx(draftBody(SHOW_HIDDEN), "hidden"))).rejects.toMatchObject({
      status: 404,
    });
    expect(bridge.admin!.mutations).toEqual([]);
  });

  it("records outreach for a discoverable show and for a show this brand owns", async () => {
    bridge.admin!.rows("shows").push(
      { id: SHOW_PUBLIC, is_discoverable: true },
      { id: SHOW_OWNED, is_discoverable: false }
    );
    bridge.admin!.rows("deals").push({
      id: "cccccccc-cccc-4ccc-8ccc-ccccccccccc1",
      show_id: SHOW_OWNED,
      brand_id: BRAND,
    });
    const visible = await recordOutreachDraft(ctx(draftBody(SHOW_PUBLIC), "public-show"));
    const owned = await recordOutreachDraft(ctx(draftBody(SHOW_OWNED), "owned-show"));
    expect(visible.replay).toBe(false);
    expect(owned.replay).toBe(false);
    expect(bridge.admin!.mutations).toEqual([
      { table: "api_write_actions", op: "insert" },
      { table: "api_write_actions", op: "insert" },
    ]);
  });

  it("treats a show owned through the brand profile as visible", async () => {
    bridge.admin!.rows("shows").push({ id: SHOW_OWNED, is_discoverable: false });
    bridge.admin!.rows("brand_profiles").push({ id: PROFILE, user_id: BRAND });
    bridge.admin!.rows("deals").push({
      id: "cccccccc-cccc-4ccc-8ccc-ccccccccccc2",
      show_id: SHOW_OWNED,
      brand_id: OTHER,
      brand_profile_id: PROFILE,
    });
    const recorded = await recordOutreachDraft(ctx(draftBody(SHOW_OWNED), "profile-owned"));
    expect(recorded.status).toBe("pending");
  });

  it("lists and reads only this brand's actions", async () => {
    const mine = await recordCampaignCreate(ctx(campaignBody(), "mine"));
    bridge.admin!.rows("api_write_actions").push({
      id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb8",
      brand_id: OTHER,
      api_key_id: KEY,
      kind: "campaign.create",
      status: "pending",
      idempotency_key: "theirs",
      payload: { secret: true },
      payload_hash: "abc",
      created_at: "2026-10-22T00:00:00.000Z",
      decided_at: null,
      decided_by: null,
    });
    const page = await listWriteActions(
      BRAND,
      new Request("https://www.taylslate.com/api/v1/actions?limit=10")
    );
    expect(page.data.map((row) => row.id)).toEqual([mine.actionId]);
    await expect(getWriteAction(BRAND, "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb8")).rejects.toBeInstanceOf(
      ApiReadError
    );
    const foreign = await getWriteAction(OTHER, mine.actionId).catch((err: unknown) => err);
    expect(foreign).toBeInstanceOf(ApiReadError);
    expect((foreign as ApiReadError).status).toBe(404);
  });
});

describe("writes.ts source", () => {
  it("mutates no table other than api_write_actions", () => {
    const src = readFileSync(join(__dirname, "writes.ts"), "utf8");
    const tables = [...src.matchAll(/from\("([^"]+)"\)/g)].map((match) => match[1]);
    expect(new Set(tables)).toEqual(
      new Set(["api_write_actions", "shows", "deals", "brand_profiles"])
    );
    expect(src.match(/\.insert\(/g)).toHaveLength(1);
    // createHash().update is the payload digest, not a table write.
    const queries = src.replace(/createHash\("sha256"\)\.update\(/g, "");
    expect(queries).not.toMatch(/\.update\(/);
    expect(queries).not.toMatch(/\.upsert\(/);
    expect(queries).not.toMatch(/\.delete\(/);
    expect(src).not.toMatch(/from\("(campaigns|outreaches|outreach|agent_show_relationships)"\)/);
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
