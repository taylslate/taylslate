// Flight window for deals created from a campaign.
//
// Campaigns do not have flight columns. A v2 brief stores the window at
// brief.flight.start_date / end_date (YYYY-MM-DD). When those are present,
// every deal uses them. When the start is missing, the start is today+30
// UTC and the end is the last episode at the plan cadence — the same
// fallback generate-ios used to hardcode, without local-time day drift.

import { addDaysDateOnly, isDateOnly, todayDateOnly } from "@/lib/format/date-only";

/** Days before a flight with no campaign start. */
export const FLIGHT_LEAD_DAYS = 30;

/** Weekly. The deals route has no media-plan spacing; generate-ios passes the plan cadence. */
export const DEFAULT_FLIGHT_SPACING_DAYS = 7;

export interface CampaignFlightDates {
  start?: string;
  end?: string;
}

/** Read a valid date-only flight off a campaign brief. Presets without dates contribute nothing. */
export function campaignFlightDates(brief: unknown): CampaignFlightDates {
  if (!brief || typeof brief !== "object") return {};
  const flight = (brief as { flight?: unknown }).flight;
  if (!flight || typeof flight !== "object") return {};
  const start = (flight as { start_date?: unknown }).start_date;
  const end = (flight as { end_date?: unknown }).end_date;
  return {
    start: isDateOnly(start) ? start : undefined,
    end: isDateOnly(end) ? end : undefined,
  };
}

export function resolveDealFlight(args: {
  brief: unknown;
  numEpisodes: number;
  spacingDays?: number;
  now?: Date;
}): { flight_start: string; flight_end: string } {
  const { start, end } = campaignFlightDates(args.brief);
  const flight_start = start ?? addDaysDateOnly(todayDateOnly(args.now), FLIGHT_LEAD_DAYS);
  const episodes = Math.max(1, Math.round(args.numEpisodes) || 1);
  const spacing =
    args.spacingDays && args.spacingDays > 0 ? Math.round(args.spacingDays) : DEFAULT_FLIGHT_SPACING_DAYS;
  const derivedEnd = addDaysDateOnly(flight_start, (episodes - 1) * spacing);
  // A campaign end before the start is not a usable window; derive instead.
  const flight_end = end && end >= flight_start ? end : derivedEnd;
  return { flight_start, flight_end };
}
