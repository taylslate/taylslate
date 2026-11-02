// Download one episode file and split it when Whisper's upload limit
// requires it. The bytes stay in memory. The publisher URL is not stored
// as a file.

import { AUDIO_FETCH_TIMEOUT_MS, AUDIO_MAX_BYTES, fetchCapped } from "@/lib/security/safe-fetch";

/** Stay under the 25MB Whisper upload limit. */
export const WHISPER_MAX_BYTES = 24 * 1024 * 1024;

const BITRATE_MPEG1_L3 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
const BITRATE_MPEG2_L3 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];

export interface DownloadedAudio {
  bytes: Uint8Array;
  mimeType: string;
  filename: string;
}

export function audioFilename(audioUrl: string): string {
  try {
    const name = new URL(audioUrl).pathname.split("/").pop() || "episode.mp3";
    const base = name.includes(".") ? name : `${name}.mp3`;
    return base.replace(/[^a-z0-9._-]/gi, "_").slice(0, 120) || "episode.mp3";
  } catch {
    return "episode.mp3";
  }
}

export async function downloadEpisodeAudio(
  audioUrl: string
): Promise<{ ok: true; audio: DownloadedAudio } | { ok: false; error: string }> {
  const body = await fetchCapped(audioUrl, {}, {
    kind: "audio",
    maxBytes: AUDIO_MAX_BYTES,
    timeoutMs: AUDIO_FETCH_TIMEOUT_MS,
  });
  if (!body.ok) return { ok: false, error: body.error };
  return {
    ok: true,
    audio: {
      bytes: body.bytes,
      mimeType: body.contentType || "audio/mpeg",
      filename: audioFilename(audioUrl),
    },
  };
}

function mp3FrameLength(header: Uint8Array, offset: number): number | null {
  if (offset + 4 > header.length) return null;
  const b0 = header[offset];
  const b1 = header[offset + 1];
  const b2 = header[offset + 2];
  if (b0 !== 0xff || (b1 & 0xe0) !== 0xe0) return null;
  const version = (b1 >> 3) & 0x03;
  const layer = (b1 >> 1) & 0x03;
  if (layer !== 1 || version === 1) return null;
  const bitrateIndex = (b2 >> 4) & 0x0f;
  const sampleIndex = (b2 >> 2) & 0x03;
  const padding = (b2 >> 1) & 0x01;
  if (bitrateIndex === 0 || bitrateIndex === 15 || sampleIndex === 3) return null;
  const mpeg1 = version === 3;
  const bitrateKbps = (mpeg1 ? BITRATE_MPEG1_L3 : BITRATE_MPEG2_L3)[bitrateIndex];
  const sampleRate = mpeg1
    ? [44100, 48000, 32000][sampleIndex]
    : version === 2
      ? [22050, 24000, 16000][sampleIndex]
      : [11025, 12000, 8000][sampleIndex];
  if (!bitrateKbps || !sampleRate) return null;
  const factor = mpeg1 ? 144 : 72;
  return Math.floor((factor * bitrateKbps * 1000) / sampleRate) + padding;
}

/** Split a CBR or VBR mp3 on frame boundaries. Null when the bytes are not mp3 frames. */
export function splitMp3(bytes: Uint8Array, maxBytes: number): Uint8Array[] | null {
  if (maxBytes < 32) return null;
  let i = 0;
  if (
    bytes.length > 10 &&
    bytes[0] === 0x49 &&
    bytes[1] === 0x44 &&
    bytes[2] === 0x33
  ) {
    const size =
      ((bytes[6] & 0x7f) << 21) |
      ((bytes[7] & 0x7f) << 14) |
      ((bytes[8] & 0x7f) << 7) |
      (bytes[9] & 0x7f);
    i = Math.min(bytes.length, 10 + size);
  }

  const frames: { start: number; length: number }[] = [];
  let misses = 0;
  while (i + 4 <= bytes.length) {
    const length = mp3FrameLength(bytes, i);
    if (!length || i + length > bytes.length) {
      i += 1;
      misses += 1;
      if (misses > 8192 && frames.length === 0) return null;
      continue;
    }
    misses = 0;
    frames.push({ start: i, length });
    i += length;
  }
  if (frames.length === 0) return null;
  const covered = frames.reduce((sum, frame) => sum + frame.length, 0);
  if (covered < bytes.length * 0.5) return null;

  const chunks: Uint8Array[] = [];
  let chunkStart = frames[0].start;
  let chunkEnd = frames[0].start;
  for (const frame of frames) {
    const nextEnd = frame.start + frame.length;
    if (nextEnd - chunkStart > maxBytes && chunkEnd > chunkStart) {
      chunks.push(bytes.subarray(chunkStart, chunkEnd));
      chunkStart = frame.start;
    }
    chunkEnd = nextEnd;
  }
  if (chunkEnd > chunkStart) chunks.push(bytes.subarray(chunkStart, chunkEnd));
  if (chunks.some((chunk) => chunk.byteLength > maxBytes)) return null;
  return chunks;
}

/**
 * One piece when the file fits. Mp3 frames when it does not.
 * Null when the file is over the limit and cannot be split.
 */
export function splitAudioForWhisper(
  bytes: Uint8Array,
  maxBytes: number = WHISPER_MAX_BYTES
): Uint8Array[] | null {
  if (bytes.byteLength <= maxBytes) return [bytes];
  return splitMp3(bytes, maxBytes);
}
