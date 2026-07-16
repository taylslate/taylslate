import { describe, it, expect } from "vitest";
import { formatDateOnly } from "./date-only";

// The pitch page (app/outreach/[token]/pitch-client.tsx), the Wave 12 deal view,
// the legacy deal view, the IO preview, and the outreach email all render flight
// dates through formatDateOnly. Pinning its output here pins every one of those
// surfaces to the same UTC-consistent value — the off-by-one only came back
// because one render site (the pitch page) had its own non-UTC formatter.
describe("formatDateOnly", () => {
  it("renders a date-only value in UTC (no day shift for US viewers)", () => {
    // Stored as 'YYYY-MM-DD' → parses as UTC midnight. Without timeZone: 'UTC' a
    // negative-offset viewer would see Jul 29 / Aug 26 (the original bug).
    expect(formatDateOnly("2026-07-30")).toBe("Jul 30, 2026");
    expect(formatDateOnly("2026-08-27")).toBe("Aug 27, 2026");
  });

  it("produces the identical flight range the deal view / IO render for the same input", () => {
    // Both the pitch page and the deal view build `${start} – ${end}` from the
    // same helper, so this string is what all surfaces agree on.
    const start = "2026-07-30";
    const end = "2026-08-27";
    const flight = `${formatDateOnly(start)} – ${formatDateOnly(end)}`;
    expect(flight).toBe("Jul 30, 2026 – Aug 27, 2026");
  });

  it("renders month/day boundaries in UTC", () => {
    expect(formatDateOnly("2026-01-01")).toBe("Jan 1, 2026");
    expect(formatDateOnly("2026-12-31")).toBe("Dec 31, 2026");
  });

  it("returns an em dash for null / undefined / blank", () => {
    expect(formatDateOnly(null)).toBe("—");
    expect(formatDateOnly(undefined)).toBe("—");
    expect(formatDateOnly("")).toBe("—");
    expect(formatDateOnly("   ")).toBe("—");
  });

  it("passes an unparseable value straight through instead of 'Invalid Date'", () => {
    expect(formatDateOnly("not-a-date")).toBe("not-a-date");
  });
});

// Regression guard: the pitch page must keep formatting through the shared UTC
// helper and never reintroduce a local, timezone-naive toLocaleDateString — that
// local formatter is exactly what rendered flight dates a day early.
describe("pitch page uses the shared UTC date helper", () => {
  it("imports formatDateOnly and has no local toLocaleDateString", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const src = readFileSync(
      fileURLToPath(new URL("../../app/outreach/[token]/pitch-client.tsx", import.meta.url)),
      "utf8"
    );
    expect(src).toContain("formatDateOnly");
    expect(src).not.toMatch(/toLocaleDateString/);
  });
});
