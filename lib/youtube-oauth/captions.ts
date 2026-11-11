// Caption track choice and VTT parsing. No audio and no video download.

import type { AircheckSegment } from "@/lib/airchecks/types";
import { googleFetch, youtubeErrorReason, GoogleOAuthError } from "./google";

const CAPTIONS_URL = "https://www.googleapis.com/youtube/v3/captions";
const VIDEOS_URL = "https://www.googleapis.com/youtube/v3/videos";

export interface CaptionTrack {
  id: string;
  language: string;
  trackKind: string;
}

export interface VideoDetails {
  durationSeconds: number | null;
  publishedAt: string | null;
  defaultLanguage: string | null;
}

export type CaptionFetchFailure = "owner" | "quota" | "http" | "empty";

function parseJson(text: string): Record<string, unknown> | null {
  try {
    const value = JSON.parse(text) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    return value as Record<string, unknown>;
  } catch {
    return null;
  }
}

function failureFrom(status: number, body: Record<string, unknown> | null): CaptionFetchFailure {
  const reason = youtubeErrorReason(body);
  if (reason === "quotaExceeded" || reason === "dailyLimitExceeded") return "quota";
  if (status === 403) return "owner";
  return "http";
}

export function parseIsoDuration(value: string | null | undefined): number | null {
  if (!value) return null;
  const match = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(value.trim());
  if (!match) return null;
  if (!match[1] && !match[2] && !match[3]) return null;
  const total = Number(match[1] ?? 0) * 3600 + Number(match[2] ?? 0) * 60 + Number(match[3] ?? 0);
  return total > 0 ? total : null;
}

function languageMatches(trackLanguage: string, videoLanguage: string): boolean {
  const track = trackLanguage.toLowerCase();
  const video = videoLanguage.toLowerCase();
  return track === video || track.startsWith(`${video}-`) || video.startsWith(`${track}-`);
}

/**
 * Standard track in the video's default language, else an asr track.
 * A missing default language uses the first standard track, then asr.
 */
export function pickCaptionTrack(tracks: CaptionTrack[], defaultLanguage: string | null): CaptionTrack | null {
  const standard = tracks.filter((track) => track.trackKind === "standard");
  const asr = tracks.filter((track) => track.trackKind === "asr");
  const lang = defaultLanguage?.trim() || null;
  if (lang) {
    const standardMatch = standard.find((track) => languageMatches(track.language, lang));
    if (standardMatch) return standardMatch;
    const asrMatch = asr.find((track) => languageMatches(track.language, lang));
    if (asrMatch) return asrMatch;
    return asr[0] ?? null;
  }
  return standard[0] ?? asr[0] ?? null;
}

function clockSeconds(value: string): number | null {
  const match = /^(?:(\d+):)?(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?$/.exec(value.trim());
  if (!match) return null;
  const hours = match[1] ? Number(match[1]) : 0;
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  const fraction = match[4] ? Number(match[4].padEnd(3, "0")) / 1000 : 0;
  if (minutes > 59 || seconds > 59) return null;
  return hours * 3600 + minutes * 60 + seconds + fraction;
}

function decodeCue(text: string): string {
  return text
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function overlaps(start: number, end: number, cueStart: number, cueEnd: number): boolean {
  return cueStart <= end + 0.05 && cueEnd >= start - 0.05;
}

export function vttToSegments(vtt: string): AircheckSegment[] {
  const lines = vtt.replace(/^\uFEFF/, "").split(/\r?\n/);
  const cues: { start: number; end: number; text: string }[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const timing = lines[i]?.trim() ?? "";
    if (!timing.includes("-->")) continue;
    const [startRaw, rest] = timing.split("-->");
    const endRaw = rest?.trim().split(/\s+/)[0] ?? "";
    const start = clockSeconds(startRaw?.trim() ?? "");
    const end = clockSeconds(endRaw);
    if (start == null || end == null || end < start) continue;
    const textLines: string[] = [];
    i += 1;
    while (i < lines.length && lines[i]?.trim() !== "") {
      textLines.push(lines[i] ?? "");
      i += 1;
    }
    const text = decodeCue(textLines.join(" "));
    if (!text) continue;
    cues.push({ start, end, text });
  }

  const merged: AircheckSegment[] = [];
  for (const cue of cues) {
    const last = merged[merged.length - 1];
    if (!last) {
      merged.push({ start_seconds: cue.start, end_seconds: cue.end, text: cue.text });
      continue;
    }
    const rolling = overlaps(last.start_seconds, last.end_seconds, cue.start, cue.end);
    if (cue.text === last.text) {
      if (rolling && cue.end > last.end_seconds) last.end_seconds = cue.end;
      else if (!rolling) merged.push({ start_seconds: cue.start, end_seconds: cue.end, text: cue.text });
      continue;
    }
    if (rolling && (cue.text.startsWith(last.text) || last.text.startsWith(cue.text))) {
      if (cue.text.length >= last.text.length) last.text = cue.text;
      last.end_seconds = Math.max(last.end_seconds, cue.end);
      last.start_seconds = Math.min(last.start_seconds, cue.start);
      continue;
    }
    merged.push({ start_seconds: cue.start, end_seconds: cue.end, text: cue.text });
  }
  return merged;
}

export function segmentsToTranscript(segments: AircheckSegment[]): string {
  return segments
    .map((segment) => segment.text.trim())
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

async function authorizedGet(
  url: string,
  accessToken: string,
  fetchImpl: typeof fetch
): Promise<{ status: number; text: string; body: Record<string, unknown> | null }> {
  const result = await googleFetch(
    url,
    { headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json, text/vtt, text/plain" } },
    fetchImpl
  );
  return { status: result.status, text: result.text, body: parseJson(result.text) };
}

export async function listCaptionTracks(
  accessToken: string,
  videoId: string,
  fetchImpl: typeof fetch = fetch
): Promise<{ ok: true; tracks: CaptionTrack[] } | { ok: false; reason: CaptionFetchFailure }> {
  const url = new URL(CAPTIONS_URL);
  url.searchParams.set("part", "snippet");
  url.searchParams.set("videoId", videoId);
  const { status, body } = await authorizedGet(url.toString(), accessToken, fetchImpl);
  if (status < 200 || status >= 300) return { ok: false, reason: failureFrom(status, body) };
  const items = Array.isArray(body?.items) ? body.items : [];
  const tracks: CaptionTrack[] = [];
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const row = item as { id?: unknown; snippet?: { language?: unknown; trackKind?: unknown } };
    if (typeof row.id !== "string" || !row.snippet) continue;
    const language = typeof row.snippet.language === "string" ? row.snippet.language : "";
    const trackKind = typeof row.snippet.trackKind === "string" ? row.snippet.trackKind : "";
    if (!language) continue;
    tracks.push({ id: row.id, language, trackKind });
  }
  return { ok: true, tracks };
}

export async function downloadCaptionTrack(
  accessToken: string,
  trackId: string,
  fetchImpl: typeof fetch = fetch
): Promise<{ ok: true; vtt: string } | { ok: false; reason: CaptionFetchFailure }> {
  const url = new URL(`${CAPTIONS_URL}/${encodeURIComponent(trackId)}`);
  url.searchParams.set("tfmt", "vtt");
  const { status, text, body } = await authorizedGet(url.toString(), accessToken, fetchImpl);
  if (status < 200 || status >= 300) return { ok: false, reason: failureFrom(status, body) };
  if (!text.trim()) return { ok: false, reason: "empty" };
  return { ok: true, vtt: text };
}

export async function fetchVideoDetails(
  accessToken: string,
  videoId: string,
  fetchImpl: typeof fetch = fetch
): Promise<{ ok: true; details: VideoDetails } | { ok: false; reason: CaptionFetchFailure }> {
  const url = new URL(VIDEOS_URL);
  url.searchParams.set("part", "snippet,contentDetails");
  url.searchParams.set("id", videoId);
  const { status, body } = await authorizedGet(url.toString(), accessToken, fetchImpl);
  if (status < 200 || status >= 300) return { ok: false, reason: failureFrom(status, body) };
  const items = Array.isArray(body?.items) ? body.items : [];
  const item = items[0] as
    | {
        snippet?: { publishedAt?: unknown; defaultLanguage?: unknown; defaultAudioLanguage?: unknown };
        contentDetails?: { duration?: unknown };
      }
    | undefined;
  if (!item) return { ok: false, reason: "empty" };
  const language =
    typeof item.snippet?.defaultLanguage === "string"
      ? item.snippet.defaultLanguage
      : typeof item.snippet?.defaultAudioLanguage === "string"
        ? item.snippet.defaultAudioLanguage
        : null;
  return {
    ok: true,
    details: {
      durationSeconds: parseIsoDuration(
        typeof item.contentDetails?.duration === "string" ? item.contentDetails.duration : null
      ),
      publishedAt: typeof item.snippet?.publishedAt === "string" ? item.snippet.publishedAt : null,
      defaultLanguage: language,
    },
  };
}

export function isVideoId(value: string | null | undefined): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{11}$/.test(value);
}

export function captionFailureMessage(reason: CaptionFetchFailure): string {
  if (reason === "owner") return "captions need owner access";
  if (reason === "empty") return "no caption track";
  if (reason === "quota") return "quota";
  return "caption request failed";
}

export function asGoogleFailure(err: unknown): CaptionFetchFailure {
  if (err instanceof GoogleOAuthError && err.code === "quota") return "quota";
  return "http";
}
