import { beforeEach, describe, expect, it, vi } from "vitest";

const recordDeliveryOutcome = vi.fn();
const chargeForEpisode = vi.fn();
const logEvent = vi.fn();
const from = vi.fn();

vi.mock("@/lib/deal-records", () => ({
  recordDeliveryOutcome: (...args: unknown[]) => recordDeliveryOutcome(...args),
}));
vi.mock("@/lib/stripe/payment-intent", () => ({
  chargeForEpisode: (...args: unknown[]) => chargeForEpisode(...args),
}));
vi.mock("@/lib/data/events", () => ({
  logEvent: (...args: unknown[]) => logEvent(...args),
}));
vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: { from: (...args: unknown[]) => from(...args) },
}));

import { deliverAndChargeLine } from "@/lib/delivery/mark-delivered";

function chain(row: unknown) {
  const builder: {
    select: ReturnType<typeof vi.fn>;
    eq: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    single: ReturnType<typeof vi.fn>;
    then: (resolve: (value: { error: null }) => unknown) => Promise<unknown>;
  } = {
    select: vi.fn(),
    eq: vi.fn(),
    update: vi.fn(),
    single: vi.fn().mockResolvedValue({ data: row, error: null }),
    then: (resolve) => Promise.resolve({ error: null }).then(resolve),
  };
  builder.select.mockReturnValue(builder);
  builder.eq.mockReturnValue(builder);
  builder.update.mockReturnValue(builder);
  return builder;
}

beforeEach(() => {
  vi.clearAllMocks();
  from.mockImplementation((table: string) => {
    if (table === "io_line_items") {
      return chain({
        id: "line-1",
        io_id: "io-1",
        verified: false,
        actual_post_date: null,
        actual_downloads: null,
      });
    }
    return chain({ id: "io-1", deal_id: "deal-1" });
  });
  chargeForEpisode.mockResolvedValue({ status: "succeeded" });
  logEvent.mockResolvedValue(null);
  recordDeliveryOutcome.mockResolvedValue(undefined);
});

describe("deliverAndChargeLine price record hook", () => {
  it("records delivery only after the charge succeeds", async () => {
    const result = await deliverAndChargeLine({
      ioLineItemId: "line-1",
      actualDownloads: 9000,
    });
    expect(result.ok).toBe(true);
    expect(chargeForEpisode).toHaveBeenCalledWith({
      dealId: "deal-1",
      ioLineItemId: "line-1",
    });
    expect(recordDeliveryOutcome).toHaveBeenCalledWith("deal-1");
  });

  it("does not record delivery when the charge fails", async () => {
    chargeForEpisode.mockRejectedValue(new Error("card declined"));
    const result = await deliverAndChargeLine({ ioLineItemId: "line-1" });
    expect(result.ok).toBe(false);
    expect(recordDeliveryOutcome).not.toHaveBeenCalled();
  });

  it("still returns the charge when the outcome write throws", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    recordDeliveryOutcome.mockRejectedValue(new Error("secret@example.com relation missing"));
    const result = await deliverAndChargeLine({ ioLineItemId: "line-1" });
    expect(result.ok).toBe(true);
    const text = logged.mock.calls.map((call) => call.map(String).join(" ")).join("\n");
    expect(text).not.toMatch(/secret@example.com|relation missing/);
    logged.mockRestore();
  });
});
