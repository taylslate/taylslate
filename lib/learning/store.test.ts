import { beforeEach, describe, expect, it, vi } from "vitest";

const recordReportedConversions = vi.fn();
const logEvent = vi.fn();
const upsert = vi.fn();
const remove = vi.fn();

vi.mock("@/lib/deal-records", () => ({
  recordReportedConversions: (...args: unknown[]) => recordReportedConversions(...args),
}));
vi.mock("@/lib/data/events", () => ({
  logEvent: (...args: unknown[]) => logEvent(...args),
}));
vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: {
    from: () => ({
      upsert: (...args: unknown[]) => upsert(...args),
      delete: () => ({
        eq: () => ({
          eq: (...args: unknown[]) => remove(...args),
        }),
      }),
    }),
  },
}));

import { clearConversionReport, saveConversionReport } from "@/lib/learning/store";

beforeEach(() => {
  vi.clearAllMocks();
  upsert.mockResolvedValue({ error: null });
  remove.mockResolvedValue({ error: null });
  logEvent.mockResolvedValue(null);
  recordReportedConversions.mockResolvedValue(undefined);
});

describe("conversion store price record hook", () => {
  it("copies the reported count after the report is saved", async () => {
    await saveConversionReport({
      campaignId: "camp-1",
      dealId: "deal-1",
      conversions: 6,
      reportedBy: "brand-1",
    });
    expect(recordReportedConversions).toHaveBeenCalledWith("deal-1", 6);
  });

  it("clears the reported count", async () => {
    await clearConversionReport({
      campaignId: "camp-1",
      dealId: "deal-1",
      actorId: "brand-1",
    });
    expect(recordReportedConversions).toHaveBeenCalledWith("deal-1", null);
  });

  it("keeps the saved report when the price record write throws", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    recordReportedConversions.mockRejectedValue(new Error("secret@example.com"));
    await expect(
      saveConversionReport({
        campaignId: "camp-1",
        dealId: "deal-1",
        conversions: 6,
        reportedBy: "brand-1",
      })
    ).resolves.toBeUndefined();
    const text = logged.mock.calls.map((call) => call.map(String).join(" ")).join("\n");
    expect(text).not.toMatch(/secret@example.com/);
    logged.mockRestore();
  });
});
