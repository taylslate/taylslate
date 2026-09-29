// Aircheck step 2. Decide whether a stored transcript contains the read
// the IO describes, and write that judgment on the same airchecks row.
// Does not mark the line delivered and does not charge.

import type {
  AircheckBuy,
  AircheckFieldCheck,
  AircheckJudgment,
  AircheckMatchEvidence,
  AircheckRow,
} from "./types";
import { AircheckLineNotFound, transcribeIoLine } from "./transcribe";
import { loadAircheckBuy, saveAircheckMatch } from "./store";

const EXCERPT_RADIUS = 160;

type PlacementZone = "pre-roll" | "mid-roll" | "post-roll";

function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Index of phrase in transcript, punctuation-insensitive, bounded by tokens. */
function phraseIndex(transcript: string, phrase: string): number {
  const tokens = normalize(phrase).split(" ").filter(Boolean);
  if (tokens.join("").length < 3) return -1;
  const pattern = tokens.map(escapeRegExp).join("[^a-z0-9]*");
  const match = new RegExp(
    `(?<![a-z0-9])${pattern}(?![a-z0-9])`,
    "i"
  ).exec(transcript);
  return match?.index ?? -1;
}

function earliest(transcript: string, phrases: string[]): number {
  let best = -1;
  for (const phrase of phrases) {
    const index = phraseIndex(transcript, phrase);
    if (index >= 0 && (best < 0 || index < best)) best = index;
  }
  return best;
}

function brandPhrases(name: string): string[] {
  const trimmed = name.trim();
  if (!trimmed) return [];
  const stripped = trimmed
    .replace(
      /,?\s+\b(incorporated|inc|llc|l\.l\.c|ltd|limited|co|corp|corporation|company)\b\.?$/i,
      ""
    )
    .trim();
  const phrases = stripped && stripped !== trimmed ? [trimmed, stripped] : [trimmed];
  return phrases.filter((phrase) => normalize(phrase).replace(/ /g, "").length >= 3);
}

function urlPhrases(raw: string | null): string[] {
  const trimmed = raw?.trim();
  if (!trimmed) return [];
  let host = trimmed;
  try {
    const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)
      ? trimmed
      : `https://${trimmed}`;
    host = new URL(withScheme).hostname;
  } catch {
    host = trimmed.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "").split("/")[0] ?? "";
  }
  host = host.replace(/^www\./i, "");
  if (normalize(host).replace(/ /g, "").length < 4) return [];
  return [host];
}

function placementZone(placement: string | null): PlacementZone | null {
  if (!placement) return null;
  const compact = placement.toLowerCase().replace(/[\s_-]/g, "");
  if (compact.startsWith("pre")) return "pre-roll";
  if (compact.startsWith("mid")) return "mid-roll";
  if (compact.startsWith("post")) return "post-roll";
  return null;
}

function zoneAt(transcript: string, index: number): PlacementZone {
  const ratio = transcript.length === 0 ? 0 : index / transcript.length;
  if (ratio < 1 / 3) return "pre-roll";
  if (ratio < 2 / 3) return "mid-roll";
  return "post-roll";
}

function excerptAt(transcript: string, index: number): string {
  if (index < 0) {
    const opening = transcript.trim().slice(0, EXCERPT_RADIUS * 2);
    return opening.length < transcript.trim().length ? `${opening}…` : opening;
  }
  const start = Math.max(0, index - EXCERPT_RADIUS);
  const end = Math.min(transcript.length, index + EXCERPT_RADIUS);
  const slice = transcript.slice(start, end).trim();
  return `${start > 0 ? "…" : ""}${slice}${end < transcript.length ? "…" : ""}`;
}

function check(found: boolean): AircheckFieldCheck {
  return found ? "found" : "missing";
}

function skipped(reason: string): AircheckJudgment {
  const evidence: AircheckMatchEvidence = {
    excerpt: null,
    reason,
    brand: "missing",
    code_or_url: "missing",
    position: "missing",
    length: "missing",
  };
  return { match_result: "skipped", match_evidence: evidence };
}

/**
 * Talking points are not a column. When a caller passes text, the read
 * matches only if one of those lines is in the transcript.
 */
function scriptFound(transcript: string, talkingPoints: string | null): boolean | null {
  const text = talkingPoints?.trim() ?? "";
  if (!text) return null;
  const chunks = text
    .split(/\n+/)
    .map((line) => line.replace(/^[-•*]\s*/, "").trim())
    .filter((line) => normalize(line).split(" ").filter(Boolean).length >= 4);
  const targets = chunks.length > 0 ? chunks : [text];
  return targets.some((chunk) => phraseIndex(transcript, chunk) >= 0);
}

export function judgeAircheck(
  row: Pick<AircheckRow, "status" | "transcript_text">,
  buy: AircheckBuy
): AircheckJudgment {
  if (row.status !== "transcribed") {
    return skipped(`Aircheck status is ${row.status}, not transcribed.`);
  }
  const transcript = row.transcript_text?.trim() ?? "";
  if (!transcript) return skipped("No transcript is stored.");

  const brands = buy.brandNames.flatMap(brandPhrases);
  const brandAt = earliest(transcript, brands);
  const codePhrases = buy.promoCode?.trim() ? [buy.promoCode.trim()] : [];
  const codeAt = earliest(transcript, codePhrases);
  const urls = urlPhrases(buy.url);
  const urlAt = earliest(transcript, urls);
  const codeOrUrlAt = [codeAt, urlAt].filter((index) => index >= 0);
  const offerAt = codeOrUrlAt.length > 0 ? Math.min(...codeOrUrlAt) : -1;

  const brandFound = brandAt >= 0;
  const offerFound = offerAt >= 0;
  const script = scriptFound(transcript, buy.talkingPoints);
  const hitAt = brandAt >= 0 ? brandAt : offerAt;
  const expected = placementZone(buy.placement);
  const positionFound =
    hitAt >= 0 && expected !== null && zoneAt(transcript, hitAt) === expected;

  const evidence: AircheckMatchEvidence = {
    excerpt: excerptAt(transcript, hitAt),
    reason: script === false ? "Talking points were not in the transcript." : null,
    brand: check(brandFound),
    code_or_url: check(offerFound),
    position: check(positionFound),
    // io_line_items, insertion_orders, and deals do not store a read length.
    length: "missing",
  };

  const matched = brandFound && offerFound && script !== false;
  return {
    match_result: matched ? "matched" : "not_matched",
    match_evidence: evidence,
  };
}

/**
 * Transcribe the line when it has no stored transcript, then judge it.
 * A second call updates the same airchecks row.
 */
export async function aircheckIoLine(ioLineItemId: string): Promise<AircheckRow> {
  const row = await transcribeIoLine(ioLineItemId);
  const buy = await loadAircheckBuy(ioLineItemId);
  if (!buy) throw new AircheckLineNotFound(ioLineItemId);
  return saveAircheckMatch(ioLineItemId, judgeAircheck(row, buy));
}
