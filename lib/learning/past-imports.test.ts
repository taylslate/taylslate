import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: { from: vi.fn() },
}));

import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  loadConfirmedImportRecords,
  loadImportSignalsByShow,
} from "./past-imports";

interface ImportRow {
  id: string;
  brand_id: string;
  status: string;
  pooling_consent: boolean;
}

interface RecordRow {
  id: string;
  import_id: string;
  brand_id: string;
  show_name: string;
  matched_show_id: string | null;
  placement: string | null;
  price_type: string | null;
  spend: number | null;
  conversions: number | null;
  downloads: number | null;
}

interface QueryFilter {
  column: string;
  op: "eq" | "in";
  value: unknown;
}

function fakeAdmin(
  db: { imports: ImportRow[]; records: RecordRow[] },
  options: { leak?: boolean; error?: string } = {}
): {
  admin: (table: string) => unknown;
  queries: { table: string; filters: QueryFilter[] }[];
} {
  const queries: { table: string; filters: QueryFilter[] }[] = [];
  const admin = (table: string) => {
    const filters: QueryFilter[] = [];
    queries.push({ table, filters });
    const run = () => {
      if (options.error) return { data: null, error: { message: options.error } };
      const eq = (column: string) =>
        filters.find((filter) => filter.op === "eq" && filter.column === column)?.value;
      const inn = (column: string) =>
        filters.find((filter) => filter.op === "in" && filter.column === column)?.value as
          | string[]
          | undefined;
      if (table === "past_campaign_imports") {
        const rows = options.leak
          ? db.imports
          : db.imports.filter((row) => {
              const brand = eq("brand_id");
              const status = eq("status");
              if (brand != null && row.brand_id !== brand) return false;
              if (status != null && row.status !== status) return false;
              return true;
            });
        return { data: rows, error: null };
      }
      if (table === "past_campaign_records") {
        const rows = options.leak
          ? db.records
          : db.records.filter((row) => {
              const brand = eq("brand_id");
              if (brand != null && row.brand_id !== brand) return false;
              const importIds = inn("import_id");
              if (importIds && !importIds.includes(row.import_id)) return false;
              const showIds = inn("matched_show_id");
              if (
                showIds &&
                (row.matched_show_id == null || !showIds.includes(row.matched_show_id))
              ) {
                return false;
              }
              return true;
            });
        return { data: rows, error: null };
      }
      return { data: null, error: { message: `unexpected table ${table}` } };
    };
    const builder = {
      select: () => builder,
      eq: (column: string, value: unknown) => {
        filters.push({ column, op: "eq" as const, value });
        return builder;
      },
      in: (column: string, value: unknown) => {
        filters.push({ column, op: "in" as const, value });
        return builder;
      },
      then: (
        resolve: (value: { data: unknown; error: { message: string } | null }) => unknown,
        reject?: (reason: unknown) => unknown
      ) => Promise.resolve(run()).then(resolve, reject),
    };
    return builder;
  };
  return { admin, queries };
}

const db = {
  imports: [
    { id: "imp-a", brand_id: "brand-a", status: "confirmed", pooling_consent: false },
    { id: "imp-a-parsed", brand_id: "brand-a", status: "parsed", pooling_consent: true },
    { id: "imp-b", brand_id: "brand-b", status: "confirmed", pooling_consent: true },
  ] satisfies ImportRow[],
  records: [
    {
      id: "rec-a1",
      import_id: "imp-a",
      brand_id: "brand-a",
      show_name: "Shared Show",
      matched_show_id: "show-s",
      placement: "mid-roll",
      price_type: "cpm",
      spend: 400,
      conversions: 4,
      downloads: 2000,
    },
    {
      id: "rec-a2",
      import_id: "imp-a",
      brand_id: "brand-a",
      show_name: "Shared Show",
      matched_show_id: "show-s",
      placement: "pre-roll",
      price_type: "cpm",
      spend: 100,
      conversions: null,
      downloads: 500,
    },
    {
      id: "rec-a-parsed",
      import_id: "imp-a-parsed",
      brand_id: "brand-a",
      show_name: "Shared Show",
      matched_show_id: "show-s",
      placement: "mid-roll",
      price_type: "cpm",
      spend: 999,
      conversions: 99,
      downloads: 999,
    },
    {
      id: "rec-a-open",
      import_id: "imp-a",
      brand_id: "brand-a",
      show_name: "No Match",
      matched_show_id: null,
      placement: null,
      price_type: null,
      spend: 20,
      conversions: 1,
      downloads: 100,
    },
    {
      id: "rec-b",
      import_id: "imp-b",
      brand_id: "brand-b",
      show_name: "Shared Show",
      matched_show_id: "show-s",
      placement: "mid-roll",
      price_type: "cpm",
      spend: 50,
      conversions: 7,
      downloads: 700,
    },
  ] satisfies RecordRow[],
};

describe("loadImportSignalsByShow", () => {
  beforeEach(() => {
    vi.mocked(supabaseAdmin.from).mockReset();
  });

  it("returns an empty map and does not query when the brand id is blank", async () => {
    const totals = await loadImportSignalsByShow(["show-s"], "  ");
    expect(totals.size).toBe(0);
    expect(supabaseAdmin.from).not.toHaveBeenCalled();
  });

  it("sums only this brand's confirmed matches, including rows without pooling consent", async () => {
    const { admin, queries } = fakeAdmin(db);
    vi.mocked(supabaseAdmin.from).mockImplementation(admin as never);

    const brandA = await loadImportSignalsByShow(["show-s", "show-other"], "brand-a");
    const brandB = await loadImportSignalsByShow(["show-s"], "brand-b");

    expect(brandA.get("show-s")).toEqual({
      records: 2,
      conversions: 4,
      spend: 500,
      downloads: 2500,
    });
    expect(brandA.has("show-other")).toBe(false);
    expect(brandB.get("show-s")).toEqual({
      records: 1,
      conversions: 7,
      spend: 50,
      downloads: 700,
    });
    expect(brandB.get("show-s")?.conversions).not.toBe(4);

    expect(
      queries.some(
        (query) =>
          query.table === "past_campaign_records" &&
          query.filters.some(
            (filter) => filter.op === "eq" && filter.column === "brand_id" && filter.value === "brand-b"
          )
      )
    ).toBe(true);
    expect(
      queries.some(
        (query) =>
          query.table === "past_campaign_imports" &&
          query.filters.some(
            (filter) => filter.op === "eq" && filter.column === "status" && filter.value === "confirmed"
          )
      )
    ).toBe(true);
  });

  it("drops another brand's rows even when the query returns them", async () => {
    const { admin } = fakeAdmin(db, { leak: true });
    vi.mocked(supabaseAdmin.from).mockImplementation(admin as never);
    const brandB = await loadImportSignalsByShow(["show-s"], "brand-b");
    expect(brandB.get("show-s")?.conversions).toBe(7);
    expect(brandB.get("show-s")?.records).toBe(1);
  });

  it("returns an empty map when the read fails", async () => {
    const { admin } = fakeAdmin(db, { error: "relation does not exist" });
    vi.mocked(supabaseAdmin.from).mockImplementation(admin as never);
    await expect(loadImportSignalsByShow(["show-s"], "brand-a")).resolves.toEqual(new Map());
  });
});

describe("loadConfirmedImportRecords", () => {
  beforeEach(() => {
    vi.mocked(supabaseAdmin.from).mockReset();
  });

  it("returns this brand's confirmed rows, including an unmatched show name", async () => {
    const { admin } = fakeAdmin(db);
    vi.mocked(supabaseAdmin.from).mockImplementation(admin as never);
    const rows = await loadConfirmedImportRecords("brand-a");
    expect(rows.map((row) => row.id).sort()).toEqual(["rec-a-open", "rec-a1", "rec-a2"]);
    expect(rows.find((row) => row.id === "rec-a-open")?.matchedShowId).toBeNull();
    expect(rows.some((row) => row.id === "rec-b" || row.id === "rec-a-parsed")).toBe(false);
  });

  it("returns an empty list for a blank brand id", async () => {
    await expect(loadConfirmedImportRecords("")).resolves.toEqual([]);
    expect(supabaseAdmin.from).not.toHaveBeenCalled();
  });
});

describe("past import loader source", () => {
  it("does not mention podscan or an em dash", () => {
    const src = readFileSync(join(process.cwd(), "lib/learning/past-imports.ts"), "utf8");
    expect(src).not.toContain("podscan_id");
    expect(src).not.toContain("\u2014");
    expect(src).toContain('.eq("brand_id", brandId)');
    expect(src).toContain('.eq("status", "confirmed")');
  });
});
