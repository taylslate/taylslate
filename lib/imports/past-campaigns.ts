// Parse a brand's past campaign file into drafts shaped like migration 054.
// Parsing does not write. The save route stamps brand_id from the session
// and sets matched_show_id only for one normalized catalog name
// (migration 068). A draft never carries a caller-chosen show id.

import ExcelJS from "exceljs";
import { callLLMWithFallback, loadPrompt } from "@/lib/llm/client";
import { buildPartialIO, validateIOData } from "@/lib/validation/io-validation";
import { dealsFromImportedIO } from "@/lib/deals/import-deals";
import { parseCSV } from "@/lib/imports/csv";
import {
  assertXlsxUncompressedCap,
  PAST_CAMPAIGN_MAX_XLSX_UNCOMPRESSED_BYTES,
  XlsxCapError,
} from "@/lib/imports/xlsx-limit";

export { PAST_CAMPAIGN_MAX_XLSX_UNCOMPRESSED_BYTES };

export const PAST_CAMPAIGN_MAX_BYTES = 10 * 1024 * 1024;
export const PAST_CAMPAIGN_MAX_ROWS = 2000;

export type PastCampaignSourceKind = "csv" | "xlsx" | "pdf";

export const CANONICAL_FIELDS = [
  "show_name",
  "flight_start",
  "flight_end",
  "placement",
  "price_type",
  "rate",
  "episodes",
  "spend",
  "conversions",
  "downloads",
] as const;

export type CanonicalField = (typeof CANONICAL_FIELDS)[number];

export type PastCampaignPriceType = "cpm" | "flat";

export interface PastCampaignDraft {
  show_name: string;
  matched_show_id: string | null;
  flight_start: string | null;
  flight_end: string | null;
  placement: string | null;
  price_type: PastCampaignPriceType | null;
  rate: number | null;
  episodes: number | null;
  spend: number | null;
  conversions: number | null;
  downloads: number | null;
  raw: Record<string, unknown>;
}

export interface PastCampaignSaveInput {
  source_kind: PastCampaignSourceKind;
  file_name: string | null;
  pooling_consent: boolean;
  terms_version: string | null;
  drafts: PastCampaignDraft[];
}

const MIME_BY_KIND: Record<PastCampaignSourceKind, ReadonlySet<string>> = {
  csv: new Set([
    "text/csv",
    "application/csv",
    "text/plain",
    "application/vnd.ms-excel",
  ]),
  xlsx: new Set([
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ]),
  pdf: new Set(["application/pdf"]),
};

const PG_INT_MAX = 2_147_483_647;

export class PastCampaignImportError extends Error {
  readonly status: number;
  readonly code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "PastCampaignImportError";
    this.status = status;
    this.code = code;
  }
}

export function detectPastCampaignKind(file: {
  name: string;
  type: string;
  size: number;
}): PastCampaignSourceKind {
  if (file.size > PAST_CAMPAIGN_MAX_BYTES) {
    throw new PastCampaignImportError("File must be under 10MB", 400);
  }
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (ext !== "csv" && ext !== "xlsx" && ext !== "pdf") {
    throw new PastCampaignImportError(
      "Only CSV, XLSX, and PDF files are supported",
      400
    );
  }
  const mime = file.type.split(";")[0]?.trim().toLowerCase() ?? "";
  if (!MIME_BY_KIND[ext].has(mime)) {
    throw new PastCampaignImportError(
      "File type does not match its extension",
      400
    );
  }
  return ext;
}

export async function parsePastCampaignFile(
  kind: PastCampaignSourceKind,
  bytes: Uint8Array,
  deps?: {
    extractIo?: (bytes: Uint8Array) => Promise<Record<string, unknown>>;
  }
): Promise<PastCampaignDraft[]> {
  if (kind === "csv") return parseCsv(new TextDecoder("utf-8").decode(bytes));
  if (kind === "xlsx") return parseXlsx(bytes);
  if (!deps?.extractIo) {
    throw new PastCampaignImportError(
      "PDF extraction is not configured. Add an ANTHROPIC_API_KEY environment variable, or use manual entry instead.",
      503,
      "NO_API_KEY"
    );
  }
  return parsePdf(bytes, { extractIo: deps.extractIo });
}

export async function parseCsv(text: string): Promise<PastCampaignDraft[]> {
  const table = parseCSV(text).map((row) => row.map((cell) => cell));
  return draftsFromMatrix(table);
}

export async function parseXlsx(
  bytes: Uint8Array,
  options?: { maxUncompressedBytes?: number }
): Promise<PastCampaignDraft[]> {
  try {
    await assertXlsxUncompressedCap(
      bytes,
      options?.maxUncompressedBytes ?? PAST_CAMPAIGN_MAX_XLSX_UNCOMPRESSED_BYTES
    );
  } catch (err) {
    if (err instanceof XlsxCapError) {
      throw new PastCampaignImportError(err.message, 400);
    }
    throw err;
  }
  const workbook = new ExcelJS.Workbook();
  // exceljs types a pre-generic Node Buffer. The bytes are unchanged.
  const body = Buffer.from(bytes) as unknown as Parameters<ExcelJS.Xlsx["load"]>[0];
  await workbook.xlsx.load(body);
  const sheet = workbook.worksheets[0];
  if (!sheet) {
    throw new PastCampaignImportError("No campaign rows found", 400);
  }
  return draftsFromMatrix(sheetToMatrix(sheet));
}

export async function parsePdf(
  bytes: Uint8Array,
  deps: { extractIo: (bytes: Uint8Array) => Promise<Record<string, unknown>> }
): Promise<PastCampaignDraft[]> {
  if (bytes.byteLength === 0) {
    throw new PastCampaignImportError("No campaign rows found", 400);
  }
  const extracted = await deps.extractIo(bytes);
  return draftsFromExtractedIO(extracted);
}

export function draftsFromExtractedIO(
  extracted: Record<string, unknown>
): PastCampaignDraft[] {
  const validation = validateIOData(extracted);
  if (!validation.valid) {
    throw new PastCampaignImportError(
      validation.errors[0] ?? "The PDF is not a recognizable insertion order.",
      422
    );
  }

  const originals = groupLineItems(extracted.line_items);
  const deals = dealsFromImportedIO(buildPartialIO(extracted));
  if (deals.length > PAST_CAMPAIGN_MAX_ROWS) {
    throw new PastCampaignImportError(
      "Past campaign files are limited to 2,000 rows",
      400
    );
  }

  const drafts = deals.map((deal) => {
    const body = deal.body;
    const priceType = priceTypeFromDeal(body.price_type);
    const rate =
      priceType === "flat" ? moneyOrNull(body.flat_rate) : moneyOrNull(body.cpm_rate);
    const episodes = intOrNull(body.num_episodes);
    const downloads = intOrNull(body.guaranteed_downloads);
    const showName = String(body.show_name || deal.label).trim() || deal.label;
    return {
      show_name: showName.slice(0, 500),
      matched_show_id: null,
      flight_start: parseDate(body.flight_start),
      flight_end: parseDate(body.flight_end),
      placement: normalizePlacement(body.placement),
      price_type: priceType,
      rate,
      episodes,
      spend: spendFromDeal(priceType, rate, episodes, downloads),
      conversions: null,
      downloads,
      raw: {
        show_name: deal.label,
        line_items: originals.get(deal.label) ?? [],
      },
    } satisfies PastCampaignDraft;
  });

  if (drafts.length === 0) {
    throw new PastCampaignImportError("No campaign rows found", 400);
  }
  return drafts;
}

export function normalizeRecord(
  source: Record<string, unknown>,
  picked: Partial<Record<CanonicalField, unknown>>
): PastCampaignDraft | null {
  const show = scalarText(picked.show_name).trim();
  if (!show) return null;
  return {
    show_name: show.slice(0, 500),
    matched_show_id: null,
    flight_start: parseDate(picked.flight_start),
    flight_end: parseDate(picked.flight_end),
    placement: normalizePlacement(picked.placement),
    price_type: normalizePriceType(picked.price_type),
    rate: moneyOrNull(picked.rate),
    episodes: intOrNull(picked.episodes),
    spend: moneyOrNull(picked.spend),
    conversions: intOrNull(picked.conversions),
    downloads: intOrNull(picked.downloads),
    raw: source,
  };
}

export function parseSaveBody(body: unknown): PastCampaignSaveInput {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new PastCampaignImportError("Invalid JSON", 400);
  }
  const record = body as Record<string, unknown>;
  const sourceKind = parseSourceKind(record.source_kind);
  const pooling = parseConsent(record.pooling_consent);
  const terms = parseTermsVersion(record.terms_version, pooling);
  const rows = record.records;
  if (!Array.isArray(rows)) {
    throw new PastCampaignImportError(
      "records must be a list of campaign rows",
      400
    );
  }
  if (rows.length === 0) {
    throw new PastCampaignImportError("At least one campaign row is required", 400);
  }
  if (rows.length > PAST_CAMPAIGN_MAX_ROWS) {
    throw new PastCampaignImportError(
      "Past campaign files are limited to 2,000 rows",
      400
    );
  }

  return {
    source_kind: sourceKind,
    file_name: cleanFileName(record.file_name),
    pooling_consent: pooling,
    terms_version: terms,
    drafts: rows.map((row, index) => sanitizeDraft(row, index)),
  };
}

// Same rules as normalize_show_match_key in migration 068. U+2019 folds
// to an apostrophe, U+00A0 folds to a space, then case follows
// toLowerCase. A change here has to change that SQL function too.
export const SHOW_MATCH_PUNCTUATION = "!\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~";

const SHOW_MATCH_WHITESPACE = new Set([9, 10, 11, 12, 13, 32]);

export type ShowMatchStatus = "matched" | "ambiguous";

export type ShowMatchReason =
  | "unique_normalized_name"
  | "no_normalized_match"
  | "multiple_normalized_matches";

export interface ShowMatchCandidate {
  id: string;
  name: string;
  is_discoverable?: boolean | null;
  agent_id?: string | null;
}

export interface ShowMatchDecision {
  matched_show_id: string | null;
  show_match_status: ShowMatchStatus;
  show_match_reason: ShowMatchReason;
  show_match_confidence: 0 | 1;
}

export function normalizeShowMatchKey(name: string): string {
  const folded = name.replaceAll("\u2019", "'").replaceAll("\u00A0", " ").toLowerCase();
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

export function eligibleShowCandidate(
  show: ShowMatchCandidate,
  callerId: string
): boolean {
  if (show.is_discoverable === true) return true;
  return Boolean(callerId) && Boolean(show.agent_id) && show.agent_id === callerId;
}

export function decideShowMatch(
  showName: string,
  candidates: readonly ShowMatchCandidate[],
  callerId: string
): ShowMatchDecision {
  const key = normalizeShowMatchKey(showName);
  if (!key) return ambiguousDecision("no_normalized_match");

  const ids: string[] = [];
  for (const show of candidates) {
    if (!show.id || ids.includes(show.id)) continue;
    if (!eligibleShowCandidate(show, callerId)) continue;
    if (normalizeShowMatchKey(show.name) !== key) continue;
    ids.push(show.id);
  }

  if (ids.length === 1) {
    return {
      matched_show_id: ids[0],
      show_match_status: "matched",
      show_match_reason: "unique_normalized_name",
      show_match_confidence: 1,
    };
  }
  if (ids.length === 0) return ambiguousDecision("no_normalized_match");
  return ambiguousDecision("multiple_normalized_matches");
}

export async function matchPastCampaignShows(
  names: string[],
  callerId: string,
  query: (matchKey: string) => Promise<ShowMatchCandidate[]>
): Promise<Map<string, ShowMatchDecision>> {
  const map = new Map<string, ShowMatchDecision>();
  const keys: string[] = [];
  for (const name of names) {
    const key = normalizeShowMatchKey(name);
    if (!key || keys.includes(key)) continue;
    keys.push(key);
  }

  for (const key of keys) {
    let rows: ShowMatchCandidate[] = [];
    try {
      const loaded = await query(key);
      rows = Array.isArray(loaded) ? loaded : [];
    } catch {
      rows = [];
    }
    map.set(key, decideShowMatch(key, rows, callerId));
  }
  return map;
}

export function buildRecordInserts(
  importId: string,
  brandId: string,
  drafts: PastCampaignDraft[],
  matches: Map<string, ShowMatchDecision>
): Record<string, unknown>[] {
  return drafts.map((draft) => {
    const key = normalizeShowMatchKey(draft.show_name);
    const decision =
      (key && matches.get(key)) || ambiguousDecision("no_normalized_match");
    return {
      import_id: importId,
      brand_id: brandId,
      show_name: draft.show_name,
      matched_show_id: decision.matched_show_id,
      show_match_status: decision.show_match_status,
      show_match_reason: decision.show_match_reason,
      show_match_confidence: decision.show_match_confidence,
      flight_start: draft.flight_start,
      flight_end: draft.flight_end,
      placement: draft.placement,
      price_type: draft.price_type,
      rate: draft.rate,
      episodes: draft.episodes,
      spend: draft.spend,
      conversions: draft.conversions,
      downloads: draft.downloads,
      raw: draft.raw,
    };
  });
}

function ambiguousDecision(reason: ShowMatchReason): ShowMatchDecision {
  return {
    matched_show_id: null,
    show_match_status: "ambiguous",
    show_match_reason: reason,
    show_match_confidence: 0,
  };
}

async function draftsFromMatrix(table: unknown[][]): Promise<PastCampaignDraft[]> {
  if (table.length < 2) {
    throw new PastCampaignImportError("No campaign rows found", 400);
  }
  const headers = table[0].map((cell, index) => {
    const text = scalarText(cell).trim();
    return text || `column_${index + 1}`;
  });
  const dataRows = table.slice(1).filter((row) =>
    row.some((cell) => scalarText(cell).trim() !== "")
  );
  if (dataRows.length === 0) {
    throw new PastCampaignImportError("No campaign rows found", 400);
  }
  if (dataRows.length > PAST_CAMPAIGN_MAX_ROWS) {
    throw new PastCampaignImportError(
      "Past campaign files are limited to 2,000 rows",
      400
    );
  }

  const mapping = await mapColumnsWithLLM(headers, dataRows);
  const indexes = resolveIndexes(headers, mapping);
  if (indexes.show_name < 0) {
    throw new PastCampaignImportError("Could not map a show name column", 422);
  }

  const keys = uniqueHeaderKeys(headers);
  const drafts: PastCampaignDraft[] = [];
  for (const row of dataRows) {
    const source: Record<string, unknown> = {};
    keys.forEach((key, index) => {
      const value = row[index];
      source[key] = value == null ? null : value;
    });
    const picked = {} as Partial<Record<CanonicalField, unknown>>;
    for (const field of CANONICAL_FIELDS) {
      const index = indexes[field];
      picked[field] = index >= 0 ? row[index] : null;
    }
    const draft = normalizeRecord(source, picked);
    if (draft) drafts.push(draft);
  }

  if (drafts.length === 0) {
    throw new PastCampaignImportError("No campaign rows found", 400);
  }
  return drafts;
}

async function mapColumnsWithLLM(
  headers: string[],
  dataRows: unknown[][]
): Promise<Partial<Record<CanonicalField, string | null>>> {
  const sample = dataRows.slice(0, 3).map((row) =>
    headers.map((_, index) => {
      const value = row[index];
      if (value == null) return null;
      if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
        return value;
      }
      return scalarText(value);
    })
  );

  let message: Awaited<ReturnType<typeof callLLMWithFallback>>;
  try {
    message = await callLLMWithFallback({
      system: loadPrompt("past-campaign-mapping.md"),
      userContent: JSON.stringify({ headers, sample_rows: sample }),
      maxTokens: 1024,
      maxRetries: 0,
    });
  } catch (err) {
    if (isMissingApiKey(err)) {
      throw new PastCampaignImportError(
        "Past campaign mapping is not configured. Add an ANTHROPIC_API_KEY environment variable.",
        503,
        "NO_API_KEY"
      );
    }
    throw new PastCampaignImportError("Could not map columns in this file", 502);
  }

  if (message.stop_reason === "refusal") {
    throw new PastCampaignImportError("Could not map columns in this file", 422);
  }
  const textBlock = message.content.find((block) => block.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new PastCampaignImportError("Could not map columns in this file", 422);
  }
  return parseColumnMapping(textBlock.text);
}

function parseColumnMapping(text: string): Partial<Record<CanonicalField, string | null>> {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new PastCampaignImportError("Could not map columns in this file", 422);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new PastCampaignImportError("Could not map columns in this file", 422);
  }
  const record = parsed as Record<string, unknown>;
  const source =
    record.columns && typeof record.columns === "object" && !Array.isArray(record.columns)
      ? (record.columns as Record<string, unknown>)
      : record;

  const mapping: Partial<Record<CanonicalField, string | null>> = {};
  for (const field of CANONICAL_FIELDS) {
    const value = source[field];
    mapping[field] = typeof value === "string" && value.trim() ? value.trim() : null;
  }
  return mapping;
}

function resolveIndexes(
  headers: string[],
  mapping: Partial<Record<CanonicalField, string | null>>
): Record<CanonicalField, number> {
  const indexes = {} as Record<CanonicalField, number>;
  for (const field of CANONICAL_FIELDS) {
    const fromModel = headerIndex(headers, mapping[field] ?? null);
    indexes[field] = fromModel >= 0 ? fromModel : fallbackHeader(field, headers);
  }
  return indexes;
}

function headerIndex(headers: string[], name: string | null): number {
  if (!name) return -1;
  const want = name.trim().toLowerCase();
  return headers.findIndex((header) => header.trim().toLowerCase() === want);
}

function fallbackHeader(field: CanonicalField, headers: string[]): number {
  const aliases = new Set([field, field.replace(/_/g, " ")]);
  return headers.findIndex((header) => aliases.has(header.trim().toLowerCase()));
}

function uniqueHeaderKeys(headers: string[]): string[] {
  const seen = new Map<string, number>();
  return headers.map((header) => {
    const count = seen.get(header) ?? 0;
    seen.set(header, count + 1);
    return count === 0 ? header : `${header} (${count + 1})`;
  });
}

function sheetToMatrix(sheet: ExcelJS.Worksheet): unknown[][] {
  if (sheet.rowCount > PAST_CAMPAIGN_MAX_ROWS + 5000) {
    throw new PastCampaignImportError(
      "Past campaign files are limited to 2,000 rows",
      400
    );
  }
  const width = Math.max(sheet.columnCount, sheet.getRow(1).cellCount, 1);
  const matrix: unknown[][] = [];
  let dataRows = 0;
  for (let r = 1; r <= sheet.rowCount; r++) {
    const cells: unknown[] = [];
    let any = false;
    for (let c = 1; c <= width; c++) {
      const value = cellValue(sheet.getRow(r).getCell(c).value);
      cells.push(value);
      if (value != null && String(value).trim() !== "") any = true;
    }
    if (r === 1) {
      matrix.push(cells);
      continue;
    }
    if (!any) continue;
    dataRows += 1;
    if (dataRows > PAST_CAMPAIGN_MAX_ROWS) {
      throw new PastCampaignImportError(
        "Past campaign files are limited to 2,000 rows",
        400
      );
    }
    matrix.push(cells);
  }
  return matrix;
}

function cellValue(value: ExcelJS.CellValue): string | number | boolean | null {
  if (value == null) return null;
  if (value instanceof Date) return formatLocalDate(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "string") return value;
  if (typeof value === "object") {
    if ("richText" in value && Array.isArray(value.richText)) {
      return value.richText.map((part) => part.text ?? "").join("");
    }
    if ("result" in value && value.result !== undefined) {
      return cellValue(value.result ?? null);
    }
    if ("text" in value && typeof value.text === "string") return value.text;
    if ("error" in value) return null;
  }
  return null;
}

function groupLineItems(value: unknown): Map<string, unknown[]> {
  const grouped = new Map<string, unknown[]>();
  if (!Array.isArray(value)) return grouped;
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const showName = scalarText((item as { show_name?: unknown }).show_name).trim();
    const key = showName || "Untitled show";
    const list = grouped.get(key) ?? [];
    list.push(item);
    grouped.set(key, list);
  }
  return grouped;
}

function priceTypeFromDeal(value: unknown): PastCampaignPriceType | null {
  if (value === "flat_rate" || value === "flat") return "flat";
  if (value === "cpm") return "cpm";
  return null;
}

function spendFromDeal(
  priceType: PastCampaignPriceType | null,
  rate: number | null,
  episodes: number | null,
  downloads: number | null
): number | null {
  if (priceType == null || rate == null || episodes == null) return null;
  if (priceType === "flat") return money(rate * episodes);
  if (downloads == null) return null;
  return money((downloads / 1000) * rate * episodes);
}

export function normalizePriceType(value: unknown): PastCampaignPriceType | null {
  const text = scalarText(value).trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (!text) return null;
  if (text === "cpm" || text === "cost_per_mille") return "cpm";
  if (text === "flat" || text === "flat_rate" || text === "fixed" || text === "fixed_rate") {
    return "flat";
  }
  return null;
}

export function normalizePlacement(value: unknown): string | null {
  const text = scalarText(value).trim();
  if (!text) return null;
  const lowered = text.toLowerCase();
  if (/pre[-\s]?roll|\bpre\b/.test(lowered)) return "pre-roll";
  if (/post[-\s]?roll|\bpost\b/.test(lowered)) return "post-roll";
  if (/mid[-\s]?roll|\bmid\b/.test(lowered)) return "mid-roll";
  return text.slice(0, 80);
}

function sanitizeDraft(input: unknown, index: number): PastCampaignDraft {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new PastCampaignImportError(`Row ${index + 1} is missing a show name`, 400);
  }
  const row = input as Record<string, unknown>;
  const draft = normalizeRecord(plainObject(row.raw), {
    show_name: row.show_name,
    flight_start: row.flight_start,
    flight_end: row.flight_end,
    placement: row.placement,
    price_type: row.price_type,
    rate: row.rate,
    episodes: row.episodes,
    spend: row.spend,
    conversions: row.conversions,
    downloads: row.downloads,
  });
  if (!draft) {
    throw new PastCampaignImportError(`Row ${index + 1} is missing a show name`, 400);
  }
  return draft;
}

function parseSourceKind(value: unknown): PastCampaignSourceKind {
  if (value === "csv" || value === "xlsx" || value === "pdf") return value;
  throw new PastCampaignImportError("source_kind must be csv, xlsx, or pdf", 400);
}

function parseConsent(value: unknown): boolean {
  if (value == null) return false;
  if (typeof value === "boolean") return value;
  throw new PastCampaignImportError("pooling_consent must be true or false", 400);
}

function parseTermsVersion(value: unknown, consent: boolean): string | null {
  if (!consent) return null;
  if (typeof value !== "string" || !value.trim()) {
    throw new PastCampaignImportError(
      "terms_version is required when pooling consent is true",
      400
    );
  }
  const trimmed = value.trim();
  if (trimmed.length > 80) {
    throw new PastCampaignImportError("terms_version is too long", 400);
  }
  return trimmed;
}

function cleanFileName(value: unknown): string | null {
  if (value == null || value === "") return null;
  if (typeof value !== "string") {
    throw new PastCampaignImportError("file_name must be text", 400);
  }
  const base = value.trim().split(/[/\\]/).pop()?.trim() ?? "";
  if (!base) return null;
  return base.slice(0, 200);
}

function plainObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  try {
    const parsed = JSON.parse(JSON.stringify(value)) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed as Record<string, unknown>;
  } catch {
    return {};
  }
}

function scalarText(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;
  const cleaned = value.trim().replace(/[$,]/g, "").replace(/%$/, "");
  if (!cleaned) return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

function money(value: number): number {
  return Math.round(value * 100) / 100;
}

function moneyOrNull(value: unknown): number | null {
  const parsed = toNumber(value);
  if (parsed == null || parsed < 0) return null;
  return money(parsed);
}

function intOrNull(value: unknown): number | null {
  const parsed = toNumber(value);
  if (parsed == null || parsed < 0 || parsed > PG_INT_MAX) return null;
  return Math.round(parsed);
}

function parseDate(value: unknown): string | null {
  if (value instanceof Date) return formatLocalDate(value);
  if (typeof value === "number" && value >= 20_000 && value <= 80_000) {
    const utc = new Date(Date.UTC(1899, 11, 30) + Math.round(value) * 86_400_000);
    if (Number.isNaN(utc.getTime())) return null;
    return utc.toISOString().slice(0, 10);
  }
  const text = scalarText(value).trim();
  if (!text) return null;
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) {
    return validDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  }
  const slash = text.match(/^(\d{1,2})[/.](\d{1,2})[/.](\d{2,4})$/)
    ?? text.match(/^(\d{1,2})-(\d{1,2})-(\d{2,4})$/);
  if (!slash) return null;
  let month = Number(slash[1]);
  let day = Number(slash[2]);
  let year = Number(slash[3]);
  if (year < 100) year += 2000;
  if (month > 12 && day <= 12) {
    const swap = month;
    month = day;
    day = swap;
  }
  return validDate(year, month, day);
}

function validDate(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const utc = new Date(Date.UTC(year, month - 1, day));
  if (
    utc.getUTCFullYear() !== year ||
    utc.getUTCMonth() !== month - 1 ||
    utc.getUTCDate() !== day
  ) {
    return null;
  }
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function formatLocalDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function isMissingApiKey(err: unknown): boolean {
  const text = err instanceof Error ? err.message : String(err);
  return /api[_ ]?key|authentication method|ANTHROPIC/i.test(text);
}
