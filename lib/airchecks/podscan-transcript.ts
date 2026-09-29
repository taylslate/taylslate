// Podscan already transcribes episodes. GET /episodes/search/by/enclosure-url
// returns the transcript and episode_audio_url when it has processed that
// enclosure. One fetch, no SDK. The live enrichment client keeps its own
// search methods; this call is the enclosure lookup those methods don't wrap.

import { looksLikeAudioUrl } from "./rss";

const PODSCAN_ENCLOSURE_URL =
  "https://podscan.fm/api/v1/episodes/search/by/enclosure-url";

export interface PodscanTranscriptHit {
  transcript: string | null;
  audioUrl: string | null;
  /** RSS guid, when Podscan echoed one. Not the Podscan episode id. */
  episodeGuid: string | null;
  /** Set on transport or HTTP failure. Empty episodes are not an error. */
  error: string | null;
}

function stringField(
  record: Record<string, unknown>,
  keys: string[]
): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function firstEpisode(body: unknown): Record<string, unknown> | null {
  if (!body || typeof body !== "object") return null;
  const record = body as Record<string, unknown>;
  const list = Array.isArray(record.episodes)
    ? record.episodes
    : Array.isArray(record.data)
      ? record.data
      : record.episode
        ? [record.episode]
        : [];
  const hit = list[0];
  if (!hit || typeof hit !== "object") return null;
  return hit as Record<string, unknown>;
}

function audioFromHit(hit: Record<string, unknown>): string | null {
  const enclosure = stringField(hit, ["episode_audio_url"]);
  if (enclosure) return enclosure;
  const page = stringField(hit, ["episode_url"]);
  if (page && looksLikeAudioUrl(page)) return page;
  return null;
}

export async function lookupPodscanTranscript(
  enclosureUrl: string
): Promise<PodscanTranscriptHit> {
  const empty: PodscanTranscriptHit = {
    transcript: null,
    audioUrl: null,
    episodeGuid: null,
    error: null,
  };
  const key = process.env.PODSCAN_API_KEY?.trim();
  if (!key) {
    return { ...empty, error: "PODSCAN_API_KEY is not set" };
  }

  const url = new URL(PODSCAN_ENCLOSURE_URL);
  url.searchParams.set("enclosure_url", enclosureUrl);
  url.searchParams.set("exclude_transcript", "false");
  url.searchParams.set("transcript_formatter", "paragraph");
  url.searchParams.set("remove_timestamps", "true");

  let res: Response;
  try {
    res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${key}`,
        Accept: "application/json",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "network error";
    return { ...empty, error: `Podscan episode lookup failed: ${message}` };
  }
  if (!res.ok) {
    return { ...empty, error: `Podscan episode lookup failed: ${res.status}` };
  }

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    return { ...empty, error: "Podscan episode lookup returned invalid JSON" };
  }
  const hit = firstEpisode(body);
  if (!hit) return empty;
  return {
    transcript: stringField(hit, [
      "transcription",
      "transcript",
      "episode_transcript",
    ]),
    audioUrl: audioFromHit(hit),
    episodeGuid: stringField(hit, ["episode_guid"]),
    error: null,
  };
}
