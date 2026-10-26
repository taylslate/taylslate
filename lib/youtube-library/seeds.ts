// data/youtube-seeds.csv is header only until Chris fills it in.
// Each data row queues one seed_channel value: channel_id when that
// cell is set, otherwise channel_url.

import { readFileSync } from "node:fs";
import { join } from "node:path";

export const YOUTUBE_SEEDS_PATH = join(process.cwd(), "data", "youtube-seeds.csv");

const CHANNEL_ID = /^UC[0-9A-Za-z_-]{20,32}$/;

export type ParsedChannelRef =
  | { kind: "id"; value: string }
  | { kind: "handle"; value: string }
  | { kind: "username"; value: string };

/** Channel id, @handle, /channel/, /@handle, /user/, or /c/ from a seed cell or a stored link. */
export function parseChannelRef(raw: string): ParsedChannelRef | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  if (CHANNEL_ID.test(trimmed)) return { kind: "id", value: trimmed };

  if (trimmed.startsWith("@")) {
    const handle = trimmed.slice(1).trim();
    if (!handle || /\s/.test(handle)) return null;
    return { kind: "handle", value: handle };
  }

  let url: URL | null = null;
  try {
    url = new URL(trimmed.includes("://") ? trimmed : `https://${trimmed}`);
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^www\./, "").toLowerCase();
  if (host !== "youtube.com" && host !== "m.youtube.com" && host !== "youtu.be") return null;

  const parts = url.pathname.split("/").filter(Boolean).map((part) => decodeURIComponent(part));
  if (parts[0] === "channel" && parts[1] && CHANNEL_ID.test(parts[1])) {
    return { kind: "id", value: parts[1] };
  }
  if (parts[0]?.startsWith("@")) {
    const handle = parts[0].slice(1).trim();
    if (!handle) return null;
    return { kind: "handle", value: handle };
  }
  if ((parts[0] === "user" || parts[0] === "c") && parts[1]) {
    return { kind: "username", value: parts[1] };
  }
  return null;
}

export function normalizeHandle(value: string): string {
  return value.trim().replace(/^@/, "").toLowerCase();
}

/** True when a stored YouTube link is this channel id or this channel's handle. */
export function linkResolvesToChannel(
  link: string,
  channelId: string,
  customUrl?: string | null
): boolean {
  const parsed = parseChannelRef(link);
  if (!parsed) return false;
  if (parsed.kind === "id") return parsed.value === channelId;
  if (!customUrl) return false;
  return normalizeHandle(parsed.value) === normalizeHandle(customUrl);
}

function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        quoted = !quoted;
      }
      continue;
    }
    if (ch === "," && !quoted) {
      cells.push(current.trim());
      current = "";
      continue;
    }
    current += ch;
  }
  cells.push(current.trim());
  return cells;
}

/**
 * Seed values from the CSV. The header row is skipped. A row uses
 * channel_id when present, otherwise channel_url. Blank rows are skipped.
 * Duplicate values are dropped.
 */
export function parseYoutubeSeedCsv(text: string): string[] {
  const lines = text.split(/\r?\n/);
  const values: string[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith("#")) continue;
    const cells = splitCsvLine(line);
    const header = cells.join(",").toLowerCase().replace(/\s/g, "");
    if (i === 0 && header.includes("channel_url") && header.includes("channel_id")) continue;
    const url = cells[0] ?? "";
    const id = cells[1] ?? "";
    const value = (id || url).trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    values.push(value);
  }
  return values;
}

export function readYoutubeSeedCsv(path = YOUTUBE_SEEDS_PATH): string[] {
  try {
    return parseYoutubeSeedCsv(readFileSync(path, "utf8"));
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return [];
    throw err;
  }
}
