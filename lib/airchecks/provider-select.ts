// Pick the aircheck transcript provider for one run.
// Deepgram when DEEPGRAM_API_KEY is set. whisper-1 only as a fallback
// while that key is missing, OPENAI_API_KEY is set, and the date is
// before whisper-1 shuts down. Otherwise an unconfigured provider.
// A malformed env value counts as missing. This function never throws.

import { createDeepgramProvider, type DeepgramEnv } from "./deepgram";
import { createOpenAiWhisperProvider } from "./openai-whisper";
import type { TranscriptionResult, TranscriptProvider } from "./provider";

/** whisper-1 is removed from the OpenAI API at this instant. */
export const WHISPER_1_SHUTDOWN_UTC = "2027-02-26T00:00:00Z";

const SHUTDOWN_MS = Date.parse(WHISPER_1_SHUTDOWN_UTC);

export type TranscriptSelectionReason = "deepgram" | "whisper_fallback" | "none";

export interface TranscriptSelection {
  provider: TranscriptProvider;
  reason: TranscriptSelectionReason;
}

interface ProviderEnv extends DeepgramEnv {
  OPENAI_API_KEY?: unknown;
  [key: string]: unknown;
}

function readKey(env: ProviderEnv | null | undefined, name: "DEEPGRAM_API_KEY" | "OPENAI_API_KEY"): string | null {
  try {
    const raw = env?.[name];
    if (typeof raw !== "string") return null;
    const key = raw.trim();
    return key || null;
  } catch {
    return null;
  }
}

function unconfiguredProvider(): TranscriptProvider {
  return {
    id: "none",
    usdPerMinute: 0,
    isConfigured() {
      return false;
    },
    async transcribe(): Promise<TranscriptionResult> {
      return {
        ok: false,
        reason: "missing_api_key",
        message: "No transcription provider is configured",
      };
    },
  };
}

export function selectTranscriptProvider(
  now: Date,
  env: ProviderEnv | null | undefined = process.env
): TranscriptSelection {
  try {
    if (readKey(env, "DEEPGRAM_API_KEY")) {
      return {
        provider: createDeepgramProvider(env),
        reason: "deepgram",
      };
    }
    const openaiKey = readKey(env, "OPENAI_API_KEY");
    const time = now instanceof Date ? now.getTime() : Number.NaN;
    if (openaiKey && Number.isFinite(time) && time < SHUTDOWN_MS) {
      return {
        provider: createOpenAiWhisperProvider(openaiKey),
        reason: "whisper_fallback",
      };
    }
    return { provider: unconfiguredProvider(), reason: "none" };
  } catch {
    return { provider: unconfiguredProvider(), reason: "none" };
  }
}
