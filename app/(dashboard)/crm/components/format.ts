const LABELS: Record<string, string> = {
  planning: "Planning",
  io_sent: "IO Sent",
  brand_signed: "Brand Signed",
  show_signed: "Show Signed",
  live: "Live",
  delivering: "Delivering",
  completed: "Completed",
  cancelled: "Cancelled",
  proposed: "Proposed",
  negotiating: "Negotiating",
  approved: "Approved",
  signed: "Signed",
  "mid-roll": "Mid-roll",
  "pre-roll": "Pre-roll",
  "post-roll": "Post-roll",
};

export function labelOf(value: string): string {
  if (!value) return "Unset";
  return LABELS[value] ?? value;
}

export function formatDay(value: string): string {
  const iso = value.length === 10 ? `${value}T00:00:00Z` : value;
  return new Date(iso).toLocaleDateString("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function formatFlight(start: string | null, end: string | null): string {
  if (!start && !end) return "Flight not set";
  if (start && end) return `${formatDay(start)} to ${formatDay(end)}`;
  return formatDay(start ?? end ?? "");
}

export function formatUsd(amount: number): string {
  return amount.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}
