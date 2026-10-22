// In-memory stand-in for domain tables in unit tests. Routes must not
// import this module. api_keys stay on lib/api/memory-admin.

export interface DomainAdmin {
  tables: Record<string, Record<string, unknown>[]>;
  selects: string[];
  from: (table: string) => DomainBuilder;
  failNext: (message: string) => void;
}

interface DbError {
  message: string;
  code: string;
}

interface QueryResult {
  data: Record<string, unknown>[] | null;
  error: DbError | null;
}

interface CmpTerm {
  kind: "cmp";
  column: string;
  op: string;
  value: string;
}

interface AndTerm {
  kind: "and";
  terms: Term[];
}

interface OrTerm {
  kind: "or";
  terms: Term[];
}

interface NeverTerm {
  kind: "never";
}

type Term = CmpTerm | AndTerm | OrTerm | NeverTerm;

interface EqFilter {
  type: "eq";
  column: string;
  value: unknown;
}

interface InFilter {
  type: "in";
  column: string;
  values: readonly unknown[];
}

interface IlikeFilter {
  type: "ilike";
  column: string;
  pattern: string;
}

interface IsFilter {
  type: "is";
  column: string;
  value: unknown;
}

type Filter = EqFilter | InFilter | IlikeFilter | IsFilter;

interface QueryState {
  columns: string[] | null;
  filters: Filter[];
  ors: string[];
  orders: { column: string; ascending: boolean }[];
  maxRows: number | null;
}

export interface DomainBuilder {
  select: (columns?: string) => DomainBuilder;
  eq: (column: string, value: unknown) => DomainBuilder;
  in: (column: string, values: readonly unknown[]) => DomainBuilder;
  ilike: (column: string, pattern: string) => DomainBuilder;
  is: (column: string, value: unknown) => DomainBuilder;
  or: (filters: string) => DomainBuilder;
  order: (column: string, options?: { ascending?: boolean }) => DomainBuilder;
  limit: (count: number) => DomainBuilder;
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

const TABLE_NAMES = [
  "shows",
  "campaigns",
  "deals",
  "brand_profiles",
  "campaign_patterns",
  "conviction_scores",
  "profiles",
  "show_profiles",
];

export function createDomainAdmin(): DomainAdmin {
  const tables: Record<string, Record<string, unknown>[]> = {};
  for (const name of TABLE_NAMES) tables[name] = [];
  const selects: string[] = [];
  let failure: DbError | null = null;

  function from(table: string): DomainBuilder {
    const state: QueryState = {
      columns: null,
      filters: [],
      ors: [],
      orders: [],
      maxRows: null,
    };

    function execute(): QueryResult {
      if (failure) {
        const error = failure;
        failure = null;
        return { data: null, error };
      }
      if (!Object.prototype.hasOwnProperty.call(tables, table)) {
        return {
          data: null,
          error: { message: `unexpected table ${table}`, code: "42P01" },
        };
      }
      let matched = tables[table].filter((row) => rowMatches(row, state));
      if (state.orders.length > 0) {
        matched = matched.slice();
        for (let index = state.orders.length - 1; index >= 0; index -= 1) {
          const { column, ascending } = state.orders[index];
          matched.sort((left, right) => {
            const cmp = compare(left[column], right[column]);
            return ascending ? cmp : -cmp;
          });
        }
      }
      if (state.maxRows != null) matched = matched.slice(0, state.maxRows);
      const data: Record<string, unknown>[] = [];
      for (const row of matched) data.push(project(row, state.columns));
      return { data, error: null };
    }

    const builder: DomainBuilder = {
      select(columns?: string) {
        selects.push(columns ?? "*");
        if (!columns || columns.trim() === "*") {
          state.columns = null;
        } else {
          state.columns = columns.split(",").map((part) => part.trim());
        }
        return builder;
      },
      eq(column: string, value: unknown) {
        state.filters.push({ type: "eq", column, value });
        return builder;
      },
      in(column: string, values: readonly unknown[]) {
        state.filters.push({ type: "in", column, values });
        return builder;
      },
      ilike(column: string, pattern: string) {
        state.filters.push({ type: "ilike", column, pattern });
        return builder;
      },
      is(column: string, value: unknown) {
        state.filters.push({ type: "is", column, value });
        return builder;
      },
      or(filters: string) {
        state.ors.push(filters);
        return builder;
      },
      order(column: string, options?: { ascending?: boolean }) {
        state.orders.push({ column, ascending: options?.ascending !== false });
        return builder;
      },
      limit(count: number) {
        state.maxRows = count;
        return builder;
      },
      async maybeSingle() {
        const result = execute();
        if (result.error) return { data: null, error: result.error };
        const rows = result.data ?? [];
        if (rows.length > 1) {
          return {
            data: null,
            error: { message: "multiple rows", code: "PGRST116" },
          };
        }
        return { data: rows[0] ?? null, error: null };
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
    tables,
    selects,
    from,
    failNext(message: string) {
      failure = { message, code: "57014" };
    },
  };
}

function project(
  source: Record<string, unknown>,
  columns: string[] | null
): Record<string, unknown> {
  const copy: Record<string, unknown> = {};
  const keys = columns ?? Object.keys(source);
  for (const key of keys) copy[key] = source[key];
  return copy;
}

function rowMatches(row: Record<string, unknown>, state: QueryState): boolean {
  for (const filter of state.filters) {
    if (!filterMatches(row, filter)) return false;
  }
  for (const expression of state.ors) {
    if (!matchesTerm(row, { kind: "or", terms: splitTopLevel(expression).map(parseTerm) })) {
      return false;
    }
  }
  return true;
}

function filterMatches(row: Record<string, unknown>, filter: Filter): boolean {
  const left = row[filter.column];
  if (filter.type === "eq") return matchesEq(left, filter.value);
  if (filter.type === "is") return left === filter.value;
  if (filter.type === "in") {
    if (filter.values.length === 0) return false;
    for (const value of filter.values) {
      if (matchesEq(left, value)) return true;
    }
    return false;
  }
  return matchesIlike(left, filter.pattern);
}

function matchesEq(left: unknown, right: unknown): boolean {
  if (typeof right === "string") return valuesEqual(left, right);
  return left === right;
}

function valuesEqual(left: unknown, right: string): boolean {
  if (typeof left === "boolean" || typeof left === "number") return String(left) === right;
  if (left == null) return right === "null";
  return String(left) === right;
}

function matchesIlike(left: unknown, pattern: string): boolean {
  if (typeof left !== "string") return false;
  const literal = pattern.replace(/\\([\\%_])/g, "$1");
  return left.toLowerCase() === literal.toLowerCase();
}

function compare(left: unknown, right: unknown): number {
  const a = left == null ? "" : String(left);
  const b = right == null ? "" : String(right);
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function matchesTerm(row: Record<string, unknown>, term: Term): boolean {
  if (term.kind === "never") return false;
  if (term.kind === "and") {
    for (const child of term.terms) {
      if (!matchesTerm(row, child)) return false;
    }
    return true;
  }
  if (term.kind === "or") {
    for (const child of term.terms) {
      if (matchesTerm(row, child)) return true;
    }
    return false;
  }
  const left = row[term.column];
  if (term.op === "in") {
    for (const item of inValues(term.value)) {
      if (valuesEqual(left, item)) return true;
    }
    return false;
  }
  if (term.op === "eq") return valuesEqual(left, term.value);
  const cmp = compare(left, term.value);
  if (term.op === "lt") return cmp < 0;
  if (term.op === "gt") return cmp > 0;
  if (term.op === "lte") return cmp <= 0;
  if (term.op === "gte") return cmp >= 0;
  return false;
}

function inValues(raw: string): string[] {
  const inner = raw.startsWith("(") && raw.endsWith(")") ? raw.slice(1, -1) : raw;
  if (inner.trim() === "") return [];
  const parts = inner.split(",");
  const values: string[] = [];
  for (const part of parts) {
    let value = part.trim();
    if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) {
      value = value.slice(1, -1);
    }
    if (value.length > 0) values.push(value);
  }
  return values;
}

function parseTerm(part: string): Term {
  const trimmed = part.trim();
  if (trimmed.startsWith("and(") && trimmed.endsWith(")")) {
    return {
      kind: "and",
      terms: splitTopLevel(trimmed.slice(4, -1)).map(parseTerm),
    };
  }
  const match = /^([a-z_][a-z0-9_]*)\.(eq|lt|gt|lte|gte|in)\.(.*)$/i.exec(trimmed);
  if (!match) return { kind: "never" };
  let raw = match[3];
  if (raw.startsWith('"') && raw.endsWith('"') && raw.length >= 2) {
    raw = raw.slice(1, -1);
  }
  return {
    kind: "cmp",
    column: match[1],
    op: match[2].toLowerCase(),
    value: raw,
  };
}

function splitTopLevel(input: string): string[] {
  const parts: string[] = [];
  let current = "";
  let depth = 0;
  let quote = false;
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
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
