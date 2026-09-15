import { describe, it, expect, vi, beforeEach } from "vitest";

// Scripted supabase mock: each from(table) call consumes the next script
// entry (table asserted) and returns a thenable chain that records every
// method call and resolves to the scripted result. This mirrors how
// persist-io awaits builders mid-chain (.maybeSingle(), .limit(), .select()).
type ScriptEntry = { table: string; result: { data?: unknown; error?: unknown } };
type CallRecord = { table: string; ops: Array<[string, unknown[]]> };

const { supabaseAdmin, logEvent, script, calls } = vi.hoisted(() => {
  const script: ScriptEntry[] = [];
  const calls: CallRecord[] = [];
  const supabaseAdmin = {
    from: vi.fn((table: string) => {
      const entry = script.shift();
      if (!entry) throw new Error(`unscripted from("${table}")`);
      if (entry.table !== table) {
        throw new Error(`expected from("${entry.table}"), got from("${table}")`);
      }
      const record: CallRecord = { table, ops: [] };
      calls.push(record);
      const chain: Record<string, unknown> = {};
      for (const m of [
        "select",
        "eq",
        "in",
        "limit",
        "insert",
        "delete",
        "update",
        "maybeSingle",
        "single",
      ]) {
        chain[m] = (...args: unknown[]) => {
          record.ops.push([m, args]);
          return chain;
        };
      }
      chain.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
        Promise.resolve(entry.result).then(res, rej);
      return chain;
    }),
  };
  return {
    supabaseAdmin,
    logEvent: vi.fn().mockResolvedValue(null),
    script,
    calls,
  };
});

vi.mock("@/lib/supabase/admin", () => ({ supabaseAdmin }));
vi.mock("@/lib/data/events", () => ({
  logEvent: (...a: unknown[]) => logEvent(...a),
}));

import { persistIoForDeal, type PersistIoInput } from "./persist-io";
import type { IoLineItemDraft } from "@/lib/pdf/io-generator";

function drafts(n = 3, over: Partial<IoLineItemDraft> = {}): IoLineItemDraft[] {
  return Array.from({ length: n }, (_, i) => ({
    format: "podcast" as const,
    post_date: `2026-09-${String(10 + i).padStart(2, "0")}`,
    guaranteed_downloads: 90_000,
    show_name: "Blurry Creatures",
    placement: "mid-roll" as const,
    is_scripted: false,
    is_personal_experience: false,
    reader_type: "host_read" as const,
    content_type: "evergreen" as const,
    pixel_required: false,
    gross_rate: 2250,
    gross_cpm: 25,
    price_type: "cpm" as const,
    net_due: 2250,
    verified: false,
    make_good_triggered: false,
    ...over,
  }));
}

function input(lineItems = drafts()): PersistIoInput {
  return {
    dealId: "deal-1",
    rendered: {
      ioNumber: "IO-DEAL0001",
      totalGross: 6750,
      totalNet: 6750,
      totalDownloads: 270_000,
      lineItems,
    },
    contacts: {
      advertiserName: "Acme Co",
      advertiserContactEmail: "brand@x.com",
      publisherName: "Blurry Creatures",
      publisherContactName: "Show Owner",
      publisherContactEmail: "show@x.com",
    },
    actorId: "u1",
  };
}

const opNames = (c: CallRecord) => c.ops.map(([m]) => m);
const opArgs = (c: CallRecord, m: string) => c.ops.find(([n]) => n === m)?.[1];

beforeEach(() => {
  vi.clearAllMocks();
  script.length = 0;
  calls.length = 0;
});

describe("persistIoForDeal — guards (block at send, not at charge)", () => {
  it("rejects an empty line-item set without touching the DB", async () => {
    await expect(persistIoForDeal(input([]))).rejects.toThrow(/no line items/);
    expect(supabaseAdmin.from).not.toHaveBeenCalled();
  });

  it("rejects missing post dates without touching the DB", async () => {
    const li = drafts();
    li[1] = { ...li[1], post_date: null };
    await expect(persistIoForDeal(input(li))).rejects.toThrow(/post dates/);
    expect(supabaseAdmin.from).not.toHaveBeenCalled();
  });

  it("rejects $0 line items (missing audience_size) without touching the DB", async () => {
    await expect(
      persistIoForDeal(input(drafts(3, { gross_rate: 0, net_due: 0 })))
    ).rejects.toThrow(/\$0 line items/);
    expect(supabaseAdmin.from).not.toHaveBeenCalled();
  });
});

describe("persistIoForDeal — fresh insert", () => {
  it("inserts the IO then all line items, fires io.persisted", async () => {
    script.push(
      { table: "insertion_orders", result: { data: null, error: null } },
      { table: "insertion_orders", result: { data: { id: "io-1" }, error: null } },
      {
        table: "io_line_items",
        result: { data: [{ id: "a" }, { id: "b" }, { id: "c" }], error: null },
      }
    );
    const res = await persistIoForDeal(input());
    expect(res).toEqual({
      ioId: "io-1",
      ioNumber: "IO-DEAL0001",
      created: true,
      repaired: false,
      lineItemCount: 3,
    });
    const ioInsert = opArgs(calls[1], "insert")?.[0] as Record<string, unknown>;
    expect(ioInsert).toMatchObject({
      io_number: "IO-DEAL0001",
      deal_id: "deal-1",
      status: "sent",
      total_gross: 6750,
      publisher_contact_email: "show@x.com",
    });
    const liInsert = opArgs(calls[2], "insert")?.[0] as Array<Record<string, unknown>>;
    expect(liInsert).toHaveLength(3);
    expect(liInsert[0]).toMatchObject({ io_id: "io-1", gross_rate: 2250 });
    expect(logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "io.persisted",
        entityId: "deal-1",
        payload: expect.objectContaining({ repaired: false, line_item_count: 3 }),
      })
    );
  });

  it("applies backfill overrides for status/sent_at/signed_at", async () => {
    script.push(
      { table: "insertion_orders", result: { data: null, error: null } },
      { table: "insertion_orders", result: { data: { id: "io-1" }, error: null } },
      {
        table: "io_line_items",
        result: { data: [{ id: "a" }, { id: "b" }, { id: "c" }], error: null },
      }
    );
    await persistIoForDeal({
      ...input(),
      source: "backfill",
      overrides: {
        status: "signed",
        sentAt: "2026-09-02T23:34:29Z",
        signedAt: "2026-09-03T00:00:11Z",
      },
    });
    const ioInsert = opArgs(calls[1], "insert")?.[0] as Record<string, unknown>;
    expect(ioInsert).toMatchObject({
      status: "signed",
      sent_at: "2026-09-02T23:34:29Z",
      signed_at: "2026-09-03T00:00:11Z",
    });
    expect(logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({ source: "backfill" }),
      })
    );
  });

  it("cleans up the header row and throws when line-item insert is partial", async () => {
    script.push(
      { table: "insertion_orders", result: { data: null, error: null } },
      { table: "insertion_orders", result: { data: { id: "io-1" }, error: null } },
      { table: "io_line_items", result: { data: [{ id: "a" }], error: null } },
      { table: "insertion_orders", result: { data: null, error: null } }
    );
    await expect(persistIoForDeal(input())).rejects.toThrow(/1\/3/);
    expect(opNames(calls[3])).toContain("delete");
    expect(opArgs(calls[3], "eq")).toEqual(["id", "io-1"]);
    expect(logEvent).not.toHaveBeenCalled();
  });

  it("treats a 23505 io_number race as terminal success — refetch, NO repair", async () => {
    script.push(
      { table: "insertion_orders", result: { data: null, error: null } },
      {
        table: "insertion_orders",
        result: { data: null, error: { code: "23505", message: "duplicate" } },
      },
      {
        table: "insertion_orders",
        result: { data: { id: "io-winner", deal_id: "deal-1" }, error: null },
      }
    );
    const res = await persistIoForDeal(input());
    expect(res).toMatchObject({ ioId: "io-winner", created: false, repaired: false });
    // The loser must never inspect or rewrite the winner's (possibly
    // mid-insert) line items.
    expect(calls.map((c) => c.table)).toEqual([
      "insertion_orders",
      "insertion_orders",
      "insertion_orders",
    ]);
  });

  it("fails loudly on a cross-deal io_number collision", async () => {
    script.push({
      table: "insertion_orders",
      result: { data: { id: "io-x", deal_id: "someone-else" }, error: null },
    });
    await expect(persistIoForDeal(input())).rejects.toThrow(/collision/);
  });
});

describe("persistIoForDeal — reconcile existing", () => {
  const existing = { table: "insertion_orders", result: { data: { id: "io-1", deal_id: "deal-1" }, error: null } };

  it("is a no-op when the line-item count already matches", async () => {
    script.push(existing, {
      table: "io_line_items",
      result: {
        data: [
          { id: "a", verified: false },
          { id: "b", verified: false },
          { id: "c", verified: false },
        ],
        error: null,
      },
    });
    const res = await persistIoForDeal(input());
    expect(res).toMatchObject({ ioId: "io-1", created: false, repaired: false, lineItemCount: 3 });
    expect(logEvent).not.toHaveBeenCalled();
  });

  it("repairs a zero-item IO without reference checks or deletes", async () => {
    script.push(
      existing,
      { table: "io_line_items", result: { data: [], error: null } },
      {
        table: "io_line_items",
        result: { data: [{ id: "a" }, { id: "b" }, { id: "c" }], error: null },
      }
    );
    const res = await persistIoForDeal(input());
    expect(res).toMatchObject({ repaired: true, lineItemCount: 3 });
    // No items existed → nothing to guard, nothing to delete.
    expect(calls).toHaveLength(3);
    expect(opNames(calls[2])).toContain("insert");
    expect(logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "io.persisted",
        payload: expect.objectContaining({ repaired: true }),
      })
    );
  });

  it("repairs a wrong-count IO when nothing references the items", async () => {
    script.push(
      existing,
      {
        table: "io_line_items",
        result: {
          data: [
            { id: "a", verified: false },
            { id: "b", verified: false },
          ],
          error: null,
        },
      },
      { table: "payments", result: { data: [], error: null } },
      { table: "invoice_line_items", result: { data: [], error: null } },
      { table: "io_line_items", result: { data: null, error: null } }, // delete
      {
        table: "io_line_items",
        result: { data: [{ id: "a" }, { id: "b" }, { id: "c" }], error: null },
      }
    );
    const res = await persistIoForDeal(input());
    expect(res).toMatchObject({ repaired: true, lineItemCount: 3 });
    expect(opNames(calls[4])).toContain("delete");
  });

  it("skips repair when a payment references an UNVERIFIED item (chargeForEpisode never checks verified)", async () => {
    script.push(
      existing,
      {
        table: "io_line_items",
        result: { data: [{ id: "a", verified: false }], error: null },
      },
      { table: "payments", result: { data: [{ id: "p1" }], error: null } }
    );
    const res = await persistIoForDeal(input());
    expect(res).toMatchObject({ repaired: false, lineItemCount: 1 });
    expect(logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "io.repair_skipped",
        payload: expect.objectContaining({ blocked_by: "payments_reference" }),
      })
    );
  });

  it("skips repair when any item is verified, without querying references", async () => {
    script.push(existing, {
      table: "io_line_items",
      result: { data: [{ id: "a", verified: true }], error: null },
    });
    const res = await persistIoForDeal(input());
    expect(res).toMatchObject({ repaired: false });
    expect(calls).toHaveLength(2);
    expect(logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "io.repair_skipped",
        payload: expect.objectContaining({ blocked_by: "verified_line_items" }),
      })
    );
  });

  it("skips repair when an invoice references an item", async () => {
    script.push(
      existing,
      {
        table: "io_line_items",
        result: { data: [{ id: "a", verified: false }], error: null },
      },
      { table: "payments", result: { data: [], error: null } },
      { table: "invoice_line_items", result: { data: [{ id: "inv1" }], error: null } }
    );
    const res = await persistIoForDeal(input());
    expect(res).toMatchObject({ repaired: false });
    expect(logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({ blocked_by: "invoice_reference" }),
      })
    );
  });

  it("aborts when a reference check itself fails (cannot prove repair is safe)", async () => {
    script.push(
      existing,
      {
        table: "io_line_items",
        result: { data: [{ id: "a", verified: false }], error: null },
      },
      { table: "payments", result: { data: null, error: { message: "boom" } } }
    );
    await expect(persistIoForDeal(input())).rejects.toThrow(/reference check failed/);
  });
});
