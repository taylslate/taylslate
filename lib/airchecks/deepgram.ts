// Deepgram Nova-3 pre-recorded. POST /v1/listen with utterances so each
// segment has a start and an end. DEEPGRAM_API_KEY is read from the
// environment. When it is unset the provider reports missing_api_key
// and does not call the network.

import { DEEPGRAM_USD_PER_MINUTE } from "./cost";
import { redactAircheckError } from "./redact";
import type {
  TranscriptionAudio,
  TranscriptionResult,
  TranscriptProvider,
} from "./provider";
import type { AircheckSegment } from "./types";

const ENDPOINT = "https://api.deepgram.com/v1/listen";
const DEEPGRAM_TIMEOUT_MS = 120_000;
const MAX_HINTS = 20;
const MAX_HINT_CHARS = 60;

interface DeepgramUtterance {
  start?: unknown;
  end?: unknown;
  transcript?: unknown;
}

interface DeepgramBody {
  metadata?: { duration?: unknown };
  results?: {
    channels?: Array<{
      alternatives?: Array<{ transcript?: unknown }>;
    }>;
    utterances?: unknown;
  };
}

export type DeepgramEnv = { DEEPGRAM_API_KEY?: unknown; [key: string]: unknown };

function clip(message: string, secret: string | null): string {
  const stripped = secret ? message.split(secret).join("[redacted]") : message;
  const trimmed = redactAircheckError(stripped).trim();
  if (trimmed.length <= 500) return trimmed;
  return trimmed.slice(0, 500);
}

export function deepgramApiKey(env: DeepgramEnv | null | undefined): string | null {
  try {
    const raw = env?.DEEPGRAM_API_KEY;
    if (typeof raw !== "string") return null;
    const key = raw.trim();
    return key || null;
  } catch {
    return null;
  }
}

function keyterms(hints: readonly string[] | undefined): string[] {
  const terms: string[] = [];
  const seen = new Set<string>();
  for (const hint of hints ?? []) {
    if (typeof hint !== "string") continue;
    const term = hint.trim().slice(0, MAX_HINT_CHARS);
    if (!term || seen.has(term)) continue;
    seen.add(term);
    terms.push(term);
    if (terms.length >= MAX_HINTS) break;
  }
  return terms;
}

function listenUrl(hints: readonly string[] | undefined): string {
  const params = new URLSearchParams();
  params.set("model", "nova-3");
  params.set("utterances", "true");
  params.set("smart_format", "true");
  params.set("punctuate", "true");
  params.set("mip_opt_out", "true");
  params.set("redact_usage", "true");
  for (const term of keyterms(hints)) params.append("keyterm", term);
  return `${ENDPOINT}?${params.toString()}`;
}

function asNumber(value: unknown): number {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : Number.NaN;
}

function asSegments(value: unknown): AircheckSegment[] {
  if (!Array.isArray(value)) return [];
  const segments: AircheckSegment[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const row = item as DeepgramUtterance;
    const start = asNumber(row.start);
    const end = asNumber(row.end);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) continue;
    const text = typeof row.transcript === "string" ? row.transcript.trim() : "";
    segments.push({ start_seconds: start, end_seconds: end, text });
  }
  return segments;
}

function channelTranscript(body: DeepgramBody): string {
  const transcript = body.results?.channels?.[0]?.alternatives?.[0]?.transcript;
  return typeof transcript === "string" ? transcript.trim() : "";
}

export function createDeepgramProvider(
  env: DeepgramEnv | null | undefined = process.env,
  fetchImpl: typeof fetch = fetch
): TranscriptProvider {
  const key = deepgramApiKey(env);
  return {
    id: "deepgram-nova-3",
    usdPerMinute: DEEPGRAM_USD_PER_MINUTE,
    isConfigured() {
      return key !== null;
    },
    async transcribe(audio: TranscriptionAudio): Promise<TranscriptionResult> {
      if (!key) {
        return {
          ok: false,
          reason: "missing_api_key",
          message: "DEEPGRAM_API_KEY is not set",
        };
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), DEEPGRAM_TIMEOUT_MS);
      try {
        let res: Response;
        try {
          res = await fetchImpl(listenUrl(audio.hints), {
            method: "POST",
            headers: {
              Authorization: `Token ${key}`,
              "Content-Type": audio.mimeType || "audio/mpeg",
            },
            body: audio.bytes as unknown as BodyInit,
            signal: controller.signal,
          });
        } catch (err) {
          const message = controller.signal.aborted
            ? "Deepgram timed out"
            : err instanceof Error
              ? err.message
              : "network error";
          return { ok: false, reason: "http", message: clip(message, key) };
        }

        if (!res.ok) {
          const body = await res.text().catch(() => "");
          return {
            ok: false,
            reason: "http",
            message: clip(`Deepgram returned ${res.status} ${body}`, key),
          };
        }

        let json: DeepgramBody;
        try {
          json = (await res.json()) as DeepgramBody;
        } catch {
          return { ok: false, reason: "invalid", message: "Deepgram returned invalid JSON" };
        }

        const segments = asSegments(json.results?.utterances);
        const joined = segments
          .map((segment) => segment.text)
          .filter((text) => text.length > 0)
          .join(" ")
          .trim();
        const text = channelTranscript(json) || joined;
        if (!text) {
          return { ok: false, reason: "empty", message: "Deepgram returned an empty transcript" };
        }

        const duration = asNumber(json.metadata?.duration);
        const durationSeconds = Number.isFinite(duration) && duration >= 0 ? duration : 0;

        return {
          ok: true,
          provider: "deepgram-nova-3",
          text,
          segments,
          durationSeconds,
        };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
