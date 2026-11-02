// Fallback transcription when Podscan has no transcript for the enclosure.
//
// Off unless AIRCHECK_TRANSCRIPTION_PROVIDER is set to a name other than
// off / false / 0 / none. The name is stored on the aircheck as provider.
// AIRCHECK_TRANSCRIPTION_URL is the endpoint. AIRCHECK_TRANSCRIPTION_API_KEY
// is an optional bearer token. No vendor SDK: the audio file is POSTed as
// multipart field "file". The response is JSON { text } or { transcript },
// or text/plain.

import { AUDIO_FETCH_TIMEOUT_MS, AUDIO_MAX_BYTES, fetchCapped } from "@/lib/security/safe-fetch";

export function activeTranscriptionProvider(): string | null {
  const raw = (process.env.AIRCHECK_TRANSCRIPTION_PROVIDER ?? "").trim();
  if (!raw || /^(off|false|0|none)$/i.test(raw)) return null;
  return raw;
}

function audioFilename(audioUrl: string): string {
  try {
    const name = new URL(audioUrl).pathname.split("/").pop() || "episode.mp3";
    return name.includes(".") ? name : `${name}.mp3`;
  } catch {
    return "episode.mp3";
  }
}

export async function transcribeWithProvider(
  audioUrl: string,
  provider: string
): Promise<string> {
  const endpoint = process.env.AIRCHECK_TRANSCRIPTION_URL?.trim();
  if (!endpoint) {
    throw new Error(
      `AIRCHECK_TRANSCRIPTION_PROVIDER is ${provider} but AIRCHECK_TRANSCRIPTION_URL is not set`
    );
  }

  const audio = await fetchCapped(audioUrl, {}, {
    kind: "audio",
    maxBytes: AUDIO_MAX_BYTES,
    timeoutMs: AUDIO_FETCH_TIMEOUT_MS,
  });
  if (!audio.ok) throw new Error(audio.error);

  const form = new FormData();
  const type = audio.contentType || "audio/mpeg";
  form.append("file", new Blob([audio.bytes as BlobPart], { type }), audioFilename(audioUrl));

  const headers: Record<string, string> = { Accept: "application/json, text/plain" };
  const key = process.env.AIRCHECK_TRANSCRIPTION_API_KEY?.trim();
  if (key) headers.Authorization = `Bearer ${key}`;

  // The endpoint is operator config, not a URL from the IO line, so it is
  // not passed through the SSRF guard (a private transcription host is valid).
  let res: Response;
  try {
    res = await fetch(endpoint, { method: "POST", headers, body: form });
  } catch (err) {
    const message = err instanceof Error ? err.message : "network error";
    throw new Error(`${provider} transcription failed: ${message}`);
  }
  if (!res.ok) throw new Error(`${provider} transcription failed: ${res.status}`);

  const contentType = res.headers.get("content-type") ?? "";
  if (contentType.includes("text/plain")) {
    const text = (await res.text()).trim();
    if (!text) throw new Error(`${provider} returned an empty transcript`);
    return text;
  }

  let json: { text?: unknown; transcript?: unknown };
  try {
    json = (await res.json()) as { text?: unknown; transcript?: unknown };
  } catch {
    throw new Error(`${provider} returned invalid JSON`);
  }
  const text =
    typeof json.text === "string"
      ? json.text
      : typeof json.transcript === "string"
        ? json.transcript
        : "";
  const trimmed = text.trim();
  if (!trimmed) throw new Error(`${provider} returned no transcript text`);
  return trimmed;
}
