import { describe, it, expect } from "vitest";
import { validateFlightDates } from "./flight-dates";

const NOW = new Date("2026-06-11T12:00:00Z");

describe("validateFlightDates", () => {
  it("accepts a valid range", () => {
    expect(validateFlightDates("2026-07-01", "2026-08-15", NOW)).toBeNull();
  });

  it("accepts a single-day flight (end equals start)", () => {
    expect(validateFlightDates("2026-07-01", "2026-07-01", NOW)).toBeNull();
  });

  it("rejects an inverted range", () => {
    const err = validateFlightDates("2026-08-15", "2026-07-01", NOW);
    expect(err?.code).toBe("flight_end_before_start");
  });

  it("rejects dates more than 2 years out", () => {
    expect(validateFlightDates("2028-07-01", "2028-08-01", NOW)?.code).toBe(
      "flight_too_far_out"
    );
    // Start inside the window, end beyond it
    expect(validateFlightDates("2026-07-01", "2028-07-01", NOW)?.code).toBe(
      "flight_too_far_out"
    );
  });

  it("accepts dates exactly at the 2-year boundary", () => {
    expect(validateFlightDates("2028-06-10", "2028-06-11", NOW)).toBeNull();
  });

  it("rejects malformed dates", () => {
    expect(validateFlightDates("07/01/2026", "2026-08-15", NOW)?.code).toBe(
      "flight_invalid_date"
    );
    expect(validateFlightDates("2026-07-01", "not-a-date", NOW)?.code).toBe(
      "flight_invalid_date"
    );
    expect(validateFlightDates("", "", NOW)?.code).toBe("flight_invalid_date");
  });

  it("rejects calendar rollovers like Feb 30", () => {
    expect(validateFlightDates("2027-02-30", "2027-03-15", NOW)?.code).toBe(
      "flight_invalid_date"
    );
  });
});
