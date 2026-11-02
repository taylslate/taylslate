// Service-role reads for /admin. Selects only. No insert, update, delete, or rpc.
// The page calls this after the admin gate. Callers must not add a write method here.

import { supabaseAdmin } from "@/lib/supabase/admin";

export type OpsRow = Record<string, unknown>;

export interface OpsSelect {
  table: string;
  columns: string;
  eq?: Record<string, string | number | boolean>;
  gte?: Record<string, string>;
  in?: Record<string, readonly string[]>;
  ilike?: Record<string, string>;
  or?: string;
  notEq?: Record<string, string>;
  notNull?: readonly string[];
  order?: { column: string; ascending: boolean };
  limit?: number;
  offset?: number;
  head?: boolean;
}

export interface OpsError {
  code: string;
  message: string;
}

export interface OpsSelectResult {
  rows: OpsRow[];
  count: number | null;
  error: OpsError | null;
}

export interface OpsDb {
  select(spec: OpsSelect): Promise<OpsSelectResult>;
}

type QueryResult = {
  data: OpsRow[] | null;
  error: { code?: string; message?: string } | null;
  count: number | null;
};

type Query = PromiseLike<QueryResult> & {
  eq: (column: string, value: string | number | boolean) => Query;
  gte: (column: string, value: string) => Query;
  in: (column: string, values: readonly string[]) => Query;
  ilike: (column: string, pattern: string) => Query;
  or: (filters: string) => Query;
  neq: (column: string, value: string) => Query;
  not: (column: string, operator: string, value: null) => Query;
  order: (column: string, options: { ascending: boolean }) => Query;
  range: (from: number, to: number) => Query;
};

type ReadClient = {
  from: (table: string) => {
    select: (columns: string, options?: { count?: "exact"; head?: boolean }) => Query;
  };
};

export function isMissingRelation(error: OpsError): boolean {
  const message = error.message.toLowerCase();
  return (
    error.code === "42P01" ||
    error.code === "PGRST205" ||
    message.includes("could not find the table") ||
    (message.includes("relation") && message.includes("does not exist"))
  );
}

export function isMissingColumn(error: OpsError): boolean {
  if (isMissingRelation(error)) return false;
  const message = error.message.toLowerCase();
  return (
    error.code === "42703" ||
    error.code === "PGRST204" ||
    (message.includes("could not find the") && message.includes("column")) ||
    (message.includes("column") && message.includes("does not exist"))
  );
}

function emptyIn(spec: OpsSelect): boolean {
  if (!spec.in) return false;
  return Object.values(spec.in).some((values) => values.length === 0);
}

export function createSupabaseOpsDb(
  client: ReadClient = supabaseAdmin as unknown as ReadClient,
): OpsDb {
  return {
    async select(spec) {
      if (emptyIn(spec)) return { rows: [], count: 0, error: null };
      let query = client.from(spec.table).select(spec.columns, {
        count: "exact",
        head: Boolean(spec.head),
      });
      for (const [column, value] of Object.entries(spec.eq ?? {})) {
        query = query.eq(column, value);
      }
      for (const [column, value] of Object.entries(spec.gte ?? {})) {
        query = query.gte(column, value);
      }
      for (const [column, values] of Object.entries(spec.in ?? {})) {
        query = query.in(column, values);
      }
      for (const [column, pattern] of Object.entries(spec.ilike ?? {})) {
        query = query.ilike(column, pattern);
      }
      if (spec.or) query = query.or(spec.or);
      for (const [column, value] of Object.entries(spec.notEq ?? {})) {
        query = query.neq(column, value);
      }
      for (const column of spec.notNull ?? []) {
        query = query.not(column, "is", null);
      }
      if (spec.order) {
        query = query.order(spec.order.column, { ascending: spec.order.ascending });
      }
      if (!spec.head && spec.limit != null) {
        const offset = spec.offset ?? 0;
        query = query.range(offset, offset + spec.limit - 1);
      }
      const { data, error, count } = await query;
      if (error) {
        return {
          rows: [],
          count: null,
          error: { code: error.code ?? "", message: error.message ?? "read failed" },
        };
      }
      return { rows: data ?? [], count, error: null };
    },
  };
}
