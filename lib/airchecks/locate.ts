// Part 2. Find the ad read in a transcript and compare it to the IO.
// The result is data for a person to review. It does not charge.

import {
  brandPhrases,
  judgeAircheck,
  phraseIndex,
  placementZone,
  talkingPointsFound,
  urlPhrases,
} from "./match";
import type { AircheckBuy, AircheckJudgment, AircheckSegment, AircheckStatus } from "./types";

const CLUSTER_SECONDS = 120;

const EXPECTED_READ_SECONDS: Record<string, number> = {
  "pre-roll": 30,
  "mid-roll": 60,
  "post-roll": 30,
};

export interface AdReadLocation {
  judgment: AircheckJudgment;
  confidence: number;
  adStartSeconds: number | null;
  adEndSeconds: number | null;
  reasons: string[];
  readyForReview: boolean;
}

function clock(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const remain = whole % 60;
  const mm = String(minutes).padStart(2, "0");
  const ss = String(remain).padStart(2, "0");
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}

function zoneFromRatio(ratio: number): "pre-roll" | "mid-roll" | "post-roll" {
  if (ratio < 1 / 3) return "pre-roll";
  if (ratio < 2 / 3) return "mid-roll";
  return "post-roll";
}

function expectedSeconds(placement: string | null): number | null {
  const zone = placementZone(placement);
  if (!zone) return null;
  return EXPECTED_READ_SECONDS[zone] ?? null;
}

function lengthFits(measured: number, expected: number): boolean {
  return measured >= expected * 0.5 && measured <= expected * 2;
}

function phrasesHit(text: string, phrases: string[]): boolean {
  return phrases.some((phrase) => phraseIndex(text, phrase) >= 0);
}

function earliestSegment(
  segments: AircheckSegment[],
  phrases: string[]
): AircheckSegment | null {
  for (const segment of segments) {
    if (phrasesHit(segment.text, phrases)) return segment;
  }
  return null;
}

function roundConfidence(value: number): number {
  return Math.round(Math.min(1, Math.max(0, value)) * 100) / 100;
}

export function locateAdRead(input: {
  status: AircheckStatus;
  transcript: string | null;
  segments: AircheckSegment[];
  durationSeconds: number | null;
  buy: AircheckBuy;
}): AdReadLocation {
  const judgment = judgeAircheck(
    { status: input.status, transcript_text: input.transcript },
    input.buy
  );
  if (judgment.match_result === "skipped") {
    return {
      judgment,
      confidence: 0,
      adStartSeconds: null,
      adEndSeconds: null,
      reasons: [judgment.match_evidence.reason ?? "Match skipped."],
      readyForReview: false,
    };
  }

  const transcript = input.transcript ?? "";
  const brands = input.buy.brandNames.flatMap(brandPhrases);
  const codePhrases = input.buy.promoCode?.trim() ? [input.buy.promoCode.trim()] : [];
  const urls = urlPhrases(input.buy.url);
  const offerPhrases = [...codePhrases, ...urls];
  const segments = [...input.segments].sort((a, b) => a.start_seconds - b.start_seconds);

  const brandSegment = earliestSegment(segments, brands);
  const offerSegment = earliestSegment(segments, offerPhrases);
  const anchor = brandSegment ?? offerSegment;
  let adStart: number | null = anchor ? anchor.start_seconds : null;
  let adEnd: number | null = anchor ? anchor.end_seconds : null;
  if (anchor && adStart !== null) {
    const clusterEnd = adStart + CLUSTER_SECONDS;
    for (const segment of segments) {
      if (segment.end_seconds < adStart || segment.start_seconds > clusterEnd) continue;
      const hit =
        phrasesHit(segment.text, brands) ||
        phrasesHit(segment.text, offerPhrases) ||
        (input.buy.talkingPoints
          ? talkingPointsFound(segment.text, input.buy.talkingPoints) === true
          : false);
      if (hit && segment.end_seconds > (adEnd ?? 0)) adEnd = segment.end_seconds;
    }
  }

  const duration =
    input.durationSeconds && input.durationSeconds > 0
      ? input.durationSeconds
      : segments.length > 0
        ? segments[segments.length - 1].end_seconds
        : null;

  const expectedZone = placementZone(input.buy.placement);
  let positionFound = judgment.match_evidence.position === "found";
  if (adStart !== null && duration && duration > 0 && expectedZone) {
    const actual = zoneFromRatio(adStart / duration);
    positionFound = actual === expectedZone;
    judgment.match_evidence.position = positionFound ? "found" : "missing";
  }

  const expected = expectedSeconds(input.buy.placement);
  const measured =
    adStart !== null && adEnd !== null && adEnd >= adStart ? adEnd - adStart : null;
  if (expected !== null && measured !== null) {
    judgment.match_evidence.length = lengthFits(measured, expected) ? "found" : "missing";
  }

  const script = talkingPointsFound(transcript, input.buy.talkingPoints);
  const brandFound = judgment.match_evidence.brand === "found";
  const offerFound = judgment.match_evidence.code_or_url === "found";
  const lengthFound = judgment.match_evidence.length === "found";

  let confidence = 0;
  if (brandFound) confidence += 0.4;
  if (offerFound) confidence += 0.3;
  if (positionFound) confidence += 0.15;
  if (lengthFound) confidence += 0.1;
  if (script === null || script === true) confidence += 0.05;

  const reasons: string[] = [];
  if (brandFound && adStart !== null) {
    reasons.push(`Brand found at ${clock(adStart)}.`);
  } else if (brandFound) {
    reasons.push("Brand found in the transcript.");
  } else {
    reasons.push("Brand name was not in the transcript.");
  }

  if (codePhrases.length === 0 && urls.length === 0) {
    reasons.push("The IO has no promo code and no URL to match.");
  } else if (offerFound) {
    const at = offerSegment ? ` at ${clock(offerSegment.start_seconds)}` : "";
    reasons.push(`Code or URL found${at}.`);
  } else if (codePhrases.length > 0) {
    reasons.push("Promo code was not in the transcript.");
  } else {
    reasons.push("Brand URL was not in the transcript.");
  }

  if (!expectedZone) {
    reasons.push("The IO line has no pre-roll, mid-roll, or post-roll placement.");
  } else if (adStart !== null && duration && duration > 0) {
    const actual = zoneFromRatio(adStart / duration);
    reasons.push(
      `Placement is ${expectedZone}. The read starts at ${clock(adStart)}, which is ${actual}.`
    );
  } else if (positionFound) {
    reasons.push(`Placement is ${expectedZone} and the read sits in that third of the transcript.`);
  } else {
    reasons.push(`Placement is ${expectedZone}. The read was not in that third of the transcript.`);
  }

  if (expected === null) {
    reasons.push("Approximate length needs a pre-roll, mid-roll, or post-roll placement.");
  } else if (measured === null) {
    reasons.push(
      `A ${expectedZone ?? "host"} read is about ${expected}s. The read had no timestamped length.`
    );
  } else if (lengthFits(measured, expected)) {
    reasons.push(
      `Approximate length is ${Math.round(measured)}s. A ${expectedZone} read is about ${expected}s, and ${Math.round(measured)}s is inside that range.`
    );
  } else {
    reasons.push(
      `Approximate length is ${Math.round(measured)}s. A ${expectedZone} read is about ${expected}s, and ${Math.round(measured)}s is outside that range.`
    );
  }

  if (script === null) {
    reasons.push(
      "The IO has no talking-points column. The outreach pitch has no bullet lines to match."
    );
  } else if (script) {
    reasons.push("A talking point from the outreach pitch was in the transcript.");
  } else {
    reasons.push("Talking points from the outreach pitch were not in the transcript.");
  }

  const ready = judgment.match_result === "matched" || judgment.match_result === "not_matched";
  if (ready) {
    reasons.push("Ready for review.");
  }

  return {
    judgment,
    confidence: roundConfidence(confidence),
    adStartSeconds: adStart,
    adEndSeconds: adEnd,
    reasons,
    readyForReview: ready,
  };
}

/** Bullet lines from the outreach pitch. The IO table has no talking-points column. */
export function talkingPointsFromPitch(pitch: string | null | undefined): string | null {
  const text = pitch?.trim() ?? "";
  if (!text) return null;
  const bullets = text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter((line) => /^([-*•]|\d+[.)])\s+\S/.test(line))
    .map((line) => line.replace(/^([-*•]|\d+[.)])\s+/, "").trim())
    .filter((line) => line.split(/\s+/).filter(Boolean).length >= 4);
  if (bullets.length === 0) return null;
  return bullets.join("\n");
}
