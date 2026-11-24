import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  IO_READ_COLUMNS,
  OUTREACH_READ_COLUMNS,
  SHOW_READ_COLUMNS,
} from "@/lib/shows/read-columns";

const WITHHELD = ["contact_email", "sent_to_email", "publisher_contact_email"] as const;
const TABLES = ["shows", "outreaches", "insertion_orders"] as const;

export function unsafeContactReads(source: string): string[] {
  const text = stripComments(source);
  const violations: string[] = [];
  const fromRe = /\.from\s*\(\s*["']([^"']+)["']\s*\)/g;
  for (const match of text.matchAll(fromRe)) {
    const table = match[1];
    const index = match.index ?? 0;
    const before = text.slice(Math.max(0, index - 120), index);
    const receiver = before.match(/([A-Za-z_$][\w$]*)\s*$/)?.[1] ?? "";
    if (receiver === "supabaseAdmin") continue;
    const select = readSelect(text, index + match[0].length);
    if (!select || !selectIsUnsafe(select.arg, table)) continue;
    violations.push(`${receiver}.from("${table}").select(${select.arg})`);
  }
  return violations;
}

function readSelect(source: string, fromEnd: number): { arg: string } | null {
  const window = source.slice(fromEnd, fromEnd + 2000);
  const stop = window.search(/;/);
  const slice = stop === -1 ? window : window.slice(0, stop);
  const match = slice.match(/\.select\s*\(/);
  if (!match || match.index === undefined) return null;
  const start = match.index + match[0].length;
  let depth = 1;
  let end = start;
  for (; end < slice.length; end += 1) {
    const ch = slice[end];
    if (ch === "(") depth += 1;
    else if (ch === ")") {
      depth -= 1;
      if (depth === 0) break;
    }
  }
  const arg = slice.slice(start, end).trim();
  return { arg };
}

function selectIsUnsafe(arg: string, table: string): boolean {
  if (embedIsUnsafe(arg)) return true;
  if (!TABLES.includes(table as (typeof TABLES)[number])) return false;
  if (arg.length === 0) return true;
  const bare = arg.replace(/^["'`]|["'`]$/g, "");
  if (bare === "*") return true;
  if (arg.includes("*")) return true;
  return WITHHELD.some((name) => new RegExp(`(^|[^\\w])${name}([^\\w]|$)`).test(arg));
}

function embedIsUnsafe(arg: string): boolean {
  const embed = /(?:shows|outreaches|insertion_orders)(?:![A-Za-z0-9_]+)?\(([^)]*)\)/g;
  for (const match of arg.matchAll(embed)) {
    const inner = match[1] ?? "";
    if (inner.includes("*")) return true;
    if (WITHHELD.some((name) => new RegExp(`(^|[^\\w])${name}([^\\w]|$)`).test(inner))) return true;
  }
  return false;
}

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function walk(dir: string, out: string[]) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      if (entry === "scripts" || entry === "node_modules") continue;
      walk(path, out);
      continue;
    }
    if (!/\.tsx?$/.test(entry) || /\.test\.tsx?$/.test(entry)) continue;
    out.push(path);
  }
}

describe("user-client contact reads", () => {
  it("catches a star select and allows the admin client", () => {
    expect(unsafeContactReads('supabase.from("shows").select("*")')).toEqual([
      'supabase.from("shows").select("*")',
    ]);
    expect(unsafeContactReads('supabase.from("shows").select()')).toHaveLength(1);
    expect(
      unsafeContactReads('supabase.from("outreaches").select("id, sent_to_email")')
    ).toHaveLength(1);
    expect(unsafeContactReads('supabase.from("deals").select("id, shows(*)")')).toEqual([
      'supabase.from("deals").select("id, shows(*)")',
    ]);
    expect(
      unsafeContactReads('supabase.from("deals").select("id, shows!inner(contact_email)")')
    ).toHaveLength(1);
    expect(unsafeContactReads('supabase.from("deals").select("id, shows!inner(name)")')).toEqual([]);
    expect(unsafeContactReads('supabaseAdmin.from("deals").select("id, shows(*)")')).toEqual([]);
    expect(unsafeContactReads('supabaseAdmin.from("shows").select("*")')).toEqual([]);
    expect(
      unsafeContactReads('supabaseAdmin\n  .from("shows")\n  .select("id, contact_email")')
    ).toEqual([]);
  });

  it("finds no unsafe user-client read in app or lib", () => {
    const root = join(__dirname, "../..");
    const files: string[] = [];
    walk(join(root, "app"), files);
    walk(join(root, "lib"), files);
    const hits: string[] = [];
    for (const file of files) {
      const violations = unsafeContactReads(readFileSync(file, "utf8"));
      for (const violation of violations) hits.push(`${file}: ${violation}`);
    }
    expect(hits).toEqual([]);
    expect(TABLES).toEqual(["shows", "outreaches", "insertion_orders"]);
  });
});

const calls: Array<{ table: string; select: string; ops: string[] }> = [];

function builder(table: string) {
  const call = { table, select: "", ops: [] as string[] };
  const api = {
    select(cols?: string) {
      call.select = cols ?? "";
      calls.push(call);
      return api;
    },
    insert() {
      return api;
    },
    update() {
      return api;
    },
    eq(column: string, value: unknown) {
      call.ops.push(`eq:${column}:${JSON.stringify(value)}`);
      return api;
    },
    in(column: string, value: unknown) {
      call.ops.push(`in:${column}`);
      void value;
      return api;
    },
    order(column: string, opts: unknown) {
      call.ops.push(`order:${column}:${JSON.stringify(opts)}`);
      return api;
    },
    or(value: string) {
      call.ops.push(`or:${value}`);
      return api;
    },
    ilike() {
      return api;
    },
    contains() {
      return api;
    },
    gte() {
      return api;
    },
    lte() {
      return api;
    },
    limit() {
      return api;
    },
    single: async () => ({ data: null, error: { code: "PGRST116" } }),
    maybeSingle: async () => ({ data: null, error: null }),
    then(resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) {
      const data = table === "agent_show_relationships" ? [{ show_id: "show-1" }] : [];
      return Promise.resolve({ data, error: null }).then(resolve, reject);
    },
  };
  return api;
}

vi.mock("next/headers", () => ({ cookies: vi.fn(async () => ({ get: () => undefined })) }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "user-1" } } }) },
    from: (table: string) => builder(table),
  }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: { from: (table: string) => builder(table) },
}));
vi.mock("@/lib/data/events", () => ({ logEvent: vi.fn() }));

import {
  createIO,
  getAllShows,
  getIOById,
  getOutreachesForCampaign,
  getShowById,
  getShowBySlug,
  getShowsByAgent,
  getShowsByIds,
  getShowsFiltered,
  getShowsNeedingEnrichment,
} from "@/lib/data/queries";
import { addShowFromSearch } from "@/lib/discovery/direct-search";

describe("rewritten user-client selects", () => {
  beforeEach(() => {
    calls.length = 0;
  });

  function last(table: string) {
    return [...calls].reverse().find((call) => call.table === table);
  }

  it("names granted columns and keeps filters", async () => {
    await getAllShows();
    expect(last("shows")?.select).toBe(SHOW_READ_COLUMNS);
    expect(last("shows")?.ops).toContain('eq:is_discoverable:true');
    expect(last("shows")?.ops).toContain('order:audience_size:{"ascending":false}');

    await getShowById("show-1");
    expect(last("shows")?.select).toBe(SHOW_READ_COLUMNS);
    expect(last("shows")?.ops).toContain('eq:id:"show-1"');

    await getShowsByAgent("agent-1");
    expect(last("shows")?.select).toBe(SHOW_READ_COLUMNS);
    expect(last("shows")?.ops).toContain("in:id");
    expect(last("shows")?.ops).toContain('order:audience_size:{"ascending":false}');

    await getShowsByIds(["show-1"]);
    expect(last("shows")?.select).toBe(SHOW_READ_COLUMNS);
    expect(last("shows")?.ops).toContain("in:id");
    expect(last("shows")?.ops).toContain("eq:is_discoverable:true");

    await getShowBySlug("daily");
    expect(last("shows")?.select).toBe(SHOW_READ_COLUMNS);
    expect(last("shows")?.ops).toContain('eq:slug:"daily"');

    await getShowsFiltered({ search: "daily", platform: "podcast" });
    expect(last("shows")?.select).toBe(SHOW_READ_COLUMNS);
    expect(last("shows")?.ops).toContain("eq:is_discoverable:true");
    expect(last("shows")?.ops).toContain('order:audience_size:{"ascending":false}');
    expect(last("shows")?.ops).toContain('eq:platform:"podcast"');

    await getShowsNeedingEnrichment("agent-1");
    expect(last("shows")?.select).toBe(SHOW_READ_COLUMNS);
    expect(last("shows")?.ops.some((op) => op.startsWith("or:last_api_refresh"))).toBe(true);
    expect(last("shows")?.ops).toContain('order:name:{"ascending":true}');

    await getOutreachesForCampaign("camp-1");
    expect(last("outreaches")?.select).toBe(OUTREACH_READ_COLUMNS);
    expect(last("outreaches")?.ops).toContain('eq:campaign_id:"camp-1"');
    expect(last("outreaches")?.ops).toContain('order:created_at:{"ascending":false}');

    await getIOById("io-1");
    expect(last("insertion_orders")?.select).toBe(IO_READ_COLUMNS);
    expect(last("insertion_orders")?.ops).toContain('eq:id:"io-1"');

    await createIO({ io_number: "IO-1" } as never, []);
    expect(last("insertion_orders")?.select).toBe(IO_READ_COLUMNS);

    await addShowFromSearch(
      { id: "camp-1", user_id: "user-1" },
      "show:33333333-3333-4333-8333-333333333333"
    );
    expect(last("shows")?.select).toBe(SHOW_READ_COLUMNS);
    expect(last("shows")?.ops).toContain("eq:is_discoverable:true");

    for (const call of calls) {
      if (!TABLES.includes(call.table as (typeof TABLES)[number])) continue;
      expect(call.select).not.toBe("");
      expect(call.select).not.toBe("*");
      for (const name of WITHHELD) {
        expect(call.select).not.toMatch(new RegExp(`(^|[^\\w])${name}([^\\w]|$)`));
      }
    }
  });
});
