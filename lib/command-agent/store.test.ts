import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const tables = vi.hoisted(() => ({
  rows: new Map<string, Record<string, unknown>[]>(),
  ops: [] as { table: string; op: string; brandId?: unknown }[],
  failTable: null as string | null,
  tick: Date.parse("2026-11-10T00:00:00.000Z"),
}));

vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: { from: (table: string) => query(table) },
}));

import {
  claimTurn,
  createConversation,
  deleteConversation,
  getConversation,
  insertMessage,
  listConversations,
  listMessages,
  releaseTurn,
  sumTokensSince,
} from "@/lib/command-agent/store";

const BRAND = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";

function rows(table: string): Record<string, unknown>[] {
  const found = tables.rows.get(table);
  if (found) return found;
  const created: Record<string, unknown>[] = [];
  tables.rows.set(table, created);
  return created;
}

function query(table: string) {
  const state = {
    op: "select" as "select" | "insert" | "update" | "delete",
    filters: [] as { column: string; op: string; value: unknown }[],
    ors: [] as string[],
    insertRow: null as Record<string, unknown> | null,
    patch: null as Record<string, unknown> | null,
    limit: null as number | null,
    descending: false,
  };

  function matched(): Record<string, unknown>[] {
    return rows(table).filter((row) => {
      for (const filter of state.filters) {
        if (filter.op === "eq" && row[filter.column] !== filter.value) return false;
        if (filter.op === "is" && filter.value === null && row[filter.column] != null) return false;
        if (filter.op === "gte" && String(row[filter.column] ?? "") < String(filter.value)) return false;
      }
      for (const expression of state.ors) {
        if (!orMatch(row, expression)) return false;
      }
      return true;
    });
  }

  function execute(): { data: Record<string, unknown>[] | null; error: { message: string } | null } {
    if (tables.failTable === table) return { data: null, error: { message: "read failed" } };
    if (state.op === "insert") {
      tables.tick += 1000;
      const stamp = new Date(tables.tick).toISOString();
      const created: Record<string, unknown> = {
        id: randomUUID(),
        created_at: stamp,
        updated_at: stamp,
        turn_started_at: null,
        action_ids: [],
        input_tokens: 0,
        output_tokens: 0,
        ...(state.insertRow ?? {}),
      };
      rows(table).push(created);
      tables.ops.push({ table, op: "insert", brandId: created.brand_id });
      return { data: [created], error: null };
    }
    if (state.op === "update") {
      const hits = matched();
      for (const row of hits) Object.assign(row, state.patch);
      tables.ops.push({
        table,
        op: "update",
        brandId: state.filters.find((filter) => filter.column === "brand_id")?.value,
      });
      return { data: hits, error: null };
    }
    if (state.op === "delete") {
      const drop = new Set(matched());
      tables.rows.set(
        table,
        rows(table).filter((row) => !drop.has(row))
      );
      tables.ops.push({
        table,
        op: "delete",
        brandId: state.filters.find((filter) => filter.column === "brand_id")?.value,
      });
      return { data: [...drop], error: null };
    }
    let list = matched();
    list = [...list].sort((left, right) => {
      const a = String(left.created_at ?? left.updated_at ?? "");
      const b = String(right.created_at ?? right.updated_at ?? "");
      return state.descending ? b.localeCompare(a) : a.localeCompare(b);
    });
    if (state.op === "select") {
      tables.ops.push({
        table,
        op: "select",
        brandId: state.filters.find((filter) => filter.column === "brand_id")?.value,
      });
    }
    if (state.limit != null) list = list.slice(0, state.limit);
    return { data: list, error: null };
  }

  const builder = {
    select() {
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
      state.filters.push({ column, op: "eq", value });
      return builder;
    },
    is(column: string, value: unknown) {
      state.filters.push({ column, op: "is", value });
      return builder;
    },
    gte(column: string, value: unknown) {
      state.filters.push({ column, op: "gte", value });
      return builder;
    },
    or(expression: string) {
      state.ors.push(expression);
      return builder;
    },
    order(_column: string, options?: { ascending?: boolean }) {
      state.descending = options?.ascending === false;
      return builder;
    },
    limit(count: number) {
      state.limit = count;
      return builder;
    },
    maybeSingle() {
      const result = execute();
      return Promise.resolve({ data: result.data?.[0] ?? null, error: result.error });
    },
    single() {
      const result = execute();
      return Promise.resolve({ data: result.data?.[0] ?? null, error: result.error });
    },
    then(onFulfilled: (value: unknown) => unknown) {
      return Promise.resolve(onFulfilled(execute()));
    },
  };
  return builder;
}

function orMatch(row: Record<string, unknown>, expression: string): boolean {
  return expression.split(",").some((part) => {
    const match = part.match(/^([a-z_]+)\.(is|lt)\.(.+)$/);
    if (!match) return false;
    const [, column, op, raw] = match;
    if (op === "is" && raw === "null") return row[column] == null;
    if (op === "lt") return String(row[column] ?? "") < raw.replace(/^"|"$/g, "");
    return false;
  });
}

beforeEach(() => {
  tables.rows.clear();
  tables.ops.length = 0;
  tables.failTable = null;
  tables.tick = Date.parse("2026-11-10T00:00:00.000Z");
});

describe("command agent store", () => {
  it("reads and writes only the caller's brand", async () => {
    const mine = await createConversation(BRAND, "Mine");
    const theirs = await createConversation(OTHER, "Theirs");
    expect(mine?.brand_id).toBe(BRAND);
    expect(theirs?.id).toBeTruthy();
    const listed = await listConversations(BRAND);
    expect(listed?.map((row) => row.id)).toEqual([mine?.id]);
    const foreign = await getConversation(BRAND, theirs?.id ?? "");
    expect(foreign).toEqual({ ok: true, row: null });
    const message = await insertMessage({
      brandId: BRAND,
      conversationId: mine?.id ?? "",
      role: "user",
      content: { text: "hello" },
    });
    await insertMessage({
      brandId: OTHER,
      conversationId: theirs?.id ?? "",
      role: "user",
      content: { text: "other brand secret" },
    });
    const thread = await listMessages(BRAND, mine?.id ?? "");
    expect(thread?.map((row) => row.id)).toEqual([message?.id]);
    expect(JSON.stringify(thread)).not.toContain("other brand secret");
    for (const op of tables.ops) {
      if (op.op === "insert") continue;
      expect(op.brandId).toBeTruthy();
    }
    expect(tables.ops.some((op) => op.table === "api_write_actions")).toBe(false);
  });

  it("claims one turn and releases it", async () => {
    const mine = await createConversation(BRAND, null);
    const id = mine?.id ?? "";
    expect(await claimTurn(BRAND, id, new Date("2026-11-10T00:00:00.000Z"))).toBe("claimed");
    expect(await claimTurn(BRAND, id, new Date("2026-11-10T00:00:10.000Z"))).toBe("busy");
    expect(await claimTurn(OTHER, id)).toBe("missing");
    await releaseTurn(BRAND, id);
    expect(await claimTurn(BRAND, id, new Date("2026-11-10T00:01:00.000Z"))).toBe("claimed");
  });

  it("lets a stale claim be taken after 120 seconds", async () => {
    const mine = await createConversation(BRAND, null);
    const id = mine?.id ?? "";
    expect(await claimTurn(BRAND, id, new Date("2026-11-10T00:00:00.000Z"))).toBe("claimed");
    expect(await claimTurn(BRAND, id, new Date("2026-11-10T00:02:01.000Z"))).toBe("claimed");
  });

  it("deletes the conversation and leaves api_write_actions alone", async () => {
    const mine = await createConversation(BRAND, "Mine");
    await insertMessage({
      brandId: BRAND,
      conversationId: mine?.id ?? "",
      role: "assistant",
      content: { text: "ok" },
      actionIds: ["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa9"],
    });
    expect(await deleteConversation(BRAND, mine?.id ?? "")).toBe("deleted");
    expect(await getConversation(BRAND, mine?.id ?? "")).toEqual({ ok: true, row: null });
    expect(await deleteConversation(OTHER, mine?.id ?? "")).toBe("missing");
    expect(tables.ops.some((op) => op.table === "api_write_actions")).toBe(false);
  });

  it("sums tokens since the cutoff and fails closed on a read error", async () => {
    const mine = await createConversation(BRAND, null);
    await insertMessage({
      brandId: BRAND,
      conversationId: mine?.id ?? "",
      role: "assistant",
      content: { text: "ok" },
      inputTokens: 20,
      outputTokens: 5,
    });
    const sum = await sumTokensSince(BRAND, "2000-01-01T00:00:00.000Z");
    expect(sum).toEqual({ ok: true, total: 25 });
    tables.failTable = "command_agent_messages";
    expect(await sumTokensSince(BRAND, "2000-01-01T00:00:00.000Z")).toEqual({ ok: false });
  });

  it("returns the last messages in chronological order", async () => {
    const mine = await createConversation(BRAND, null);
    const id = mine?.id ?? "";
    for (let n = 0; n < 3; n += 1) {
      await insertMessage({
        brandId: BRAND,
        conversationId: id,
        role: "user",
        content: { text: `m${n}` },
      });
    }
    const last = await listMessages(BRAND, id, 2);
    expect(last?.map((row) => row.content.text)).toEqual(["m1", "m2"]);
  });
});
