// In-memory Supabase stand-in for OAuth tests. Not used in production.

import { createHash, randomBytes, randomUUID } from "node:crypto";

type Row = Record<string, unknown>;

interface DbError {
  code: string;
  message: string;
}

const SECRET_DB_TEXT = "secret-db-text";

const TABLE_NAMES = [
  "mcp_oauth_clients",
  "mcp_oauth_requests",
  "mcp_oauth_codes",
  "mcp_oauth_tokens",
  "api_keys",
  "profiles",
  "event_log",
];

const UNIQUE: Record<string, string[]> = {
  mcp_oauth_clients: ["client_id"],
  mcp_oauth_codes: ["code_hash"],
  mcp_oauth_tokens: ["token_hash"],
  api_keys: ["prefix"],
};

interface Filter {
  op: "eq" | "is" | "gt";
  column: string;
  value: unknown;
}

export interface OauthTestAdmin {
  tables: Record<string, Row[]>;
  inserts: { table: string; row: Row }[];
  queries: string[];
  events: unknown[];
  user: { id: string } | null;
  failAll: DbError | null;
  missingTables: Set<string>;
  failUpdates: Set<string>;
  beforeExecute: ((table: string, op: "select" | "insert" | "update", patch: Row | null) => void) | null;
  denyBuckets: Set<string>;
  rateError: DbError | null;
  from: (table: string) => unknown;
  rpc: (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: DbError | null }>;
}

function dbError(code: string): DbError {
  return { code, message: SECRET_DB_TEXT };
}

function matches(row: Row, filters: Filter[]): boolean {
  return filters.every((filter) => {
    const value = row[filter.column];
    if (filter.op === "eq") return value === filter.value;
    if (filter.op === "is") {
      if (filter.value === null) return value == null;
      return value === filter.value;
    }
    const left = Date.parse(String(value ?? ""));
    const right = Date.parse(String(filter.value ?? ""));
    if (Number.isFinite(left) && Number.isFinite(right)) return left > right;
    return String(value ?? "") > String(filter.value ?? "");
  });
}

function project(row: Row, columns: string | null): Row {
  if (!columns || columns.trim() === "*") return { ...row };
  const out: Row = {};
  for (const column of columns.split(",").map((part) => part.trim()).filter(Boolean)) {
    out[column] = row[column];
  }
  return out;
}

export function createOauthTestAdmin(): OauthTestAdmin {
  const tables: Record<string, Row[]> = {};
  for (const name of TABLE_NAMES) tables[name] = [];
  const inserts: { table: string; row: Row }[] = [];
  const queries: string[] = [];
  const events: unknown[] = [];
  const admin: OauthTestAdmin = {
    tables,
    inserts,
    queries,
    events,
    user: null,
    failAll: null,
    missingTables: new Set(),
    failUpdates: new Set(),
    beforeExecute: null,
    denyBuckets: new Set(),
    rateError: null,
    from,
    rpc,
  };
  const hits = new Map<string, number>();
  const apiCounts = new Map<string, number>();

  function from(table: string) {
    queries.push(table);
    const state = {
      op: "select" as "select" | "insert" | "update",
      filters: [] as Filter[],
      columns: null as string | null,
      rows: null as Row[] | null,
      patch: null as Row | null,
    };

    function execute(): { data: Row[] | null; error: DbError | null } {
      if (admin.failAll) return { data: null, error: admin.failAll };
      if (admin.missingTables.has(table) || !Object.prototype.hasOwnProperty.call(tables, table)) {
        return { data: null, error: dbError("42P01") };
      }
      admin.beforeExecute?.(table, state.op, state.patch);
      if (state.op === "update" && admin.failUpdates.has(table)) {
        return { data: null, error: dbError("XX000") };
      }
      const list = tables[table];
      if (state.op === "insert") {
        const created: Row[] = [];
        for (const input of state.rows ?? []) {
          inserts.push({ table, row: structuredClone(input) });
          for (const column of UNIQUE[table] ?? []) {
            if (list.some((row) => row[column] === input[column])) {
              return { data: null, error: dbError("23505") };
            }
          }
          const stored: Row = { ...input };
          if (stored.id == null) stored.id = randomUUID();
          if (stored.created_at == null) stored.created_at = new Date().toISOString();
          if (!Object.prototype.hasOwnProperty.call(stored, "revoked_at")) stored.revoked_at = null;
          if (!Object.prototype.hasOwnProperty.call(stored, "used_at")) stored.used_at = null;
          if (!Object.prototype.hasOwnProperty.call(stored, "consumed_at")) stored.consumed_at = null;
          if (!Object.prototype.hasOwnProperty.call(stored, "last_used_at")) stored.last_used_at = null;
          list.push(stored);
          created.push(project(stored, state.columns));
        }
        return { data: created, error: null };
      }
      const matched = list.filter((row) => matches(row, state.filters));
      if (state.op === "update") {
        for (const row of matched) Object.assign(row, state.patch);
      }
      return { data: matched.map((row) => project(row, state.columns)), error: null };
    }

    function one(mode: "single" | "maybe"): { data: Row | null; error: DbError | null } {
      const result = execute();
      if (result.error) return { data: null, error: result.error };
      const rows = result.data ?? [];
      if (rows.length === 1) return { data: rows[0], error: null };
      if (rows.length === 0) {
        if (mode === "single") return { data: null, error: dbError("PGRST116") };
        return { data: null, error: null };
      }
      return { data: null, error: dbError("PGRST116") };
    }

    const builder = {
      select(columns?: string) {
        state.columns = columns ?? "*";
        return builder;
      },
      insert(row: Row | Row[]) {
        state.op = "insert";
        state.rows = Array.isArray(row) ? row.map((item) => ({ ...item })) : [{ ...row }];
        return builder;
      },
      update(patch: Row) {
        state.op = "update";
        state.patch = patch;
        return builder;
      },
      eq(column: string, value: unknown) {
        state.filters.push({ op: "eq", column, value });
        return builder;
      },
      is(column: string, value: unknown) {
        state.filters.push({ op: "is", column, value });
        return builder;
      },
      gt(column: string, value: unknown) {
        state.filters.push({ op: "gt", column, value });
        return builder;
      },
      maybeSingle() {
        return Promise.resolve(one("maybe"));
      },
      single() {
        return Promise.resolve(one("single"));
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

  function rpc(name: string, args: Record<string, unknown>) {
    if (admin.rateError && name === "rate_limit_hit") {
      return Promise.resolve({ data: null, error: admin.rateError });
    }
    if (name === "rate_limit_hit") {
      const bucket = String(args.p_bucket ?? "");
      const key = String(args.p_key ?? "");
      const max = Number(args.p_max);
      if (admin.denyBuckets.has(bucket)) return Promise.resolve({ data: false, error: null });
      const id = `${bucket}\0${key}`;
      const next = (hits.get(id) ?? 0) + 1;
      hits.set(id, next);
      return Promise.resolve({ data: next <= max, error: null });
    }
    if (name === "increment_api_rate_window") {
      const id = `${String(args.p_key_id)}:${String(args.p_window_start)}`;
      const next = (apiCounts.get(id) ?? 0) + 1;
      apiCounts.set(id, next);
      return Promise.resolve({ data: next, error: null });
    }
    return Promise.resolve({ data: null, error: dbError("42883") });
  }

  return admin;
}

export const SECRET_DB = SECRET_DB_TEXT;

export const TEST_ORIGIN = "https://www.taylslate.com";
export const TEST_USER = "11111111-1111-4111-8111-111111111111";
export const TEST_REDIRECT = "https://app.example/callback";

export function installOauthEnv(): void {
  process.env.NEXT_PUBLIC_SITE_URL = TEST_ORIGIN;
}

export function seedOperator(
  admin: OauthTestAdmin,
  plan = "operator",
  role = "brand"
): void {
  admin.tables.profiles.push({ id: TEST_USER, role, plan });
  admin.user = { id: TEST_USER };
}

export function pkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

export function jsonPost(url: string, body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: TEST_ORIGIN,
      "x-forwarded-for": "203.0.113.10",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

export function formPost(
  url: string,
  params: Record<string, string>,
  headers: Record<string, string> = {}
): Request {
  return new Request(url, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "x-forwarded-for": "203.0.113.10",
      ...headers,
    },
    body: new URLSearchParams(params).toString(),
  });
}
