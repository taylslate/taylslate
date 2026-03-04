import type { Show } from "@/lib/data/types";

export interface ParsedCSVRow {
  show_name: string;
  hosts: string;
  category: string;
  channel_type: string;
  ad_type: string;
  downloads: number;
  cpm: number;
  price_per_spot: number;
  gender_split: string;
  audience_age: string;
  notes: string;
}

export interface ShowMatchResult {
  csv_row: ParsedCSVRow;
  matched_show: Show | null;
  match_confidence: number;
  cpm_override: number | null;
  is_new: boolean;
}

// ---- CSV Parsing ----

export function parseCSV(text: string): ParsedCSVRow[] {
  const rows = parseCSVRows(text);
  if (rows.length < 2) return [];

  const results: ParsedCSVRow[] = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const name = row[0]?.trim();
    if (!name) continue;

    const downloads = parseNumber(row[6]);
    const cpm = parseNumber(row[7]);
    if (downloads === 0 && cpm === 0) continue;

    results.push({
      show_name: name,
      hosts: row[1]?.trim() || "",
      category: row[2]?.trim() || "",
      channel_type: row[3]?.trim() || "",
      ad_type: row[5]?.trim() || "",
      downloads,
      cpm,
      price_per_spot: parseNumber(row[8]),
      gender_split: row[9]?.trim() || "",
      audience_age: row[10]?.trim() || "",
      notes: row[11]?.trim() || "",
    });
  }
  return results;
}

function parseCSVRows(text: string): string[][] {
  const rows: string[][] = [];
  let current = "";
  let inQuotes = false;
  let row: string[] = [];

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') {
        current += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ",") {
        row.push(current.trim());
        current = "";
      } else if (ch === "\n" || ch === "\r") {
        if (ch === "\r" && text[i + 1] === "\n") i++;
        row.push(current.trim());
        if (row.length > 0) rows.push(row);
        row = [];
        current = "";
      } else {
        current += ch;
      }
    }
  }
  if (current || row.length > 0) {
    row.push(current.trim());
    rows.push(row);
  }
  return rows;
}

function parseNumber(str: string | undefined): number {
  if (!str) return 0;
  return parseFloat(str.replace(/[$,\s]/g, "")) || 0;
}

// ---- Fuzzy Matching ----

export function normalizeShowName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^\w\s]/g, "")
    .replace(/\b(the|a|an|podcast|show|with|and|of)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function levenshteinDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));

  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

export function computeMatchConfidence(csvName: string, dbName: string): number {
  if (csvName.toLowerCase() === dbName.toLowerCase()) return 100;

  const normCSV = normalizeShowName(csvName);
  const normDB = normalizeShowName(dbName);

  if (normCSV === normDB) return 95;
  if (normCSV.includes(normDB) || normDB.includes(normCSV)) return 80;

  const maxLen = Math.max(normCSV.length, normDB.length);
  if (maxLen === 0) return 0;

  const distance = levenshteinDistance(normCSV, normDB);
  const similarity = 1 - distance / maxLen;
  return Math.round(similarity * 100);
}

export function findBestMatch(
  csvName: string,
  shows: Show[]
): { show: Show | null; confidence: number } {
  let bestShow: Show | null = null;
  let bestScore = 0;

  for (const show of shows) {
    const score = computeMatchConfidence(csvName, show.name);
    if (score > bestScore) {
      bestScore = score;
      bestShow = show;
    }
  }

  return {
    show: bestScore >= 60 ? bestShow : null,
    confidence: bestScore >= 60 ? bestScore : 0,
  };
}

export function matchCSVToShows(
  csvRows: ParsedCSVRow[],
  shows: Show[]
): ShowMatchResult[] {
  return csvRows.map((row) => {
    const { show, confidence } = findBestMatch(row.show_name, shows);

    let cpmOverride: number | null = null;
    if (show && row.cpm > 0) {
      const dbCpm = show.rate_card.midroll_cpm ?? show.rate_card.flat_rate ?? 0;
      if (Math.abs(row.cpm - dbCpm) > 0.01) {
        cpmOverride = row.cpm;
      }
    }

    return {
      csv_row: row,
      matched_show: show,
      match_confidence: confidence,
      cpm_override: cpmOverride,
      is_new: !show,
    };
  });
}
