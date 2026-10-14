import { describe, expect, it } from "vitest";
import { resolveDealFlight } from "./campaign-flight";

const NOW = new Date("2026-06-01T18:00:00.000Z");

describe("resolveDealFlight", () => {
  it("uses the campaign flight when the brief has both dates", () => {
    const flight = resolveDealFlight({
      brief: { version: 2, flight: { mode: "dates", start_date: "2026-09-01", end_date: "2026-10-15" } },
      numEpisodes: 4,
      spacingDays: 7,
      now: NOW,
    });
    expect(flight).toEqual({ flight_start: "2026-09-01", flight_end: "2026-10-15" });
  });

  it("falls back to today+30 and derives the end when the campaign has no start", () => {
    const flight = resolveDealFlight({
      brief: { version: 2, flight: { mode: "preset", preset: "asap" } },
      numEpisodes: 3,
      spacingDays: 7,
      now: NOW,
    });
    // 2026-06-01 + 30 = 2026-07-01; last of 3 weekly episodes is +14 days.
    expect(flight).toEqual({ flight_start: "2026-07-01", flight_end: "2026-07-15" });
  });

  it("keeps a campaign start and derives the end when the end is missing", () => {
    const flight = resolveDealFlight({
      brief: { version: 2, flight: { mode: "dates", start_date: "2026-09-01" } },
      numEpisodes: 3,
      spacingDays: 14,
      now: NOW,
    });
    expect(flight).toEqual({ flight_start: "2026-09-01", flight_end: "2026-09-29" });
  });

  it("ignores an end that falls before the start", () => {
    const flight = resolveDealFlight({
      brief: { version: 2, flight: { mode: "dates", start_date: "2026-09-01", end_date: "2026-08-01" } },
      numEpisodes: 2,
      spacingDays: 7,
      now: NOW,
    });
    expect(flight).toEqual({ flight_start: "2026-09-01", flight_end: "2026-09-08" });
  });

  it("ignores invalid date strings", () => {
    const flight = resolveDealFlight({
      brief: { version: 2, flight: { mode: "dates", start_date: "09/01/2026", end_date: "2026-02-31" } },
      numEpisodes: 1,
      now: NOW,
    });
    expect(flight.flight_start).toBe("2026-07-01");
    expect(flight.flight_end).toBe("2026-07-01");
  });
});
