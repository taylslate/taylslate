// Split a reviewed import IO into one deal draft per show. The confirm step
// posts each draft to POST /api/deals. Line items that share a show name are
// one deal; a different show name is another deal.

import type { InsertionOrder, IOLineItem } from "@/lib/data/types";

export interface ImportedDealDraft {
  label: string;
  body: Record<string, unknown>;
}

function money(n: number): number {
  return Math.round(n * 100) / 100;
}

function dealBody(io: Partial<InsertionOrder>, items: IOLineItem[]): Record<string, unknown> {
  const first = items[0];
  const dates = items
    .map((item) => item.post_date)
    .filter((date) => typeof date === "string" && date.length > 0)
    .sort();
  const downloads = Number(first.guaranteed_downloads) || 0;
  const priceType = first.price_type === "flat_rate" ? "flat_rate" : "cpm";
  const net = Number(first.net_due) || Number(first.gross_rate) || 0;
  const cpm =
    Number(first.gross_cpm) > 0
      ? Number(first.gross_cpm)
      : downloads > 0 && net > 0
        ? money((net / downloads) * 1000)
        : 0;

  const notes = [
    io.io_number ? `Imported from ${io.io_number}` : "Imported IO",
    io.advertiser_name ? `Advertiser: ${io.advertiser_name}` : "",
  ]
    .filter(Boolean)
    .join(". ");

  return {
    show_name: (first.show_name ?? "").trim(),
    num_episodes: items.length,
    placement: first.placement || "mid-roll",
    ad_format: first.is_scripted ? "scripted" : "host_read",
    price_type: priceType,
    cpm_rate: priceType === "cpm" ? cpm : undefined,
    flat_rate: priceType === "flat_rate" ? net : undefined,
    guaranteed_downloads: downloads,
    is_scripted: first.is_scripted === true,
    is_personal_experience: first.is_personal_experience !== false,
    reader_type: first.reader_type || "host_read",
    content_type: first.content_type || "evergreen",
    pixel_required: first.pixel_required === true,
    flight_start: dates[0],
    flight_end: dates[dates.length - 1] ?? dates[0],
    notes,
    competitor_exclusion: io.competitor_exclusion ?? [],
    exclusivity_days: io.exclusivity_days ?? 90,
    rofr_days: io.rofr_days ?? 30,
  };
}

export function dealsFromImportedIO(io: Partial<InsertionOrder>): ImportedDealDraft[] {
  const groups = new Map<string, IOLineItem[]>();
  for (const item of io.line_items ?? []) {
    const label = item.show_name?.trim() || "Untitled show";
    const list = groups.get(label) ?? [];
    list.push(item);
    groups.set(label, list);
  }
  return [...groups.entries()].map(([label, items]) => ({
    label,
    body: dealBody(io, items),
  }));
}
