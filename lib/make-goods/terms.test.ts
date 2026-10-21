import { describe, expect, it } from "vitest";
import { creditAmount, draftAmendedTerms, optionsForKind, replacementPostDate } from "./terms";

const context = {
  ioNumber: "IO-2026-0048",
  advertiserName: "Sauna Box",
  showId: "show_1",
  line: {
    showName: "Huberman Lab",
    placement: "mid-roll",
    postDate: "2026-08-01",
    guaranteedDownloads: 10000,
    actualDownloads: 8000,
    priceType: "cpm",
    grossCpm: 25,
    grossRate: 250,
    netDue: 250,
  },
  finding: {
    kind: "short" as const,
    reason: "Delivered 8000 downloads against 10000 guaranteed.",
    guaranteedDownloads: 10000,
    actualDownloads: 8000,
    shortfallPct: 0.2,
    threshold: 0.1,
  },
};

describe("make-good terms", () => {
  it("offers a re-air for a miss and a credit for a short delivery", () => {
    expect(optionsForKind("missed")).toEqual(["replacement_spot", "reair"]);
    expect(optionsForKind("short")).toEqual(["replacement_spot", "credit_shortfall"]);
  });

  it("schedules the replacement 14 days after the original post date", () => {
    expect(replacementPostDate("2026-08-01")).toBe("2026-08-15");
  });

  it("prices a CPM credit from the undelivered downloads", () => {
    expect(creditAmount(context.line, "short")).toBe(50);
  });

  it("drafts amended terms that stay in the app", () => {
    const text = draftAmendedTerms(context, "replacement_spot");
    expect(text).toContain("IO-2026-0048");
    expect(text).toContain("show_1");
    expect(text).toContain("Huberman Lab");
    expect(text).toContain("2026-08-15");
    expect(text).toContain("Net due $0.00");
    expect(text).toMatch(/does not send a DocuSign envelope/);
    expect(text).toMatch(/does not charge/);
  });
});
