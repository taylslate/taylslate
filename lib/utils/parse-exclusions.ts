// Server-side parse of the brief's free-text exclusions field. Previously
// the interpretation LLM produced exclusions_parsed in its output schema —
// a deterministic string split is not a job for a model, and a hallucinated
// or dropped exclusion is a real campaign-safety bug.

/**
 * Split raw exclusions text on commas, semicolons, and newlines; trim each
 * entry; drop empties; dedupe case-insensitively keeping the first casing.
 */
export function parseExclusions(raw: string): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const part of raw.split(/[,;\r\n]+/)) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(trimmed);
  }
  return result;
}
