import { beforeEach, describe, expect, it, vi } from "vitest";

interface Row {
  [key: string]: unknown;
}

interface Filter {
  kind: "eq" | "neq" | "notnull" | "isnull" | "is" | "lt" | "in" | "or";
  col?: string;
  val?: unknown;
  or?: Filter[];
}

const { tables, resetTables, selects, limits, flags, writes } = vi.hoisted(() => {
  const tables: Record<string, Row[]> = {
    airchecks: [],
    io_line_items: [],
    insertion_orders: [],
    deals: [],
  };
  const selects: string[] = [];
  const limits: number[] = [];
  const writes: { table: string; filters: Filter[]; payload: Row | null }[] = [];
  const flags: {
    claimColumnMissing: boolean;
    updateError: { message: string; code?: string } | null;
    forcePgrst116: boolean;
  } = {
    claimColumnMissing: false,
    updateError: null,
    forcePgrst116: false,
  };
  function resetTables() {
    for (const key of Object.keys(tables)) tables[key] = [];
    selects.length = 0;
    limits.length = 0;
    writes.length = 0;
    flags.claimColumnMissing = false;
    flags.updateError = null;
    flags.forcePgrst116 = false;
  }
  return { tables, resetTables, selects, limits, flags, writes };
});

function splitOr(expr: string): string[] {
  const parts: string[] = [];
  let current = "";
  let quoted = false;
  for (const ch of expr) {
    if (ch === '"') {
      quoted = !quoted;
      current += ch;
      continue;
    }
    if (ch === "," && !quoted) {
      parts.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  if (current) parts.push(current);
  return parts;
}

function parseClause(clause: string): Filter {
  const match = clause.match(/^([A-Za-z0-9_]+)\.(is|eq|neq|lt|gt|gte|lte)\.(.*)$/);
  if (!match) return { kind: "eq", col: "__none__", val: "__unparsed__" };
  const [, col, op, raw] = match;
  const quoted = raw.startsWith('"') && raw.endsWith('"');
  const val = quoted ? raw.slice(1, -1) : raw;
  if (op === "is") return { kind: "is", col, val: val === "null" ? null : val };
  if (op === "lt") return { kind: "lt", col, val };
  if (op === "neq") return { kind: "neq", col, val };
  return { kind: "eq", col, val };
}

function matches(row: Row, filters: Filter[]): boolean {
  return filters.every((filter) => {
    const col = filter.col ?? "";
    if (filter.kind === "eq") return row[col] === filter.val;
    if (filter.kind === "neq") return row[col] !== filter.val;
    if (filter.kind === "notnull") return row[col] != null;
    if (filter.kind === "isnull" || (filter.kind === "is" && filter.val === null)) {
      return row[col] == null;
    }
    if (filter.kind === "is") return row[col] === filter.val;
    if (filter.kind === "lt") {
      if (row[col] == null || filter.val == null) return false;
      return String(row[col]) < String(filter.val);
    }
    if (filter.kind === "in") return Array.isArray(filter.val) && filter.val.includes(row[col]);
    if (filter.kind === "or") return (filter.or ?? []).some((part) => matches(row, [part]));
    return true;
  });
}

vi.mock("@/lib/supabase/admin", () => {
  function makeBuilder(table: string) {
    const filters: Filter[] = [];
    let op: "select" | "update" = "select";
    let payload: Row | null = null;
    let max: number | null = null;
    let orderBy: { col: string; ascending: boolean } | null = null;

    function finish(emptyUpdateOk: boolean): {
      data: Row | Row[] | null;
      error: { message: string; code?: string } | null;
    } {
      const rows = tables[table] ?? [];
      if (op === "update") {
        writes.push({
          table,
          filters: filters.map((filter) => ({ ...filter })),
          payload: payload ? { ...payload } : null,
        });
        if (flags.forcePgrst116) {
          flags.forcePgrst116 = false;
          return {
            data: null,
            error: { message: "row count", code: "PGRST116" },
          };
        }
        if (flags.updateError) {
          const error = flags.updateError;
          flags.updateError = null;
          return { data: null, error };
        }
        if (
          flags.claimColumnMissing &&
          payload &&
          Object.prototype.hasOwnProperty.call(payload, "confirm_claimed_at")
        ) {
          return {
            data: null,
            error: {
              code: "PGRST204",
              message: "Could not find the 'confirm_claimed_at' column",
            },
          };
        }
        const index = rows.findIndex((row) => matches(row, filters));
        if (index < 0) {
          if (emptyUpdateOk) return { data: null, error: null };
          return { data: null, error: { message: "row count", code: "PGRST116" } };
        }
        rows[index] = { ...rows[index], ...payload };
        return { data: rows[index], error: null };
      }
      let found = rows.filter((row) => matches(row, filters));
      if (orderBy) {
        const { col, ascending } = orderBy;
        found = [...found].sort((a, b) => {
          const left = a[col] == null ? "" : String(a[col]);
          const right = b[col] == null ? "" : String(b[col]);
          return ascending ? left.localeCompare(right) : right.localeCompare(left);
        });
      }
      if (max != null) found = found.slice(0, max);
      return { data: found, error: null };
    }

    const builder = {
      select(columns?: string) {
        if (typeof columns === "string") selects.push(columns);
        return builder;
      },
      eq(col: string, val: unknown) {
        filters.push({ kind: "eq", col, val });
        return builder;
      },
      is(col: string, val: unknown) {
        filters.push({ kind: "is", col, val });
        return builder;
      },
      lt(col: string, val: unknown) {
        filters.push({ kind: "lt", col, val });
        return builder;
      },
      in(col: string, val: unknown[]) {
        filters.push({ kind: "in", col, val });
        return builder;
      },
      not(col: string, operator: string, val: unknown) {
        if (operator === "is" && val === null) filters.push({ kind: "notnull", col });
        return builder;
      },
      or(expr: string) {
        filters.push({ kind: "or", or: splitOr(expr).map(parseClause) });
        return builder;
      },
      order(col: string, opts?: { ascending?: boolean }) {
        orderBy = { col, ascending: opts?.ascending !== false };
        return builder;
      },
      limit(n: number) {
        max = n;
        limits.push(n);
        return builder;
      },
      update(row: Row) {
        op = "update";
        payload = { ...row };
        return builder;
      },
      maybeSingle() {
        const result = finish(true);
        const rows = Array.isArray(result.data) ? result.data : result.data ? [result.data] : [];
        if (op === "update") return Promise.resolve(result);
        return Promise.resolve({ data: rows[0] ?? null, error: result.error });
      },
      then(resolve: (value: unknown) => void, reject?: (reason: unknown) => void) {
        try {
          resolve(finish(op === "update"));
        } catch (err) {
          reject?.(err);
        }
      },
    };
    return builder;
  }

  return {
    supabaseAdmin: {
      from(table: string) {
        return makeBuilder(table);
      },
    },
  };
});

import {
  AIRCHECK_QUEUE_AIRCHECK_COLUMNS,
  AIRCHECK_QUEUE_IO_COLUMNS,
  AIRCHECK_QUEUE_LIMIT,
  AIRCHECK_QUEUE_LINE_COLUMNS,
  claimAircheckConfirm,
  loadAircheckQueue,
  releaseAircheckConfirm,
  saveAircheckConfirmedIfUndecided,
} from "./store";

const LINE = "li_1";

function aircheck(overrides: Row = {}): Row {
  return {
    id: "ac_1",
    io_line_item_id: LINE,
    status: "transcribed",
    match_result: "matched",
    confidence: 0.8,
    matched_at: "2026-11-02T00:00:00.000Z",
    charge_error: null,
    ready_for_review: true,
    review_decision: null,
    confirm_claimed_at: null,
    confirm_claimed_by: null,
    transcript_text: "do not list this",
    audio_url: "https://audio.example/secret",
    decided_by: "hidden@taylslate.com",
    ...overrides,
  };
}

beforeEach(() => {
  resetTables();
  tables.io_line_items.push({
    id: LINE,
    io_id: "io_1",
    show_name: "Huberman Lab",
    placement: "mid-roll",
  });
  tables.insertion_orders.push({ id: "io_1", advertiser_name: "Sauna Box" });
});

describe("claimAircheckConfirm", () => {
  it("lets one claim win and a second claim lose", async () => {
    tables.airchecks.push(aircheck());
    const first = await claimAircheckConfirm(LINE, "ops@taylslate.com");
    const second = await claimAircheckConfirm(LINE, "other@taylslate.com");
    expect(first?.confirm_claimed_by).toBe("ops@taylslate.com");
    expect(second).toBeNull();
    expect(tables.airchecks[0].confirm_claimed_by).toBe("ops@taylslate.com");
  });

  it("releases a claim so it can be taken again", async () => {
    tables.airchecks.push(aircheck());
    const claimed = await claimAircheckConfirm(LINE, "ops@taylslate.com");
    await releaseAircheckConfirm(LINE, String(claimed?.confirm_claimed_at));
    expect(tables.airchecks[0].confirm_claimed_at).toBeNull();
    const again = await claimAircheckConfirm(LINE, "next@taylslate.com");
    expect(again?.confirm_claimed_by).toBe("next@taylslate.com");
  });

  it("leaves the claim in place when the held time does not match", async () => {
    tables.airchecks.push(aircheck());
    const claimed = await claimAircheckConfirm(LINE, "ops@taylslate.com");
    const held = claimed?.confirm_claimed_at;
    await releaseAircheckConfirm(LINE, "2000-01-01T00:00:00.000Z");
    expect(tables.airchecks[0].confirm_claimed_at).toBe(held);
    expect(tables.airchecks[0].confirm_claimed_by).toBe("ops@taylslate.com");
  });

  it("reclaims a stale claim and leaves a fresh claim alone", async () => {
    tables.airchecks.push(
      aircheck({
        confirm_claimed_at: new Date(Date.now() - 6 * 60 * 1000).toISOString(),
        confirm_claimed_by: "old@taylslate.com",
      })
    );
    const reclaimed = await claimAircheckConfirm(LINE, "ops@taylslate.com");
    expect(reclaimed?.confirm_claimed_by).toBe("ops@taylslate.com");

    tables.airchecks[0].confirm_claimed_at = new Date().toISOString();
    tables.airchecks[0].confirm_claimed_by = "fresh@taylslate.com";
    const blocked = await claimAircheckConfirm(LINE, "ops@taylslate.com");
    expect(blocked).toBeNull();
    expect(tables.airchecks[0].confirm_claimed_by).toBe("fresh@taylslate.com");
  });

  it("does not claim a row that already has a decision", async () => {
    tables.airchecks.push(aircheck({ review_decision: "rejected" }));
    const claimed = await claimAircheckConfirm(LINE, "ops@taylslate.com");
    expect(claimed).toBeNull();
    expect(tables.airchecks[0].confirm_claimed_at).toBeNull();
  });

  it("throws when the claim column is missing and does not write the row", async () => {
    tables.airchecks.push(aircheck());
    flags.claimColumnMissing = true;
    await expect(claimAircheckConfirm(LINE, "ops@taylslate.com")).rejects.toThrow(
      /migration 080/
    );
    expect(tables.airchecks[0].confirm_claimed_by).toBeNull();
  });
});

describe("saveAircheckConfirmedIfUndecided", () => {
  it("guards on an undecided row, returns null when nothing changes, and throws a plain Error otherwise", async () => {
    tables.airchecks.push(aircheck());
    const saved = await saveAircheckConfirmedIfUndecided(LINE, {
      review_decision: "confirmed",
      charge_error: null,
    });
    expect(saved?.review_decision).toBe("confirmed");
    const write = writes.find(
      (entry) => entry.payload?.review_decision === "confirmed"
    );
    expect(write?.filters).toEqual(
      expect.arrayContaining([
        { kind: "eq", col: "io_line_item_id", val: LINE },
        { kind: "is", col: "review_decision", val: null },
      ])
    );
    expect(selects).toContain("*");

    tables.airchecks[0].review_decision = "rejected";
    const missed = await saveAircheckConfirmedIfUndecided(LINE, {
      review_decision: "confirmed",
    });
    expect(missed).toBeNull();
    expect(tables.airchecks[0].review_decision).toBe("rejected");

    flags.forcePgrst116 = true;
    const raced = await saveAircheckConfirmedIfUndecided(LINE, {
      review_decision: "confirmed",
    });
    expect(raced).toBeNull();
    expect(tables.airchecks[0].review_decision).toBe("rejected");

    flags.updateError = { message: "connection reset", code: "08006" };
    try {
      await saveAircheckConfirmedIfUndecided(LINE, {
        review_decision: "confirmed",
      });
      expect.fail("expected a plain Error");
    } catch (err) {
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).constructor).toBe(Error);
      expect((err as Error).message).toBe(
        "aircheck review save failed: connection reset"
      );
    }
    expect(tables.airchecks[0].review_decision).toBe("rejected");
  });
});

describe("loadAircheckQueue", () => {
  it("lists ready rows and charge-failed rows and nothing else", async () => {
    tables.airchecks.push(
      aircheck({
        id: "newer",
        io_line_item_id: "li_new",
        matched_at: "2026-11-10T00:00:00.000Z",
      }),
      aircheck({
        id: "older",
        io_line_item_id: "li_old",
        matched_at: "2026-11-01T00:00:00.000Z",
      }),
      aircheck({
        id: "decided",
        io_line_item_id: "li_done",
        review_decision: "confirmed",
        matched_at: "2026-11-11T00:00:00.000Z",
      }),
      aircheck({
        id: "failed_charge",
        io_line_item_id: "li_fail",
        ready_for_review: false,
        charge_error: "card declined",
        matched_at: "2026-11-08T00:00:00.000Z",
      }),
      aircheck({
        id: "idle",
        io_line_item_id: "li_idle",
        ready_for_review: false,
        charge_error: null,
        match_result: null,
      })
    );
    tables.io_line_items.push(
      { id: "li_new", io_id: "io_1", show_name: "Newer Show", placement: "pre-roll" },
      { id: "li_old", io_id: "io_1", show_name: "Older Show", placement: "post-roll" },
      { id: "li_fail", io_id: "io_1", show_name: "Failed Show", placement: "mid-roll" }
    );

    const queue = await loadAircheckQueue();
    expect(queue.ready.map((row) => row.id)).toEqual(["newer", "older"]);
    expect(queue.chargeFailed.map((row) => row.id)).toEqual(["failed_charge"]);
    expect(queue.ready[0]).toMatchObject({
      showName: "Newer Show",
      advertiserName: "Sauna Box",
      placement: "pre-roll",
      matchResult: "matched",
      confidence: 0.8,
    });
    expect(JSON.stringify(queue)).not.toMatch(/do not list this|audio\.example|hidden@taylslate/);
    expect(selects).toContain(AIRCHECK_QUEUE_AIRCHECK_COLUMNS);
    expect(selects).toContain(AIRCHECK_QUEUE_LINE_COLUMNS);
    expect(selects).toContain(AIRCHECK_QUEUE_IO_COLUMNS);
    expect(selects.join("\n")).not.toMatch(/transcript_text|audio_url|decided_by/);
    expect(limits).toContain(AIRCHECK_QUEUE_LIMIT);
  });
});
