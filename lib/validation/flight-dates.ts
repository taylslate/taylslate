// Wave 14 Phase 2A Layer 3 amendment — flight date-range validation,
// shared by the brief intake form (client) and the brief endpoint
// (server). Pure function: no I/O, safe to import from either side.

export const MAX_FLIGHT_YEARS_OUT = 1;

export interface FlightDateError {
  code: "flight_invalid_date" | "flight_end_before_start" | "flight_too_far_out";
  message: string;
}

function parseIsoDate(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return null;
  // Reject calendar rollovers like 2026-02-30 → Mar 02.
  if (date.toISOString().slice(0, 10) !== value) return null;
  return date;
}

export function validateFlightDates(
  start: string,
  end: string,
  now: Date = new Date()
): FlightDateError | null {
  const startDate = parseIsoDate(start);
  const endDate = parseIsoDate(end);
  if (!startDate || !endDate) {
    return {
      code: "flight_invalid_date",
      message: "Flight dates must be valid dates in YYYY-MM-DD format.",
    };
  }
  if (endDate.getTime() < startDate.getTime()) {
    return {
      code: "flight_end_before_start",
      message: "Flight end date must be on or after the start date.",
    };
  }
  const max = new Date(now);
  max.setFullYear(max.getFullYear() + MAX_FLIGHT_YEARS_OUT);
  if (startDate.getTime() > max.getTime() || endDate.getTime() > max.getTime()) {
    return {
      code: "flight_too_far_out",
      message: `Flight dates must be within the next ${MAX_FLIGHT_YEARS_OUT} year${MAX_FLIGHT_YEARS_OUT === 1 ? "" : "s"}.`,
    };
  }
  return null;
}
