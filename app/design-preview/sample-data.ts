export const CAMPAIGN = {
  name: "Sauna Box spring test",
  budget: 25000,
  filled: 18400,
} as const;

export const budgetRemaining = CAMPAIGN.budget - CAMPAIGN.filled;

export const PRIMARY_ACTION = "Send outreach";

export interface ShowMatch {
  id: string;
  name: string;
  note: string;
  cover: number;
}

export const SHOWS: ShowMatch[] = [
  { id: "morning-ritual", name: "The Morning Ritual", note: "Recovery routines", cover: 1 },
  { id: "heat-check", name: "Heat Check", note: "Sauna and training", cover: 2 },
  { id: "slow-living", name: "Slow Living Daily", note: "Home rituals", cover: 3 },
  { id: "founder-body", name: "Founder Body", note: "Operators who train", cover: 4 },
  { id: "weekend-recovery", name: "Weekend Recovery", note: "Saturday reset", cover: 5 },
  { id: "at-home", name: "At Home Athletics", note: "Garage gyms", cover: 6 },
];

export const PIPELINE_COLUMNS = [
  { key: "planning", label: "Planning" },
  { key: "io_sent", label: "IO Sent" },
  { key: "live", label: "Live" },
  { key: "completed", label: "Completed" },
] as const;

export type PipelineColumn = (typeof PIPELINE_COLUMNS)[number]["key"];

export interface PipelineDeal {
  id: string;
  show: string;
  column: PipelineColumn;
  status: string;
  net: number;
  price: string;
  episodes: number;
  placement: string;
  cover: number;
}

export const DEALS: PipelineDeal[] = [
  { id: "d1", show: "The Morning Ritual", column: "planning", status: "Planning", net: 4200, price: "$28 CPM", episodes: 3, placement: "Mid-roll", cover: 1 },
  { id: "d2", show: "Heat Check", column: "planning", status: "Planning", net: 3100, price: "$24 CPM", episodes: 3, placement: "Mid-roll", cover: 2 },
  { id: "d3", show: "Slow Living Daily", column: "io_sent", status: "IO Sent", net: 2700, price: "$20 CPM", episodes: 3, placement: "Pre-roll", cover: 3 },
  { id: "d4", show: "Founder Body", column: "io_sent", status: "Brand signed", net: 4800, price: "$32 CPM", episodes: 3, placement: "Mid-roll", cover: 4 },
  { id: "d5", show: "Weekend Recovery", column: "live", status: "Live", net: 2100, price: "$22 CPM", episodes: 3, placement: "Mid-roll", cover: 5 },
  { id: "d6", show: "At Home Athletics", column: "live", status: "Delivering", net: 1500, price: "Flat fee", episodes: 3, placement: "Mid-roll", cover: 6 },
  { id: "d7", show: "Cold Plunge Club", column: "completed", status: "Completed", net: 2400, price: "Flat fee", episodes: 3, placement: "Post-roll", cover: 7 },
];

export interface FlightRow {
  id: string;
  show: string;
  placement: string;
  airDate: string;
  spots: number;
  net: number;
}

export const FLIGHTS: FlightRow[] = [
  { id: "f1", show: "Weekend Recovery", placement: "Mid-roll", airDate: "2026-10-22", spots: 1, net: 700 },
  { id: "f2", show: "At Home Athletics", placement: "Mid-roll", airDate: "2026-10-24", spots: 1, net: 500 },
  { id: "f3", show: "The Morning Ritual", placement: "Mid-roll", airDate: "2026-10-28", spots: 1, net: 1400 },
  { id: "f4", show: "Heat Check", placement: "Mid-roll", airDate: "2026-11-03", spots: 1, net: 1030 },
  { id: "f5", show: "Founder Body", placement: "Mid-roll", airDate: "2026-11-12", spots: 1, net: 1600 },
];

export const FLIGHT_START = new Date(2026, 9, 20);

export function formatMoney(amount: number): string {
  return `$${amount.toLocaleString("en-US")}`;
}

export function isoFromDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function formatAirDate(iso: string): string {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(year, (month ?? 1) - 1, day ?? 1).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

export function flightsOnOrAfter(rows: FlightRow[], iso: string | undefined): FlightRow[] {
  if (!iso) return rows;
  return rows.filter((row) => row.airDate >= iso);
}

export function dealsInColumn(column: PipelineColumn): PipelineDeal[] {
  return DEALS.filter((deal) => deal.column === column);
}

export function columnNet(column: PipelineColumn): number {
  return dealsInColumn(column).reduce((sum, deal) => sum + deal.net, 0);
}
