import { beforeEach, describe, expect, it, vi } from "vitest";

const recordMakeGoodOutcome = vi.fn();
const logEvent = vi.fn();
const from = vi.fn();

vi.mock("@/lib/deal-records", () => ({
  recordMakeGoodOutcome: (...args: unknown[]) => recordMakeGoodOutcome(...args),
}));
vi.mock("@/lib/data/events", () => ({
  logEvent: (...args: unknown[]) => logEvent(...args),
}));
vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: { from: (...args: unknown[]) => from(...args) },
}));

import { approveMakeGood } from "@/lib/make-goods/decide";

const proposed = {
  id: "mg-1",
  deal_id: "deal-1",
  io_id: "io-1",
  io_line_item_id: "line-1",
  aircheck_id: null,
  show_id: "show-1",
  kind: "short",
  status: "proposed",
  delivery_state: "pending_approval",
  reason: "Short of the guarantee.",
  show_name: "Daily Brief",
  placement: "mid-roll",
  post_date: "2026-06-01",
  guaranteed_downloads: 10000,
  actual_downloads: 5000,
  shortfall_pct: 0.5,
  threshold: 0.1,
  options: [{ id: "credit_shortfall", label: "Credit", summary: "Credit the shortfall." }],
  selected_option: null,
  amended_terms: "",
  credit_amount: null,
  replacement_line_item_id: null,
  replacement_post_date: null,
  decided_by: null,
  decided_at: null,
  created_at: "2026-06-02T00:00:00.000Z",
  updated_at: "2026-06-02T00:00:00.000Z",
};

function chain(row: unknown) {
  const builder = {
    select: vi.fn(),
    eq: vi.fn(),
    update: vi.fn(),
    maybeSingle: vi.fn().mockResolvedValue({ data: row, error: null }),
  };
  builder.select.mockReturnValue(builder);
  builder.eq.mockReturnValue(builder);
  builder.update.mockReturnValue(builder);
  return builder;
}

beforeEach(() => {
  vi.clearAllMocks();
  logEvent.mockResolvedValue(null);
  recordMakeGoodOutcome.mockResolvedValue(undefined);
  let makeGoods = 0;
  from.mockImplementation((table: string) => {
    if (table === "make_goods") {
      makeGoods += 1;
      if (makeGoods === 1) return chain(proposed);
      return chain({
        ...proposed,
        status: "approved",
        delivery_state: "credited",
        selected_option: "credit_shortfall",
        credit_amount: 50,
      });
    }
    if (table === "insertion_orders") {
      return chain({
        id: "io-1",
        deal_id: "deal-1",
        io_number: "IO-DEAL-1",
        advertiser_name: "Acme",
        total_downloads: 10000,
      });
    }
    if (table === "io_line_items") {
      return chain({
        id: "line-1",
        io_id: "io-1",
        format: "podcast",
        post_date: "2026-06-01",
        guaranteed_downloads: 10000,
        show_name: "Daily Brief",
        placement: "mid-roll",
        is_scripted: false,
        is_personal_experience: false,
        reader_type: "host_read",
        content_type: "evergreen",
        pixel_required: false,
        price_type: "cpm",
        spot_format: null,
        gross_cpm: 25,
        gross_rate: 250,
        net_due: 250,
      });
    }
    return chain({ id: "deal-1", status: "show_signed" });
  });
});

describe("approveMakeGood price record hook", () => {
  it("still approves when the outcome write throws", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    recordMakeGoodOutcome.mockRejectedValue(new Error("secret@example.com"));
    const result = await approveMakeGood({
      dealId: "deal-1",
      makeGoodId: "mg-1",
      optionId: "credit_shortfall",
      actorId: "brand-1",
    });
    expect(result.ok).toBe(true);
    expect(recordMakeGoodOutcome).toHaveBeenCalledWith("deal-1");
    const text = logged.mock.calls.map((call) => call.map(String).join(" ")).join("\n");
    expect(text).not.toMatch(/secret@example.com/);
    logged.mockRestore();
  });
});
