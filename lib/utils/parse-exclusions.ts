// Server-side parse of the brief's free-text exclusions field. Previously
// the interpretation LLM produced exclusions_parsed in its output schema —
// a deterministic split is not a job for a model, and a hallucinated
// or dropped exclusion is a real campaign-safety bug.

// Double-quote characters that group a segment: straight plus curly open/close.
// Apostrophes (') are deliberately NOT grouping characters — they appear inside
// real brand names ("Trader Joe's") and must never start a quoted run.
const QUOTE_CHARS = new Set(['"', "“", "”"]);
const DELIMITERS = new Set([",", ";", "\n", "\r"]);

/**
 * Split raw exclusions text into entries. Splits on commas, semicolons, and
 * newlines — but a delimiter inside a double-quoted segment is literal, so a
 * quoted brand name like "Athletic Greens, Inc." stays one entry. Quote
 * characters are stripped from the output; an unterminated quote flushes its
 * buffer as the final entry (no data loss). Entries are trimmed, empties
 * dropped, and duplicates removed case-insensitively keeping the first casing.
 */
export function parseExclusions(raw: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let inQuote = false;
  for (const ch of raw) {
    if (QUOTE_CHARS.has(ch)) {
      inQuote = !inQuote;
      continue; // strip the quote character itself
    }
    if (!inQuote && DELIMITERS.has(ch)) {
      tokens.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  tokens.push(current); // flush the trailing buffer (incl. an unterminated quote)

  const seen = new Set<string>();
  const result: string[] = [];
  for (const token of tokens) {
    const trimmed = token.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(trimmed);
  }
  return result;
}
