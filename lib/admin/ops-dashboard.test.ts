import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { loadOpsDashboard, redactOpsText, summarizeFees } from "@/lib/admin/ops-dashboard";
import {
  isMissingColumn,
  isMissingRelation,
  type OpsDb,
  type OpsRow,
  type OpsSelect,
} from "@/lib/admin/ops-db";
import {
  DEFAULT_OPS_FILTERS,
  filtersToHref,
  orIlike,
  parseOpsFilters,
  sanitizeSearch,
} from "@/lib/admin/ops-filters";

const NOW = new Date("2026-11-02T12:00:00.000Z");

function splitOr(input: string): string[] {
  const parts: string[] = [];
  let current = "";
  let depth = 0;
  for (const ch of input) {
    if (ch === "(") depth += 1;
    if (ch === ")") depth = Math.max(0, depth - 1);
    if (ch === "," && depth === 0) {
      parts.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  if (current) parts.push(current);
  return parts;
}

function parseClause(clause: string): { column: string; op: string; value: string } | null {
  for (const op of ["ilike", "in", "eq", "gte", "neq"]) {
    const token = `.${op}.`;
    const at = clause.indexOf(token);
    if (at > 0) {
      return { column: clause.slice(0, at), op, value: clause.slice(at + token.length) };
    }
  }
  return null;
}

function likeMatch(pattern: string, value: string): boolean {
  const body = pattern.replaceAll("%", "*");
  const needle = body.replaceAll("*", "").toLowerCase();
  if (!needle) return true;
  return value.toLowerCase().includes(needle);
}

function matchesClause(row: OpsRow, clause: string): boolean {
  const parsed = parseClause(clause);
  if (!parsed) return false;
  const value = row[parsed.column];
  if (parsed.op === "eq") return String(value) === parsed.value;
  if (parsed.op === "ilike") return likeMatch(parsed.value, String(value ?? ""));
  if (parsed.op === "in") {
    const ids = parsed.value.replace(/^\(/, "").replace(/\)$/, "").split(",").filter(Boolean);
    return ids.includes(String(value ?? ""));
  }
  return false;
}

function knownColumns(table: string, rows: OpsRow[], schema?: Record<string, string[]>): string[] | null {
  if (schema?.[table]) return schema[table];
  const keys = new Set<string>();
  for (const row of rows) {
    for (const key of Object.keys(row)) keys.add(key);
  }
  return keys.size > 0 ? [...keys] : null;
}

function memoryDb(
  tables: Record<string, OpsRow[]>,
  schema?: Record<string, string[]>,
): OpsDb {
  return {
    async select(spec: OpsSelect) {
      if (!Object.prototype.hasOwnProperty.call(tables, spec.table)) {
        return {
          rows: [],
          count: null,
          error: { code: "PGRST205", message: `Could not find the table 'public.${spec.table}'` },
        };
      }
      const known = knownColumns(spec.table, tables[spec.table], schema);
      const requested = spec.columns === "*" ? [] : spec.columns.split(",").map((column) => column.trim());
      const used = [
        ...requested,
        ...Object.keys(spec.eq ?? {}),
        ...Object.keys(spec.gte ?? {}),
        ...Object.keys(spec.in ?? {}),
        ...Object.keys(spec.ilike ?? {}),
        ...Object.keys(spec.notEq ?? {}),
        ...(spec.notNull ?? []),
      ];
      if (known) {
        for (const column of used) {
          if (!known.includes(column)) {
            return {
              rows: [],
              count: null,
              error: { code: "PGRST204", message: `Could not find the '${column}' column` },
            };
          }
        }
      }
      if (spec.in && Object.values(spec.in).some((values) => values.length === 0)) {
        return { rows: [], count: 0, error: null };
      }
      let rows = tables[spec.table].slice();
      for (const [column, value] of Object.entries(spec.eq ?? {})) {
        rows = rows.filter((row) => row[column] === value);
      }
      for (const [column, value] of Object.entries(spec.gte ?? {})) {
        rows = rows.filter((row) => String(row[column] ?? "") >= value);
      }
      for (const [column, values] of Object.entries(spec.in ?? {})) {
        const allowed = new Set(values);
        rows = rows.filter((row) => allowed.has(String(row[column] ?? "")));
      }
      for (const [column, pattern] of Object.entries(spec.ilike ?? {})) {
        rows = rows.filter((row) => likeMatch(pattern, String(row[column] ?? "")));
      }
      if (spec.or) {
        const clauses = splitOr(spec.or);
        rows = rows.filter((row) => clauses.some((clause) => matchesClause(row, clause)));
      }
      for (const [column, value] of Object.entries(spec.notEq ?? {})) {
        rows = rows.filter((row) => {
          const current = row[column];
          if (value === "{}" && Array.isArray(current)) return current.length > 0;
          return String(current ?? "") !== value;
        });
      }
      for (const column of spec.notNull ?? []) {
        rows = rows.filter((row) => row[column] != null);
      }
      const count = rows.length;
      if (spec.order) {
        const { column, ascending } = spec.order;
        rows.sort((a, b) => {
          const left = String(a[column] ?? "");
          const right = String(b[column] ?? "");
          const cmp = left < right ? -1 : left > right ? 1 : 0;
          return ascending ? cmp : -cmp;
        });
      }
      if (spec.head) return { rows: [], count, error: null };
      const offset = spec.offset ?? 0;
      const limited = spec.limit == null ? rows.slice(offset) : rows.slice(offset, offset + spec.limit);
      return { rows: limited, count, error: null };
    },
  };
}

function catalog() {
  const tables: Record<string, OpsRow[]> = {
    profiles: [
      {
        id: "b1",
        email: "ada@brand.test",
        full_name: "Ada",
        company_name: "Ada Co",
        role: "brand",
        plan: "starter",
        created_at: "2026-11-02T01:00:00.000Z",
        is_managed: true,
      },
      {
        id: "s1",
        email: "host@show.test",
        full_name: "Host",
        company_name: "",
        role: "show",
        plan: "free",
        created_at: "2026-10-28T00:00:00.000Z",
        is_managed: false,
      },
      {
        id: "a1",
        email: "firm@agency.test",
        full_name: "Firm",
        company_name: "Firm LLC",
        role: "agency",
        plan: "operator",
        created_at: "2026-01-01T00:00:00.000Z",
        is_managed: false,
      },
      {
        id: "g1",
        email: "rep@agent.test",
        full_name: "Rep",
        company_name: "",
        role: "agent",
        plan: "pay_as_you_go",
        created_at: "2026-11-02T02:00:00.000Z",
        is_managed: false,
      },
    ],
    campaigns: [
      {
        id: "c1",
        name: "Spring",
        status: "active",
        budget_total: 1500,
        created_at: "2026-11-01T00:00:00.000Z",
        user_id: "b1",
      },
      {
        id: "c2",
        name: "Drafted",
        status: "draft",
        budget_total: 10,
        created_at: "2026-10-01T00:00:00.000Z",
        user_id: "a1",
      },
    ],
    shows: [{ id: "show1", name: "History Hour" }],
    deals: [
      {
        id: "d1",
        status: "planning",
        created_at: "2026-11-01T00:00:00.000Z",
        total_gross: 1200,
        show_id: "show1",
        brand_id: "b1",
      },
      {
        id: "d2",
        status: "completed",
        created_at: "2026-10-01T00:00:00.000Z",
        total_gross: 50,
        show_id: "show1",
        brand_id: "b1",
      },
    ],
    payments: [
      {
        id: "pay-ok",
        status: "succeeded",
        application_fee_amount_cents: 1000,
        charged_at: "2026-11-01T00:00:00.000Z",
        created_at: "2026-11-01T00:00:00.000Z",
        stripe_payment_intent_id: "pi_secret_should_not_be_read",
      },
      {
        id: "pay-old",
        status: "completed",
        application_fee_amount_cents: "500",
        charged_at: "2026-01-15T00:00:00.000Z",
        created_at: "2026-01-15T00:00:00.000Z",
      },
      {
        id: "pay-wait",
        status: "pending",
        application_fee_amount_cents: 250,
        charged_at: "2026-11-01T00:00:00.000Z",
        created_at: "2026-11-01T00:00:00.000Z",
      },
      {
        id: "pay-back",
        status: "refunded",
        application_fee_amount_cents: 50,
        charged_at: "2026-11-01T00:00:00.000Z",
        created_at: "2026-11-01T00:00:00.000Z",
      },
      {
        id: "pay-fail",
        status: "failed",
        application_fee_amount_cents: 80,
        charged_at: "2026-11-01T00:00:00.000Z",
        created_at: "2026-11-01T00:00:00.000Z",
      },
      {
        id: "pay-null",
        status: "succeeded",
        application_fee_amount_cents: null,
        charged_at: "2026-11-01T00:00:00.000Z",
        created_at: "2026-11-01T00:00:00.000Z",
      },
      {
        id: "pay-dispute",
        status: "disputed",
        application_fee_amount_cents: 25,
        charged_at: "2026-11-01T00:00:00.000Z",
        created_at: "2026-11-01T00:00:00.000Z",
      },
    ],
    youtube_channels: [
      {
        channel_id: "ch1",
        title: "Secret Title",
        created_at: "2026-11-02T03:00:00.000Z",
        passed_market_filter: true,
        contact_email: "host@youtube.test",
      },
      {
        channel_id: "ch2",
        title: "Other",
        created_at: "2026-10-28T00:00:00.000Z",
        passed_market_filter: false,
        contact_email: "",
      },
      {
        channel_id: "ch3",
        title: "Old",
        created_at: "2026-01-01T00:00:00.000Z",
        passed_market_filter: true,
        contact_email: null,
      },
    ],
    youtube_pull_queue: [
      { id: "q-pending", kind: "category_query", value: "fitness", status: "pending", attempts: 0, last_error: null, created_at: "2026-11-02T00:00:00.000Z" },
      { id: "q-done", kind: "category_query", value: "health tips", status: "done", attempts: 1, last_error: null, created_at: "2026-11-02T04:00:00.000Z" },
      {
        id: "q-error",
        kind: "seed_channel",
        value: "UCxxxx",
        status: "error",
        attempts: 3,
        last_error: "key=supersecret failed",
        created_at: "2026-11-01T00:00:00.000Z",
      },
    ],
    domain_events: [
      {
        id: "ev1",
        event_type: "payment.failed",
        entity_type: "payment",
        entity_id: "d1",
        created_at: "2026-11-02T05:00:00.000Z",
        payload: { api_key: "sk_live_abc123" },
      },
      {
        id: "ev2",
        event_type: "deal.created",
        entity_type: "deal",
        entity_id: "d1",
        created_at: "2026-11-02T06:00:00.000Z",
        payload: { note: "leave this out" },
      },
    ],
  };
  return tables;
}

function watching(tables: Record<string, OpsRow[]>, schema?: Record<string, string[]>) {
  const seen: { table: string; columns: string }[] = [];
  const insert = vi.fn();
  const inner = memoryDb(tables, schema);
  const db: OpsDb & { insert: () => void } = {
    insert,
    async select(spec) {
      seen.push({ table: spec.table, columns: spec.columns });
      return inner.select(spec);
    },
  };
  return { db, seen, insert };
}

describe("ops filters", () => {
  it("keeps an email and drops characters that would change a filter", () => {
    expect(sanitizeSearch("  chris+show@taylslate.com  ")).toBe("chris+show@taylslate.com");
    expect(sanitizeSearch("a,b(c)*'")).toBe("abc");
    expect(sanitizeSearch("x".repeat(90))).toHaveLength(80);
  });

  it("defaults the lists to active and ignores an unknown role", () => {
    expect(parseOpsFilters({})).toEqual(DEFAULT_OPS_FILTERS);
    expect(parseOpsFilters({ role: "nope", campaignStatus: "draft", dealStatus: "all" })).toMatchObject({
      role: "all",
      campaignStatus: "draft",
      dealStatus: "all",
    });
    expect(orIlike(["email", "full_name"], "ada")).toBe("email.ilike.*ada*,full_name.ilike.*ada*");
    expect(filtersToHref({ ...DEFAULT_OPS_FILTERS, role: "show", userQ: "ada" })).toBe(
      "/admin?role=show&userQ=ada",
    );
  });
});

describe("redactOpsText", () => {
  it("strips key, bearer, and provider tokens and leaves a normal sentence", () => {
    expect(redactOpsText("key=supersecret failed")).toBe("key=[redacted] failed");
    expect(redactOpsText("bearer abc.def.ghi")).toBe("bearer [redacted]");
    expect(redactOpsText("sk_live_abc123")).toBe("[redacted]");
    expect(redactOpsText("AIzaSyA1234567890abcdef")).toBe("[redacted]");
    expect(redactOpsText("download failed")).toBe("download failed");
  });
});

describe("summarizeFees", () => {
  it("counts succeeded and completed fees only, and keeps in-flight separate", () => {
    const summary = summarizeFees(catalog().payments, NOW, false);
    expect(summary.collectedCents).toBe(1500);
    expect(summary.collectedCount).toBe(3);
    expect(summary.missingFeeCount).toBe(1);
    expect(summary.last30DaysCents).toBe(1000);
    expect(summary.inFlightCents).toBe(250);
    expect(summary.inFlightCount).toBe(1);
    expect(summary.refundedCents).toBe(50);
    expect(summary.disputedCents).toBe(25);
    expect(summary.failedCount).toBe(1);
    expect(summary.truncated).toBe(false);
  });
});

describe("loadOpsDashboard", () => {
  it("reads accounts, active work, fees, youtube stats, and redacted errors", async () => {
    const { db, seen, insert } = watching(catalog());
    const data = await loadOpsDashboard(db, DEFAULT_OPS_FILTERS, NOW);
    expect(insert).not.toHaveBeenCalled();
    expect(data.accounts.counts).toEqual([
      { key: "brand", count: 1 },
      { key: "show", count: 1 },
      { key: "agency", count: 1 },
      { key: "agent", count: 1 },
    ]);
    expect(data.accounts.signups24h).toBe(2);
    expect(data.accounts.signups7d).toBe(3);
    expect(data.accounts.rows.map((row) => row.email)).toEqual([
      "rep@agent.test",
      "ada@brand.test",
      "host@show.test",
      "firm@agency.test",
    ]);
    expect(data.accounts.rows[1]?.managed).toBe(true);
    expect(data.campaigns.active).toBe(1);
    expect(data.campaigns.rows.map((row) => row.name)).toEqual(["Spring"]);
    expect(data.campaigns.rows[0]?.ownerEmail).toBe("ada@brand.test");
    expect(data.deals.active).toBe(1);
    expect(data.deals.rows.map((row) => row.status)).toEqual(["planning"]);
    expect(data.deals.rows[0]).toMatchObject({ showName: "History Hour", brandEmail: "ada@brand.test" });
    expect(data.fees.summary?.collectedCents).toBe(1500);
    expect(data.youtube.available).toBe(true);
    expect(data.youtube.total).toBe(3);
    expect(data.youtube.passedMarketFilter).toBe(2);
    expect(data.youtube.added24h).toBe(1);
    expect(data.youtube.added7d).toBe(2);
    expect(data.youtube.emails).toEqual([{ column: "contact_email", count: 1, approximate: false }]);
    expect(data.youtube.queueByStatus).toEqual([
      { key: "pending", count: 1 },
      { key: "done", count: 1 },
      { key: "error", count: 1 },
    ]);
    expect(data.activity.events.map((row) => row.eventType)).toEqual(["payment.failed"]);
    expect(data.activity.failedPayments.map((row) => row.id)).toEqual(["pay-fail"]);
    expect(data.activity.queueErrors[0]?.lastError).toBe("key=[redacted] failed");
    expect(data.activity.recentDone[0]?.value).toBe("health tips");

    const dumped = JSON.stringify(data);
    expect(dumped).not.toContain("host@youtube.test");
    expect(dumped).not.toContain("Secret Title");
    expect(dumped).not.toContain("supersecret");
    expect(dumped).not.toContain("sk_live_abc123");
    expect(dumped).not.toContain("pi_secret_should_not_be_read");
    expect(dumped).not.toContain("leave this out");
    expect(seen.filter((call) => call.table === "payments").every((call) => !call.columns.includes("stripe"))).toBe(
      true,
    );
    expect(seen.filter((call) => call.table === "domain_events").every((call) => !call.columns.includes("payload"))).toBe(
      true,
    );
    expect(seen.filter((call) => call.table === "youtube_channels").map((call) => call.columns)).not.toContain(
      "email",
    );
  });

  it("filters the lists and still counts every account", async () => {
    const { db } = watching(catalog());
    const data = await loadOpsDashboard(
      db,
      {
        ...DEFAULT_OPS_FILTERS,
        userQ: "Host",
        campaignStatus: "all",
        campaignQ: "firm",
        dealStatus: "active",
        dealQ: "history",
      },
      NOW,
    );
    expect(data.accounts.counts[0]?.count).toBe(1);
    expect(data.accounts.rows.map((row) => row.email)).toEqual(["host@show.test"]);
    expect(data.campaigns.rows.map((row) => row.name)).toEqual(["Drafted"]);
    expect(data.deals.rows.map((row) => row.showName)).toEqual(["History Hour"]);

    const missed = await loadOpsDashboard(db, { ...DEFAULT_OPS_FILTERS, dealQ: "nope" }, NOW);
    expect(missed.deals.matched).toBe(0);
    expect(missed.deals.rows).toEqual([]);
  });

  it("says when the youtube tables are missing and when no email column exists", async () => {
    const missing = catalog();
    delete missing.youtube_channels;
    delete missing.youtube_pull_queue;
    const gone = await loadOpsDashboard(memoryDb(missing), DEFAULT_OPS_FILTERS, NOW);
    expect(gone.youtube.available).toBe(false);
    expect(gone.youtube.unavailableReason).toMatch(/youtube_channels/);
    expect(gone.youtube.queueUnavailableReason).toMatch(/youtube_pull_queue/);
    expect(gone.accounts.counts).toHaveLength(4);
    expect(gone.activity.queueErrors).toEqual([]);
    expect(gone.activity.error).toBeNull();

    const empty = catalog();
    empty.youtube_channels = [];
    empty.youtube_pull_queue = [];
    const bare = await loadOpsDashboard(
      memoryDb(empty, {
        youtube_channels: ["channel_id", "created_at", "passed_market_filter", "title"],
        youtube_pull_queue: ["id", "status", "kind", "value", "attempts", "last_error", "created_at"],
      }),
      DEFAULT_OPS_FILTERS,
      NOW,
    );
    expect(bare.youtube.available).toBe(true);
    expect(bare.youtube.total).toBe(0);
    expect(bare.youtube.emailNote).toBe("No email column on youtube_channels.");
    expect(bare.youtube.emails).toEqual([]);
    expect(bare.youtube.queueByStatus.map((item) => item.count)).toEqual([0, 0, 0]);
  });
});

describe("relation errors", () => {
  it("tells a missing table from a missing column", () => {
    expect(isMissingRelation({ code: "PGRST205", message: "Could not find the table 'youtube_channels'" })).toBe(
      true,
    );
    expect(isMissingColumn({ code: "PGRST204", message: "Could not find the 'contact_email' column" })).toBe(true);
    expect(isMissingColumn({ code: "PGRST205", message: "Could not find the table 'youtube_channels'" })).toBe(
      false,
    );
  });
});

describe("ops dashboard sources", () => {
  it("does not import stripe, payouts, billing, airchecks, or the youtube puller, and does not write", () => {
    const files = [
      "lib/admin/ops-db.ts",
      "lib/admin/ops-dashboard.ts",
      "lib/admin/ops-filters.ts",
      "app/(dashboard)/admin/page.tsx",
      "app/(dashboard)/admin/ops-view.tsx",
    ];
    for (const file of files) {
      const source = readFileSync(join(process.cwd(), file), "utf8");
      expect(source).not.toMatch(/from ["']@\/lib\/(stripe|payouts|billing|airchecks|youtube-library)/);
      expect(source).not.toMatch(/\.(insert|update|delete|upsert|rpc)\(/);
      expect(source).not.toMatch(/[—–]/);
    }
  });
});
