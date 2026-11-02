// OpenAI whisper-1 published rate. The logged estimate uses this number.
// A later provider can expose its own rate through TranscriptProvider.

/** USD per audio minute for whisper-1. */
export const WHISPER_USD_PER_MINUTE = 0.006;

/**
 * Default cap for one cron run when AIRCHECK_RUN_COST_CAP_USD is unset.
 * $1 is about 166 minutes, about three 45-minute episodes.
 */
export const DEFAULT_AIRCHECK_RUN_COST_CAP_USD = 1;

export function roundUsd(value: number): number {
  return Math.round(value * 10000) / 10000;
}

export function roundMinutes(seconds: number): number {
  const minutes = Math.max(0, seconds) / 60;
  return Math.round(minutes * 10000) / 10000;
}

export function estimateWhisperCostUsd(durationSeconds: number): number {
  return roundUsd(roundMinutes(durationSeconds) * WHISPER_USD_PER_MINUTE);
}

/**
 * Minutes implied by a file size at 128 kbps. A higher bitrate estimates
 * long, so the cap stops early. The stored cost uses the Whisper duration.
 */
export function estimateSecondsFromBytes(bytes: number): number {
  if (!Number.isFinite(bytes) || bytes <= 0) return 0;
  return (bytes * 8) / 128_000;
}

export function readRunCostCapUsd(
  raw: string | undefined = process.env.AIRCHECK_RUN_COST_CAP_USD
): number {
  const text = raw?.trim() ?? "";
  if (!text) return DEFAULT_AIRCHECK_RUN_COST_CAP_USD;
  const value = Number(text);
  if (!Number.isFinite(value) || value < 0) return DEFAULT_AIRCHECK_RUN_COST_CAP_USD;
  return roundUsd(value);
}

/** One log line per transcribed episode. No transcript text and no API key. */
export function aircheckCostLog(input: {
  ioLineItemId: string;
  minutes: number;
  estimatedCostUsd: number;
  provider: string;
}): string {
  const minutes = input.minutes.toFixed(2);
  const cost = input.estimatedCostUsd.toFixed(4);
  return `[aircheck] line=${input.ioLineItemId} minutes=${minutes} estimated_cost_usd=${cost} provider=${input.provider}`;
}
