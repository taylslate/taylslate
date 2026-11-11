import { describe, expect, it } from "vitest";
import { BOOKED_DEAL_STATUSES } from "@/lib/discovery/market-signals";
import { confirmDealEligibility, confirmEligibility } from "./eligibility";

describe("confirmEligibility", () => {
  it("allows a transcribed matched row", () => {
    expect(confirmEligibility({ status: "transcribed", match_result: "matched" })).toEqual({
      ok: true,
      reason: null,
    });
  });

  it("allows a transcribed not_matched row", () => {
    expect(
      confirmEligibility({ status: "transcribed", match_result: "not_matched" })
    ).toEqual({ ok: true, reason: null });
  });

  it("blocks a failed row even when the match is matched", () => {
    const gate = confirmEligibility({ status: "failed", match_result: "matched" });
    expect(gate.ok).toBe(false);
    if (gate.ok) return;
    expect(gate.reason).toMatch(/failed/i);
  });

  it("blocks a pending row", () => {
    const gate = confirmEligibility({ status: "pending", match_result: "matched" });
    expect(gate.ok).toBe(false);
    if (gate.ok) return;
    expect(gate.reason).toMatch(/pending/i);
  });

  it("blocks a status that is not transcribed", () => {
    const gate = confirmEligibility({ status: "queued", match_result: "matched" });
    expect(gate.ok).toBe(false);
    if (gate.ok) return;
    expect(gate.reason).toMatch(/not transcribed/i);
  });

  it("blocks a skipped match", () => {
    const gate = confirmEligibility({ status: "transcribed", match_result: "skipped" });
    expect(gate.ok).toBe(false);
    if (gate.ok) return;
    expect(gate.reason).toMatch(/skipped/i);
  });

  it("blocks a null match", () => {
    const gate = confirmEligibility({ status: "transcribed", match_result: null });
    expect(gate.ok).toBe(false);
    if (gate.ok) return;
    expect(gate.reason).toMatch(/not been judged/i);
  });

  it("blocks an empty match", () => {
    const gate = confirmEligibility({ status: "transcribed", match_result: "" });
    expect(gate.ok).toBe(false);
    if (gate.ok) return;
    expect(gate.reason).toMatch(/not been judged/i);
  });

  it("blocks an unknown match result", () => {
    const gate = confirmEligibility({ status: "transcribed", match_result: "maybe" });
    expect(gate.ok).toBe(false);
    if (gate.ok) return;
    expect(gate.reason).toMatch(/not been judged/i);
  });
});

describe("confirmDealEligibility", () => {
  it("allows every booked status when the deal is not cancelled", () => {
    for (const status of BOOKED_DEAL_STATUSES) {
      expect(confirmDealEligibility({ status, cancelledAt: null })).toEqual({
        ok: true,
        reason: null,
      });
    }
  });

  it("blocks a missing deal", () => {
    const gate = confirmDealEligibility(null);
    expect(gate.ok).toBe(false);
    if (gate.ok) return;
    expect(gate.reason).toMatch(/not on a booked deal/i);
  });

  it("blocks a cancelled deal even when the status is booked", () => {
    const gate = confirmDealEligibility({
      status: "show_signed",
      cancelledAt: "2026-11-01T00:00:00.000Z",
    });
    expect(gate.ok).toBe(false);
    if (gate.ok) return;
    expect(gate.reason).toMatch(/cancelled/i);
  });

  it("blocks a status outside the booked set", () => {
    const gate = confirmDealEligibility({ status: "planning", cancelledAt: null });
    expect(gate.ok).toBe(false);
    if (gate.ok) return;
    expect(gate.reason).toMatch(/not booked/i);
  });

  it("blocks a blank status", () => {
    const gate = confirmDealEligibility({ status: null, cancelledAt: null });
    expect(gate.ok).toBe(false);
    if (gate.ok) return;
    expect(gate.reason).toMatch(/not booked/i);
  });
});
