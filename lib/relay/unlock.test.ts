import { describe, expect, it } from "vitest";
import { isRelayUnlocked } from "./unlock";

describe("isRelayUnlocked", () => {
  it("stays locked with no deal", () => {
    expect(isRelayUnlocked(null)).toBe(false);
  });

  it("stays locked when only one side has signed", () => {
    expect(
      isRelayUnlocked({ show_signed_at: null, brand_signed_at: "2026-11-01", status: "brand_signed" })
    ).toBe(false);
    expect(
      isRelayUnlocked({ show_signed_at: "2026-11-02", brand_signed_at: null, status: "show_signed" })
    ).toBe(false);
  });

  it("unlocks when both sides have signed and the deal is not cancelled", () => {
    expect(
      isRelayUnlocked({
        show_signed_at: "2026-11-02",
        brand_signed_at: "2026-11-01",
        status: "show_signed",
      })
    ).toBe(true);
  });

  it("stays locked when both sides signed and the deal is cancelled", () => {
    expect(
      isRelayUnlocked({
        show_signed_at: "2026-11-02",
        brand_signed_at: "2026-11-01",
        status: "cancelled",
      })
    ).toBe(false);
  });

  it("fails closed on garbage", () => {
    expect(isRelayUnlocked({} as never)).toBe(false);
    expect(isRelayUnlocked({ show_signed_at: "", brand_signed_at: "x", status: "show_signed" })).toBe(false);
    expect(isRelayUnlocked({ show_signed_at: "x", brand_signed_at: "y", status: "" })).toBe(false);
  });
});
