// Bulk roster import for a signed-in rep.
//
// Preview classifies and writes nothing. Commit inserts pending
// agent_show_relationships (source import, exclusive unless the row
// opts out) through supabaseAdmin. A new show follows importShows:
// agent_id is the caller, is_discoverable is false unless isShowsAdmin,
// and is_exclusive is not a shows column. is_claimed and ownership_status
// are left to their defaults. An existing show is never updated.
//
// Match order: normalized rss_url, then a YouTube channel id that is
// already a UC id, then shows.apple_id, then a normalized name.
// A name match is a suggestion until the row sets confirm. Hidden shows
// owned by another agent match only on the first three tiers, and the
// result carries their id and name only. show_profiles.podscan_id is
// not a match field. Nothing here approves a link.

import { supabaseAdmin } from "@/lib/supabase/admin";
import { isShowsAdmin } from "@/lib/shows/can-edit-show";

export const ROSTER_IMPORT_MAX_ROWS = 500;
export const ROSTER_IMPORT_MAX_BYTES = 1024 * 1024;
const NAME_LOOKUP_LIMIT = 50;

const SHOW_COLUMNS =
  "id, name, rss_url, youtube_channel_id, apple_id, is_discoverable, agent_id";

const UC_ID = /^UC[A-Za-z0-9_-]{22}$/;

// Same 32 ASCII punctuation characters as normalize_show_match_key.
const SHOW_MATCH_PUNCTUATION = "!\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~";
const SHOW_MATCH_WHITESPACE = new Set([9, 10, 11, 12, 13, 32]);

export class RosterImportError extends Error {
  readonly status: 400 | 413;

  constructor(status: 400 | 413, message: string) {
    super(message);
    this.name = "RosterImportError";
    this.status = status;
  }
}

export type RosterImportMode = "preview" | "commit";

export type RosterImportClass =
  | "new_show"
  | "link_existing"
  | "already_on_roster"
  | "exclusive_conflict"
  | "invalid";

export type RosterMatchTier =
  | "rss_url"
  | "youtube_channel_id"
  | "apple_id"
  | "name";

export interface RosterImportResultRow {
  index: number;
  class: RosterImportClass;
  match_tier: RosterMatchTier | null;
  show_id: string | null;
  show_name: string | null;
  needs_confirm: boolean;
  exclusive_conflict: boolean;
  reasons: string[];
  is_exclusive: boolean;
  link_id: string | null;
  committed: boolean;
}

interface ParsedRow {
  index: number;
  name: string;
  platform: "podcast" | "youtube" | null;
  rssUrl: string | null;
  appleId: string | null;
  youtubeChannelId: string | null;
  contactEmail: string | null;
  isExclusive: boolean;
  confirm: boolean;
  reasons: string[];
}

interface ShowRow {
  id: string;
  name: string;
  rss_url: string | null;
  youtube_channel_id: string | null;
  apple_id: string | null;
  is_discoverable: boolean;
  agent_id: string | null;
}

interface LinkRow {
  id: string;
  agent_id: string;
  show_id: string;
  status: string;
  is_exclusive: boolean;
}

interface DbError {
  message?: string;
  code?: string;
}

interface CandidateLoad {
  shows: ShowRow[];
  cappedNameTokens: Set<string>;
}

interface Classified {
  parsed: ParsedRow;
  result: RosterImportResultRow;
  show: ShowRow | null;
}

/** Protocol and trailing-slash insensitive feed key. Case is folded. */
export function normalizeRssUrl(value: string): string {
  return value.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/+$/, "");
}

/**
 * Same rules as normalizeShowMatchKey in lib/imports/past-campaigns.ts
 * and normalize_show_match_key in migration 068. A name match is exact
 * on this key. It is not a fuzzy match.
 */
export function normalizeRosterShowName(name: string): string {
  const prepared = name
    .replaceAll("\u2019", "'")
    .replaceAll("\u00A0", " ")
    .replaceAll("\u0130", "i\u0307");
  const folded = [...prepared].map((char) => char.toLowerCase()).join("");
  let spaced = "";
  for (const char of folded) {
    const code = char.charCodeAt(0);
    if (SHOW_MATCH_PUNCTUATION.includes(char) || SHOW_MATCH_WHITESPACE.has(code)) {
      spaced += " ";
      continue;
    }
    spaced += char;
  }
  const collapsed = spaced.replace(/ +/g, " ").trim();
  const withoutArticle = collapsed.replace(/^(?:the )+/, "");
  return withoutArticle.replace(/(?: (?:podcast|show))+$/, "").trim();
}

export function assertRosterImportBytes(byteLength: number): void {
  if (byteLength > ROSTER_IMPORT_MAX_BYTES) {
    throw new RosterImportError(413, "This file is larger than 1 MB.");
  }
}

export function parseRosterMode(value: string | null): RosterImportMode | null {
  if (value === null || value.trim() === "" || value.trim().toLowerCase() === "preview") {
    return "preview";
  }
  if (value.trim().toLowerCase() === "commit") return "commit";
  return null;
}

export function parseRosterImport(body: string, contentType: string): ParsedRow[] {
  const type = contentType.toLowerCase();
  const rows = type.includes("application/json") || looksLikeJson(body)
    ? parseJsonRows(body)
    : parseCsvRows(body);
  if (rows.length === 0) {
    throw new RosterImportError(400, "Send at least one show.");
  }
  if (rows.length > ROSTER_IMPORT_MAX_ROWS) {
    throw new RosterImportError(400, "Send at most 500 shows.");
  }
  return rows;
}

export async function importRoster(input: {
  agentId: string;
  mode: RosterImportMode;
  rows: ParsedRow[];
}): Promise<RosterImportResultRow[]> {
  const loaded = await loadCandidateShows(input.rows);
  const links = await loadLinks(loaded.shows.map((show) => show.id));
  const pool = dedupeShows(loaded.shows);
  const linkList = links.slice();
  const results: RosterImportResultRow[] = [];
  let admin: boolean | null = null;

  for (const parsed of input.rows) {
    const classified = classifyRow(
      parsed,
      input.agentId,
      pool,
      linkList,
      loaded.cappedNameTokens
    );
    if (input.mode === "preview" || !willWrite(classified)) {
      results.push(classified.result);
      continue;
    }

    if (classified.result.class === "new_show") {
      if (admin === null) admin = await isShowsAdmin(input.agentId);
      const written = await insertNewShow(input.agentId, admin, classified, pool, linkList);
      results.push(written);
      continue;
    }

    const linked = await insertPendingLink(input.agentId, classified, linkList);
    results.push(linked);
  }

  return results;
}

function willWrite(row: Classified): boolean {
  if (row.parsed.reasons.length > 0) return false;
  if (row.result.class === "invalid") return false;
  if (row.result.class === "already_on_roster") return false;
  if (row.result.needs_confirm) return false;
  return (
    row.result.class === "new_show" ||
    row.result.class === "link_existing" ||
    row.result.class === "exclusive_conflict"
  );
}

function classifyRow(
  parsed: ParsedRow,
  agentId: string,
  shows: ShowRow[],
  links: LinkRow[],
  cappedNameTokens: Set<string>
): Classified {
  const base = {
    index: parsed.index,
    match_tier: null,
    show_id: null,
    show_name: null,
    needs_confirm: false,
    exclusive_conflict: false,
    reasons: parsed.reasons.slice(),
    is_exclusive: parsed.isExclusive,
    link_id: null,
    committed: false,
  } satisfies Omit<RosterImportResultRow, "class">;

  if (parsed.reasons.length > 0 || !parsed.platform) {
    return {
      parsed,
      show: null,
      result: { ...base, class: "invalid" },
    };
  }

  const strong = strongMatch(parsed, shows);
  if (strong && strong.shows.length > 1) {
    return {
      parsed,
      show: null,
      result: {
        ...base,
        class: "invalid",
        match_tier: strong.tier,
        reasons: [multiMatchReason(strong.tier)],
      },
    };
  }

  if (strong && strong.shows.length === 1) {
    return finishMatch(parsed, agentId, strong.shows[0], strong.tier, false, links, base);
  }

  const nameKey = normalizeRosterShowName(parsed.name);
  const nameToken = nameSearchToken(nameKey);
  if (nameToken && cappedNameTokens.has(nameToken)) {
    return {
      parsed,
      show: null,
      result: {
        ...base,
        class: "invalid",
        match_tier: "name",
        reasons: ["Name matches more than one show."],
      },
    };
  }

  const named = nameMatches(parsed.name, agentId, shows);
  if (named.length > 1) {
    return {
      parsed,
      show: null,
      result: {
        ...base,
        class: "invalid",
        match_tier: "name",
        reasons: ["Name matches more than one show."],
      },
    };
  }
  if (named.length === 1) {
    const needsConfirm = !parsed.confirm;
    return finishMatch(parsed, agentId, named[0], "name", needsConfirm, links, base);
  }

  return {
    parsed,
    show: null,
    result: { ...base, class: "new_show" },
  };
}

function finishMatch(
  parsed: ParsedRow,
  agentId: string,
  show: ShowRow,
  tier: RosterMatchTier,
  needsConfirm: boolean,
  links: LinkRow[],
  base: Omit<RosterImportResultRow, "class">
): Classified {
  const own = links.find((link) => link.show_id === show.id && link.agent_id === agentId);
  const exclusiveConflict = links.some(
    (link) =>
      link.show_id === show.id &&
      link.agent_id !== agentId &&
      link.status === "approved" &&
      link.is_exclusive === true
  );
  const reasons = base.reasons.slice();
  if (needsConfirm && !own) {
    reasons.push("Confirm this name match before linking it.");
  }
  const rosterClass: RosterImportClass = own
    ? "already_on_roster"
    : exclusiveConflict
      ? "exclusive_conflict"
      : "link_existing";
  return {
    parsed,
    show,
    result: {
      ...base,
      class: rosterClass,
      match_tier: tier,
      show_id: show.id,
      show_name: show.name,
      needs_confirm: Boolean(needsConfirm && !own),
      exclusive_conflict: exclusiveConflict,
      reasons,
      link_id: own?.id ?? null,
    },
  };
}

function strongMatch(
  parsed: ParsedRow,
  shows: ShowRow[]
): { tier: RosterMatchTier; shows: ShowRow[] } | null {
  if (parsed.rssUrl) {
    const key = normalizeRssUrl(parsed.rssUrl);
    if (key) {
      const hits = shows.filter((show) => show.rss_url && normalizeRssUrl(show.rss_url) === key);
      if (hits.length > 0) return { tier: "rss_url", shows: dedupeShows(hits) };
    }
  }
  if (parsed.youtubeChannelId) {
    const hits = shows.filter((show) => show.youtube_channel_id === parsed.youtubeChannelId);
    if (hits.length > 0) return { tier: "youtube_channel_id", shows: dedupeShows(hits) };
  }
  if (parsed.appleId) {
    const hits = shows.filter((show) => appleIdFromStored(show.apple_id) === parsed.appleId);
    if (hits.length > 0) return { tier: "apple_id", shows: dedupeShows(hits) };
  }
  return null;
}

function nameMatches(name: string, agentId: string, shows: ShowRow[]): ShowRow[] {
  const key = normalizeRosterShowName(name);
  if (!key) return [];
  const hits = shows.filter((show) => {
    if (!nameEligible(show, agentId)) return false;
    return normalizeRosterShowName(show.name) === key;
  });
  return dedupeShows(hits);
}

function nameEligible(show: ShowRow, agentId: string): boolean {
  if (show.is_discoverable === true) return true;
  return Boolean(agentId) && show.agent_id === agentId;
}

function multiMatchReason(tier: RosterMatchTier): string {
  if (tier === "rss_url") return "That feed matches more than one show.";
  if (tier === "youtube_channel_id") return "That YouTube channel matches more than one show.";
  if (tier === "apple_id") return "That Apple id matches more than one show.";
  return "Name matches more than one show.";
}

async function insertNewShow(
  agentId: string,
  admin: boolean,
  classified: Classified,
  pool: ShowRow[],
  links: LinkRow[]
): Promise<RosterImportResultRow> {
  const parsed = classified.parsed;
  const slug = slugFromName(parsed.name);
  const dbRow: Record<string, unknown> = {
    name: parsed.name,
    slug,
    platform: parsed.platform,
    agent_id: agentId,
    is_discoverable: admin,
  };
  if (parsed.contactEmail) dbRow.contact_email = parsed.contactEmail;
  if (parsed.rssUrl) dbRow.rss_url = parsed.rssUrl.trim();
  if (parsed.youtubeChannelId) dbRow.youtube_channel_id = parsed.youtubeChannelId;
  if (parsed.appleId) dbRow.apple_id = parsed.appleId;

  const { data, error } = await supabaseAdmin
    .from("shows")
    .insert(dbRow)
    .select("id, name")
    .single();
  if (error || !data || typeof (data as { id?: unknown }).id !== "string") {
    console.warn("[roster-import] show insert failed:", error?.code ?? "unknown");
    return {
      ...classified.result,
      committed: false,
      reasons: ["Could not add this show."],
    };
  }

  const createdId = (data as { id: string; name?: string }).id;
  const created: ShowRow = {
    id: createdId,
    name: parsed.name,
    rss_url: parsed.rssUrl,
    youtube_channel_id: parsed.youtubeChannelId,
    apple_id: parsed.appleId,
    is_discoverable: admin,
    agent_id: agentId,
  };
  pool.push(created);

  const link = await writeLink(agentId, createdId, parsed.isExclusive);
  if (!link.ok && link.duplicate) {
    return {
      ...classified.result,
      show_id: createdId,
      show_name: parsed.name,
      class: "already_on_roster",
      committed: false,
    };
  }
  if (!link.ok) {
    const removed = await deleteShow(createdId);
    pool.pop();
    return {
      ...classified.result,
      show_id: removed ? null : createdId,
      show_name: removed ? null : parsed.name,
      committed: false,
      reasons: [
        removed
          ? "Could not add the roster link. The new show was removed."
          : "Could not add the roster link. The new show is still in the catalog.",
      ],
    };
  }

  links.push({
    id: link.id,
    agent_id: agentId,
    show_id: createdId,
    status: "pending",
    is_exclusive: parsed.isExclusive,
  });
  return {
    ...classified.result,
    class: "new_show",
    show_id: createdId,
    show_name: parsed.name,
    link_id: link.id,
    committed: true,
  };
}

async function insertPendingLink(
  agentId: string,
  classified: Classified,
  links: LinkRow[]
): Promise<RosterImportResultRow> {
  const show = classified.show;
  if (!show) {
    return {
      ...classified.result,
      committed: false,
      reasons: ["Could not add the roster link."],
    };
  }
  const link = await writeLink(agentId, show.id, classified.parsed.isExclusive);
  if (!link.ok) {
    if (link.duplicate) {
      const existing = links.find(
        (row) => row.agent_id === agentId && row.show_id === show.id
      );
      return {
        ...classified.result,
        class: "already_on_roster",
        link_id: existing?.id ?? classified.result.link_id,
        committed: false,
        needs_confirm: false,
      };
    }
    console.warn("[roster-import] link insert failed:", link.code ?? "unknown");
    return {
      ...classified.result,
      committed: false,
      reasons: ["Could not add the roster link."],
    };
  }
  links.push({
    id: link.id,
    agent_id: agentId,
    show_id: show.id,
    status: "pending",
    is_exclusive: classified.parsed.isExclusive,
  });
  return {
    ...classified.result,
    link_id: link.id,
    committed: true,
  };
}

async function writeLink(
  agentId: string,
  showId: string,
  isExclusive: boolean
): Promise<{ ok: true; id: string } | { ok: false; duplicate: boolean; code?: string }> {
  const payload = {
    agent_id: agentId,
    show_id: showId,
    is_exclusive: isExclusive,
    status: "pending",
    source: "import",
  };
  const { data, error } = await supabaseAdmin
    .from("agent_show_relationships")
    .insert(payload)
    .select("id")
    .single();
  if (error || !data || typeof (data as { id?: unknown }).id !== "string") {
    return {
      ok: false,
      duplicate: error?.code === "23505",
      code: error?.code,
    };
  }
  return { ok: true, id: (data as { id: string }).id };
}

async function deleteShow(showId: string): Promise<boolean> {
  const { error } = await supabaseAdmin.from("shows").delete().eq("id", showId);
  if (error) {
    console.warn("[roster-import] show delete failed:", error.code ?? "unknown");
    return false;
  }
  return true;
}

async function loadCandidateShows(rows: ParsedRow[]): Promise<CandidateLoad> {
  const valid = rows.filter((row) => row.reasons.length === 0 && row.platform);
  const rssNorms = unique(
    valid
      .map((row) => (row.rssUrl ? normalizeRssUrl(row.rssUrl) : ""))
      .filter((value) => value.length > 0)
  );
  const youtubeIds = unique(
    valid
      .map((row) => row.youtubeChannelId)
      .filter((value): value is string => Boolean(value))
  );
  const appleIds = unique(
    valid.map((row) => row.appleId).filter((value): value is string => Boolean(value))
  );
  const nameTokens = unique(
    valid
      .map((row) => nameSearchToken(normalizeRosterShowName(row.name)))
      .filter((value) => value.length > 0)
  );

  const [byRssIn, byRssLike, byYoutube, byAppleIn, byAppleLike, byName] = await Promise.all([
    fetchShowsIn("rss_url", rssNorms.flatMap(rssStoredVariants)),
    fetchShowsIlike("rss_url", rssNorms, 1000),
    fetchShowsIn("youtube_channel_id", youtubeIds),
    fetchShowsIn(
      "apple_id",
      appleIds.flatMap((id) => [id, `id${id}`])
    ),
    fetchShowsIlike("apple_id", appleIds, 1000),
    fetchNameCandidates(nameTokens),
  ]);

  return {
    shows: dedupeShows([
      ...byRssIn,
      ...byRssLike.rows,
      ...byYoutube,
      ...byAppleIn,
      ...byAppleLike.rows,
      ...byName.rows,
    ]),
    cappedNameTokens: byName.capped,
  };
}

async function fetchShowsIn(column: string, values: string[]): Promise<ShowRow[]> {
  const found: ShowRow[] = [];
  for (const group of chunk(unique(values), 80)) {
    const { data, error } = await supabaseAdmin
      .from("shows")
      .select(SHOW_COLUMNS)
      .in(column, group);
    if (error) {
      console.warn("[roster-import] show lookup failed:", (error as DbError).code ?? "unknown");
      throw new Error("Show lookup failed.");
    }
    found.push(...asShows(data));
  }
  return found;
}

async function fetchShowsIlike(
  column: string,
  tokens: string[],
  limit: number
): Promise<{ rows: ShowRow[] }> {
  const found: ShowRow[] = [];
  for (const group of chunk(unique(tokens), 20)) {
    const parts = await Promise.all(
      group.map(async (token) => {
        const { data, error } = await supabaseAdmin
          .from("shows")
          .select(SHOW_COLUMNS)
          .ilike(column, likeContains(token))
          .limit(limit);
        if (error) {
          console.warn("[roster-import] show lookup failed:", (error as DbError).code ?? "unknown");
          throw new Error("Show lookup failed.");
        }
        const rows = asShows(data);
        if (rows.length >= limit) {
          console.warn("[roster-import] show lookup hit its cap");
          throw new Error("Show lookup failed.");
        }
        return rows;
      })
    );
    for (const part of parts) found.push(...part);
  }
  return { rows: found };
}

async function fetchNameCandidates(
  tokens: string[]
): Promise<{ rows: ShowRow[]; capped: Set<string> }> {
  const found: ShowRow[] = [];
  const capped = new Set<string>();
  for (const token of unique(tokens)) {
    const { data, error } = await supabaseAdmin
      .from("shows")
      .select(SHOW_COLUMNS)
      .ilike("name", likeContains(token))
      .limit(NAME_LOOKUP_LIMIT);
    if (error) {
      console.warn("[roster-import] show lookup failed:", (error as DbError).code ?? "unknown");
      throw new Error("Show lookup failed.");
    }
    const rows = asShows(data);
    if (rows.length >= NAME_LOOKUP_LIMIT) capped.add(token);
    found.push(...rows);
  }
  return { rows: found, capped };
}

async function loadLinks(showIds: string[]): Promise<LinkRow[]> {
  const found: LinkRow[] = [];
  for (const group of chunk(unique(showIds), 80)) {
    const { data, error } = await supabaseAdmin
      .from("agent_show_relationships")
      .select("id, agent_id, show_id, status, is_exclusive")
      .in("show_id", group);
    if (error) {
      console.warn("[roster-import] roster lookup failed:", (error as DbError).code ?? "unknown");
      throw new Error("Roster lookup failed.");
    }
    found.push(...asLinks(data));
  }
  return found;
}

function asShows(data: unknown): ShowRow[] {
  if (!Array.isArray(data)) return [];
  const rows: ShowRow[] = [];
  for (const item of data) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    if (typeof row.id !== "string" || typeof row.name !== "string") continue;
    rows.push({
      id: row.id,
      name: row.name,
      rss_url: typeof row.rss_url === "string" ? row.rss_url : null,
      youtube_channel_id:
        typeof row.youtube_channel_id === "string" ? row.youtube_channel_id : null,
      apple_id: typeof row.apple_id === "string" ? row.apple_id : null,
      is_discoverable: row.is_discoverable === true,
      agent_id: typeof row.agent_id === "string" ? row.agent_id : null,
    });
  }
  return rows;
}

function asLinks(data: unknown): LinkRow[] {
  if (!Array.isArray(data)) return [];
  const rows: LinkRow[] = [];
  for (const item of data) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    if (typeof row.id !== "string") continue;
    if (typeof row.agent_id !== "string" || typeof row.show_id !== "string") continue;
    rows.push({
      id: row.id,
      agent_id: row.agent_id,
      show_id: row.show_id,
      status: typeof row.status === "string" ? row.status : "",
      is_exclusive: row.is_exclusive === true,
    });
  }
  return rows;
}

function rssStoredVariants(norm: string): string[] {
  return [
    norm,
    `${norm}/`,
    `https://${norm}`,
    `https://${norm}/`,
    `http://${norm}`,
    `http://${norm}/`,
  ];
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

function slugFromName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function looksLikeJson(body: string): boolean {
  const trimmed = body.trim();
  return trimmed.startsWith("{") || trimmed.startsWith("[");
}

function parseJsonRows(body: string): ParsedRow[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new RosterImportError(400, "Send JSON rows or CSV text.");
  }
  const list = jsonList(parsed);
  if (!list) throw new RosterImportError(400, "Send JSON rows or CSV text.");
  return list.map((row, index) => parseRecord(row, index));
}

function jsonList(parsed: unknown): unknown[] | null {
  if (Array.isArray(parsed)) return parsed;
  if (!parsed || typeof parsed !== "object") return null;
  const record = parsed as Record<string, unknown>;
  if (Array.isArray(record.rows)) return record.rows;
  if (Array.isArray(record.shows)) return record.shows;
  return null;
}

function parseCsvRows(body: string): ParsedRow[] {
  const text = body.replace(/^\uFEFF/, "");
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length < 2) return [];
  const headers = parseCsvLine(lines[0]).map((header) => normalizeHeader(header));
  if (!headers.includes("name")) {
    throw new RosterImportError(400, "CSV needs a name column.");
  }
  const rows: ParsedRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i]);
    if (cols.every((col) => col.trim() === "")) continue;
    const record: Record<string, string> = {};
    headers.forEach((header, idx) => {
      if (!header) return;
      record[header] = cols[idx] ?? "";
    });
    rows.push(parseRecord(record, rows.length));
  }
  return rows;
}

function parseRecord(input: unknown, index: number): ParsedRow {
  const record = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const reasons: string[] = [];
  const name = text(record.name ?? record.show_name ?? record.show);
  const platform = parsePlatform(record.platform);
  const rssUrl = text(record.rss_url ?? record.rss);
  const appleRaw = text(record.apple_url ?? record.apple);
  const youtubeRaw = text(
    record.youtube_channel_id ?? record.youtube_url ?? record.youtube
  );
  const contactEmail = text(record.contact_email ?? record.email);
  const exclusive = parseBool(record.is_exclusive ?? record.exclusive, true);
  const confirm = parseBool(record.confirm, false);

  if (!name) reasons.push("Name is required.");
  else if (name.length > 300) reasons.push("Name is too long.");
  else if (!slugFromName(name)) reasons.push("Name needs a letter or number.");
  if (!platform) reasons.push("Platform must be podcast or youtube.");
  if (rssUrl && rssUrl.length > 2000) reasons.push("RSS URL is too long.");
  else if (rssUrl && !isHttpRssUrl(rssUrl)) {
    reasons.push("RSS URL must start with http or https.");
  }
  if (contactEmail && contactEmail.length > 320) {
    reasons.push("Contact email is too long.");
  } else if (contactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)) {
    reasons.push("Contact email is not valid.");
  }
  if (exclusive === "invalid") reasons.push("Exclusive must be true or false.");
  if (confirm === "invalid") reasons.push("Confirm must be true or false.");

  const appleId = appleRaw ? appleIdFromInput(appleRaw) : null;
  const youtubeChannelId = youtubeRaw ? youtubeChannelIdFromInput(youtubeRaw) : null;

  return {
    index,
    name: name ?? "",
    platform,
    rssUrl,
    appleId,
    youtubeChannelId,
    contactEmail,
    isExclusive: exclusive === "invalid" ? true : exclusive,
    confirm: confirm === true,
    reasons,
  };
}

/** http and https only. ftp, javascript, and unparseable values are rejected. */
function isHttpRssUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function parsePlatform(value: unknown): "podcast" | "youtube" | null {
  const textValue = text(value)?.toLowerCase();
  if (textValue === "podcast" || textValue === "youtube") return textValue;
  return null;
}

function parseBool(value: unknown, fallback: boolean): boolean | "invalid" {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (value === 1) return true;
    if (value === 0) return false;
    return "invalid";
  }
  const token = String(value).trim().toLowerCase();
  if (token === "true" || token === "yes" || token === "1") return true;
  if (token === "false" || token === "no" || token === "0") return false;
  return "invalid";
}

export function youtubeChannelIdFromInput(value: string): string | null {
  const trimmed = value.trim();
  if (UC_ID.test(trimmed)) return trimmed;
  try {
    const url = new URL(trimmed);
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    if (host !== "youtube.com" && host !== "m.youtube.com" && host !== "music.youtube.com") {
      return null;
    }
    const parts = url.pathname.split("/").filter(Boolean);
    const at = parts.findIndex((part) => part.toLowerCase() === "channel");
    if (at < 0) return null;
    const id = parts[at + 1] ?? "";
    return UC_ID.test(id) ? id : null;
  } catch {
    return null;
  }
}

export function appleIdFromInput(value: string): string | null {
  const trimmed = value.trim();
  const direct = /^(?:id)?(\d{5,20})$/i.exec(trimmed);
  if (direct) return direct[1];
  const fromUrl = /\/id(\d{5,20})(?=[/?#]|$)/i.exec(trimmed);
  return fromUrl ? fromUrl[1] : null;
}

function appleIdFromStored(value: string | null): string | null {
  if (!value) return null;
  return appleIdFromInput(value);
}

function text(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function normalizeHeader(header: string): string {
  return header.trim().toLowerCase().replace(/[\s-]+/g, "_");
}

function parseCsvLine(line: string): string[] {
  const cols: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        current += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      cols.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  cols.push(current);
  return cols;
}

function dedupeShows(shows: ShowRow[]): ShowRow[] {
  const seen = new Set<string>();
  const out: ShowRow[] = [];
  for (const show of shows) {
    if (seen.has(show.id)) continue;
    seen.add(show.id);
    out.push(show);
  }
  return out;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function chunk<T>(values: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < values.length; i += size) out.push(values.slice(i, i + size));
  return out;
}
