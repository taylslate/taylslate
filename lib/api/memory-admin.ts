// In-memory stand-in for the service-role client. Unit tests install it
// over @/lib/supabase/admin. Routes must not import this module.

import { randomUUID } from "node:crypto";

export interface MemoryKeyRow {
  id: string;
  brand_id: string;
  name: string | null;
  prefix: string;
  key_hash: string;
  scopes: string[];
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

export interface MemoryWindowRow {
  key_id: string;
  window_start: string;
  count: number;
}

interface DbError {
  message: string;
  code: string;
}

interface QueryResult {
  data: Record<string, unknown>[] | null;
  error: DbError | null;
}

type Filter = { column: string; op: "eq" | "is"; value: unknown };

interface QueryState {
  action: "select" | "insert" | "update";
  filters: Filter[];
  columns: string | null;
  patch: Record<string, unknown> | null;
  insertRow: Record<string, unknown> | null;
  order: { column: string; ascending: boolean } | null;
}

export interface MemoryAdmin {
  keys: MemoryKeyRow[];
  windows: MemoryWindowRow[];
  profiles: Array<{ id: string }>;
  selects: string[];
  from: (table: string) => MemoryBuilder;
  rpc: (
    name: string,
    args: { p_key_id: string; p_window_start: string }
  ) => Promise<{ data: number | null; error: DbError | null }>;
}

interface MemoryBuilder {
  select: (columns?: string) => MemoryBuilder;
  insert: (row: Record<string, unknown>) => MemoryBuilder;
  update: (patch: Record<string, unknown>) => MemoryBuilder;
  eq: (column: string, value: unknown) => MemoryBuilder;
  is: (column: string, value: unknown) => MemoryBuilder;
  order: (
    column: string,
    options?: { ascending?: boolean }
  ) => MemoryBuilder;
  maybeSingle: () => Promise<{
    data: Record<string, unknown> | null;
    error: DbError | null;
  }>;
  single: () => Promise<{
    data: Record<string, unknown> | null;
    error: DbError | null;
  }>;
  then: (
    onFulfilled: (value: QueryResult) => unknown,
    onRejected?: (reason: unknown) => unknown
  ) => Promise<unknown>;
}

function project(row: MemoryKeyRow, columns: string | null): Record<string, unknown> {
  const record = { ...row } as unknown as Record<string, unknown>;
  if (!columns || columns.trim() === "*") return record;
  const out: Record<string, unknown> = {};
  for (const column of columns.split(",").map((part) => part.trim())) {
    out[column] = record[column];
  }
  return out;
}

function matches(row: MemoryKeyRow, filters: Filter[]): boolean {
  const record = row as unknown as Record<string, unknown>;
  return filters.every((filter) => {
    const value = record[filter.column];
    if (filter.op === "eq") return value === filter.value;
    return value === filter.value;
  });
}

export function createMemoryAdmin(): MemoryAdmin {
  const keys: MemoryKeyRow[] = [];
  const windows: MemoryWindowRow[] = [];
  const profiles: Array<{ id: string }> = [];
  const selects: string[] = [];
  let tick = Date.parse("2026-01-01T00:00:00.000Z");

  function from(table: string): MemoryBuilder {
    const state: QueryState = {
      action: "select",
      filters: [],
      columns: null,
      patch: null,
      insertRow: null,
      order: null,
    };

    function execute(): QueryResult {
      if (table === "profiles") {
        if (state.action !== "select") {
          return {
            data: null,
            error: { message: "profiles are read-only here", code: "42501" },
          };
        }
        const rows = profiles.filter((row) =>
          state.filters.every((filter) => {
            if (filter.op !== "eq") return false;
            return row[filter.column as "id"] === filter.value;
          })
        );
        return { data: rows.map((row) => ({ id: row.id })), error: null };
      }
      if (table !== "api_keys") {
        return {
          data: null,
          error: { message: `unexpected table ${table}`, code: "42P01" },
        };
      }

      if (state.action === "insert") {
        const input = state.insertRow ?? {};
        const prefix = String(input.prefix ?? "");
        if (keys.some((row) => row.prefix === prefix)) {
          return {
            data: null,
            error: { message: "duplicate key value", code: "23505" },
          };
        }
        const created: MemoryKeyRow = {
          id: randomUUID(),
          brand_id: String(input.brand_id),
          name: (input.name as string | null) ?? null,
          prefix,
          key_hash: String(input.key_hash),
          scopes: [...((input.scopes as string[]) ?? [])],
          created_at: new Date(tick).toISOString(),
          last_used_at: null,
          revoked_at: null,
        };
        tick += 1000;
        keys.push(created);
        return { data: [project(created, state.columns)], error: null };
      }

      let rows = keys.filter((row) => matches(row, state.filters));
      if (state.action === "update" && state.patch) {
        for (const row of rows) {
          Object.assign(row, state.patch);
        }
      }
      if (state.order) {
        const { column, ascending } = state.order;
        rows = [...rows].sort((left, right) => {
          const a = String((left as unknown as Record<string, unknown>)[column] ?? "");
          const b = String((right as unknown as Record<string, unknown>)[column] ?? "");
          return ascending ? a.localeCompare(b) : b.localeCompare(a);
        });
      }
      return {
        data: rows.map((row) => project(row, state.columns)),
        error: null,
      };
    }

    const builder: MemoryBuilder = {
      select(columns?: string) {
        state.columns = columns ?? "*";
        selects.push(state.columns);
        return builder;
      },
      insert(row: Record<string, unknown>) {
        state.action = "insert";
        state.insertRow = row;
        return builder;
      },
      update(patch: Record<string, unknown>) {
        state.action = "update";
        state.patch = patch;
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
      order(column: string, options?: { ascending?: boolean }) {
        state.order = { column, ascending: options?.ascending !== false };
        return builder;
      },
      async maybeSingle() {
        const result = execute();
        if (result.error) return { data: null, error: result.error };
        return { data: result.data?.[0] ?? null, error: null };
      },
      async single() {
        const result = execute();
        if (result.error) return { data: null, error: result.error };
        if (result.data?.length !== 1) {
          return {
            data: null,
            error: { message: "expected one row", code: "PGRST116" },
          };
        }
        return { data: result.data[0], error: null };
      },
      then(onFulfilled, onRejected) {
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
    keys,
    windows,
    profiles,
    selects,
    from,
    rpc(name, args) {
      if (name !== "increment_api_rate_window") {
        return Promise.resolve({
          data: null,
          error: { message: "unknown rpc", code: "42883" },
        });
      }
      let window = windows.find(
        (row) =>
          row.key_id === args.p_key_id && row.window_start === args.p_window_start
      );
      if (!window) {
        window = {
          key_id: args.p_key_id,
          window_start: args.p_window_start,
          count: 0,
        };
        windows.push(window);
      }
      window.count += 1;
      const cutoff = new Date(args.p_window_start).getTime() - 60 * 60 * 1000;
      for (let i = windows.length - 1; i >= 0; i -= 1) {
        const row = windows[i];
        if (
          row.key_id === args.p_key_id &&
          new Date(row.window_start).getTime() < cutoff
        ) {
          windows.splice(i, 1);
        }
      }
      return Promise.resolve({ data: window.count, error: null });
    },
  };
}
