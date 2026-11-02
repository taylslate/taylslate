// Transcription provider. The automated runner calls this interface.
// OpenAI Whisper is the first implementation. A missing key skips the run.

import type { AircheckSegment } from "./types";

export interface TranscriptionAudio {
  bytes: Uint8Array;
  filename: string;
  mimeType: string;
}

export interface TranscriptionOk {
  ok: true;
  provider: string;
  text: string;
  segments: AircheckSegment[];
  durationSeconds: number;
}

export interface TranscriptionFailed {
  ok: false;
  reason: "missing_api_key" | "empty" | "http" | "invalid";
  message: string;
}

export type TranscriptionResult = TranscriptionOk | TranscriptionFailed;

export interface TranscriptProvider {
  readonly id: string;
  /** USD per audio minute. The runner uses this for the cap before the call. */
  readonly usdPerMinute: number;
  isConfigured(): boolean;
  transcribe(audio: TranscriptionAudio): Promise<TranscriptionResult>;
}
