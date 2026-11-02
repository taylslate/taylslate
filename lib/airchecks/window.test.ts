import { describe, expect, it } from "vitest";
import { airWindow, dayInWindow, spotIsDue } from "./window";

describe("air window", () => {
  it("opens on the post date and stays open through the catch-up", () => {
    expect(airWindow("2026-11-01")).toEqual({ start: "2026-11-01", end: "2026-11-07" });
    expect(spotIsDue("2026-11-01", "2026-10-31")).toBe(false);
    expect(spotIsDue("2026-11-01", "2026-11-01")).toBe(true);
    expect(spotIsDue("2026-11-01", "2026-11-14")).toBe(true);
    expect(spotIsDue("2026-11-01", "2026-11-15")).toBe(false);
  });

  it("matches a publish day inside the window", () => {
    const window = airWindow("2026-11-01");
    expect(window).not.toBeNull();
    expect(dayInWindow("2026-11-03", window!)).toBe(true);
    expect(dayInWindow("2026-11-08", window!)).toBe(false);
  });
});
