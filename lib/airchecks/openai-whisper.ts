// OpenAI whisper-1. POST /v1/audio/transcriptions with verbose_json
// so each segment has a start and an end. OPENAI_API_KEY is read from
// the environment. When it is unset the provider reports missing_api_key
// and does not call the network.

import { WHISPER_USD_PER_MINUTE } from "./cost";
import type {
  TranscriptionAudio,
  TranscriptionResult,
  TranscriptProvider,
} from "./provider";
import type { AircheckSegment } from "./types";

const ENDPOINT = "https://api.openai.com/v1/audio/transcriptions";
const MODEL = "whisper-1";

interface WhisperSegment {
  start?: unknown;
  end?: unknown;
  text?: unknown;
}

interface WhisperBody {
  text?: unknown;
  duration?: unknown;
  segments?: unknown;
}

function clip(message: string): string {
  const trimmed = message.trim();
  if (trimmed.length <= 500) return trimmed;
  return trimmed.slice(0, 500);
}

function asSegments(value: unknown, durationSeconds: number): AircheckSegment[] {
  if (!Array.isArray(value)) {
    return durationSeconds > 0
      ? [{ start_seconds: 0, end_seconds: durationSeconds, text: "" }]
      : [];
  }
  const segments: AircheckSegment[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const row = item as WhisperSegment;
    const start = typeof row.start === "number" ? row.start : Number(row.start);
    const end = typeof row.end === "number" ? row.end : Number(row.end);
    const text = typeof row.text === "string" ? row.text.trim() : "";
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) continue;
    segments.push({ start_seconds: start, end_seconds: end, text });
  }
  return segments;
}

export function openAiApiKey(
  raw: string | undefined = process.env.OPENAI_API_KEY
): string | null {
  const key = raw?.trim() ?? "";
  return key || null;
}

export function createOpenAiWhisperProvider(
  apiKey: string | undefined = process.env.OPENAI_API_KEY,
  fetchImpl: typeof fetch = fetch
): TranscriptProvider {
  const key = openAiApiKey(apiKey);
  return {
    id: "openai-whisper",
    usdPerMinute: WHISPER_USD_PER_MINUTE,
    isConfigured() {
      return key !== null;
    },
    async transcribe(audio: TranscriptionAudio): Promise<TranscriptionResult> {
      if (!key) {
        return {
          ok: false,
          reason: "missing_api_key",
          message: "OPENAI_API_KEY is not set",
        };
      }

      const form = new FormData();
      const bytes = new Uint8Array(audio.bytes);
      form.append(
        "file",
        new Blob([bytes], { type: audio.mimeType || "audio/mpeg" }),
        audio.filename || "episode.mp3"
      );
      form.append("model", MODEL);
      form.append("response_format", "verbose_json");
      form.append("timestamp_granularities[]", "segment");

      let res: Response;
      try {
        res = await fetchImpl(ENDPOINT, {
          method: "POST",
          headers: { Authorization: `Bearer ${key}` },
          body: form,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : "network error";
        return { ok: false, reason: "http", message: clip(message) };
      }

      if (!res.ok) {
        const body = await res.text().catch(() => "");
        return {
          ok: false,
          reason: "http",
          message: clip(`Whisper returned ${res.status} ${body}`),
        };
      }

      let json: WhisperBody;
      try {
        json = (await res.json()) as WhisperBody;
      } catch {
        return { ok: false, reason: "invalid", message: "Whisper returned invalid JSON" };
      }

      const text = typeof json.text === "string" ? json.text.trim() : "";
      if (!text) {
        return { ok: false, reason: "empty", message: "Whisper returned an empty transcript" };
      }

      const duration =
        typeof json.duration === "number" && Number.isFinite(json.duration)
          ? json.duration
          : 0;
      const segments = asSegments(json.segments, duration).map((segment) =>
        segment.text ? segment : { ...segment, text }
      );
      const durationSeconds =
        duration > 0
          ? duration
          : segments.length > 0
            ? segments[segments.length - 1].end_seconds
            : 0;

      return {
        ok: true,
        provider: "openai-whisper",
        text,
        segments: segments.filter((segment) => segment.text.length > 0),
        durationSeconds,
      };
    },
  };
}
