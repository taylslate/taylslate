// Catalog duplicate check for the legacy /shows CSV import.
//
// Same name and feed rules as the roster import. A name match requires
// the show to be discoverable, or owned by the caller. A feed match is
// a strong key and ignores visibility. The matched show's id, name, and
// owner are not returned and are not logged.

import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  normalizeRosterShowName,
  normalizeRssUrl,
} from "@/lib/reps/roster-import";

const SHOW_COLUMNS = "id, name, agent_id, is_discoverable, rss_url";
const NAME_LOOKUP_LIMIT = 25;
const RSS_LOOKUP_LIMIT = 10;

interface CatalogRow {
  name: string;
  rss_url?: string | null;
}

interface CatalogShow {
  id: string;
  name: string;
  agent_id: string | null;
  is_discoverable: boolean;
  rss_url: string | null;
}

function nameSearchToken(key: string): string {
  const parts = key.split(" ").filter((part) => part.length >= 3);
  parts.sort((a, b) => b.length - a.length);
  return parts[0] ?? key;
}

function likeContains(value: string): string {
  const escaped = value.replace(/[\\%_]/g, (char) => `\\${char}`);
  return `%${escaped}%`;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function nameEligible(show: CatalogShow, agentId: string): boolean {
  if (show.is_discoverable === true) return true;
  return Boolean(agentId) && show.agent_id === agentId;
}

function asShows(data: unknown): CatalogShow[] {
  if (!Array.isArray(data)) return [];
  const rows: CatalogShow[] = [];
  for (const item of data) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    if (typeof row.id !== "string" || typeof row.name !== "string") continue;
    rows.push({
      id: row.id,
      name: row.name,
      agent_id: typeof row.agent_id === "string" ? row.agent_id : null,
      is_discoverable: row.is_discoverable === true,
      rss_url: typeof row.rss_url === "string" ? row.rss_url : null,
    });
  }
  return rows;
}

function dedupeShows(shows: CatalogShow[]): CatalogShow[] {
  const seen = new Set<string>();
  const rows: CatalogShow[] = [];
  for (const show of shows) {
    if (seen.has(show.id)) continue;
    seen.add(show.id);
    rows.push(show);
  }
  return rows;
}

async function lookupShows(
  column: "name" | "rss_url",
  token: string,
  limit: number
): Promise<CatalogShow[]> {
  const { data, error } = await supabaseAdmin
    .from("shows")
    .select(SHOW_COLUMNS)
    .ilike(column, likeContains(token))
    .limit(limit);
  if (error) {
    throw new Error("Show lookup failed.");
  }
  return asShows(data);
}

function feedMatches(row: CatalogRow, shows: CatalogShow[]): boolean {
  if (!row.rss_url) return false;
  const key = normalizeRssUrl(row.rss_url);
  if (!key) return false;
  return shows.some(
    (show) => Boolean(show.rss_url) && normalizeRssUrl(show.rss_url as string) === key
  );
}

function nameMatches(row: CatalogRow, shows: CatalogShow[], agentId: string): boolean {
  const key = normalizeRosterShowName(row.name);
  if (!key) return false;
  return shows.some((show) => {
    if (!nameEligible(show, agentId)) return false;
    return normalizeRosterShowName(show.name) === key;
  });
}

export async function findCatalogDuplicates(
  rows: CatalogRow[],
  agentId: string
): Promise<Set<number>> {
  const nameTokens = unique(
    rows
      .map((row) => nameSearchToken(normalizeRosterShowName(row.name)))
      .filter((token) => token.length > 0)
  );
  const rssKeys = unique(
    rows
      .map((row) => (row.rss_url ? normalizeRssUrl(row.rss_url) : ""))
      .filter((key) => key.length > 0)
  );

  const found: CatalogShow[] = [];
  for (const token of nameTokens) {
    found.push(...(await lookupShows("name", token, NAME_LOOKUP_LIMIT)));
  }
  for (const key of rssKeys) {
    found.push(...(await lookupShows("rss_url", key, RSS_LOOKUP_LIMIT)));
  }
  const shows = dedupeShows(found);

  const duplicates = new Set<number>();
  rows.forEach((row, index) => {
    if (feedMatches(row, shows) || nameMatches(row, shows, agentId)) {
      duplicates.add(index);
    }
  });
  return duplicates;
}
