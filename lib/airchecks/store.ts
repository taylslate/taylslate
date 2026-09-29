// Service-role reads and the one-row-per-line upsert. The unique key is
// io_line_item_id (migration 038), so a retry updates the same row.

import { supabaseAdmin } from "@/lib/supabase/admin";
import type { AircheckRow, AircheckWrite } from "./types";

interface LineRow {
  id: string;
  io_id: string;
  episode_url: string | null;
  post_date: string | null;
  format: string;
}

interface IoRow {
  id: string;
  deal_id: string;
}

interface DealRow {
  id: string;
  show_id: string;
}

interface ShowRow {
  id: string;
  rss_url: string | null;
}

async function maybeOne<T>(
  table: string,
  column: string,
  value: string
): Promise<T | null> {
  const { data, error } = await supabaseAdmin
    .from(table)
    .select("*")
    .eq(column, value)
    .maybeSingle();
  if (error) throw new Error(`${table} lookup failed: ${error.message}`);
  return (data as T | null) ?? null;
}

export async function loadIoLine(ioLineItemId: string): Promise<LineRow | null> {
  return maybeOne<LineRow>("io_line_items", "id", ioLineItemId);
}

/** Show RSS for the line, via IO → deal → show. Null when any join is missing. */
export async function loadShowRssUrl(ioId: string): Promise<string | null> {
  const io = await maybeOne<IoRow>("insertion_orders", "id", ioId);
  if (!io?.deal_id) return null;
  const deal = await maybeOne<DealRow>("deals", "id", io.deal_id);
  if (!deal?.show_id) return null;
  const show = await maybeOne<ShowRow>("shows", "id", deal.show_id);
  const rss = show?.rss_url?.trim();
  return rss || null;
}

export async function findAircheckByLine(
  ioLineItemId: string
): Promise<AircheckRow | null> {
  return maybeOne<AircheckRow>("airchecks", "io_line_item_id", ioLineItemId);
}

export async function saveAircheck(row: AircheckWrite): Promise<AircheckRow> {
  const { data, error } = await supabaseAdmin
    .from("airchecks")
    .upsert(row, { onConflict: "io_line_item_id" })
    .select("*")
    .single();
  if (error || !data) {
    throw new Error(`aircheck save failed: ${error?.message ?? "no row returned"}`);
  }
  return data as AircheckRow;
}
