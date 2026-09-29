// Aircheck step 1. Given an IO line id: resolve the episode the line
// already identifies, store a transcript, set status. A fetch or
// transcription failure is written onto the same row and returned.
// This module does not mark the line delivered and does not charge.

import { lookupPodscanTranscript } from "./podscan-transcript";
import { resolveEpisode } from "./resolve-episode";
import {
  findAircheckByLine,
  loadIoLine,
  loadShowRssUrl,
  saveAircheck,
} from "./store";
import {
  activeTranscriptionProvider,
  transcribeWithProvider,
} from "./transcribe-audio";
import type { AircheckRow, AircheckWrite } from "./types";

const MAX_ERROR_CHARS = 2000;

export class AircheckLineNotFound extends Error {
  constructor(ioLineItemId: string) {
    super(`IO line item ${ioLineItemId} not found`);
    this.name = "AircheckLineNotFound";
  }
}

function clip(message: string): string {
  const trimmed = message.trim();
  if (trimmed.length <= MAX_ERROR_CHARS) return trimmed;
  return trimmed.slice(0, MAX_ERROR_CHARS);
}

function httpUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return value;
  } catch {
    return null;
  }
}

function blankWrite(
  ioLineItemId: string,
  episodeIdentifier: string | null,
  status: AircheckWrite["status"]
): AircheckWrite {
  return {
    io_line_item_id: ioLineItemId,
    episode_identifier: episodeIdentifier,
    audio_url: null,
    transcript_text: null,
    provider: null,
    status,
    error: null,
  };
}

export async function transcribeIoLine(ioLineItemId: string): Promise<AircheckRow> {
  const line = await loadIoLine(ioLineItemId);
  if (!line) throw new AircheckLineNotFound(ioLineItemId);

  const existing = await findAircheckByLine(ioLineItemId);
  if (existing?.status === "transcribed" && existing.transcript_text?.trim()) {
    return existing;
  }

  let episodeIdentifier: string | null = line.episode_url?.trim() || null;
  let audioUrl: string | null = null;
  let provider: string | null = null;

  try {
    await saveAircheck(blankWrite(ioLineItemId, episodeIdentifier, "pending"));

    const rssUrl = await loadShowRssUrl(line.io_id);
    const resolved = await resolveEpisode({
      episodeUrl: episodeIdentifier,
      postDate: line.post_date,
      rssUrl,
    });
    episodeIdentifier = resolved.episodeIdentifier ?? episodeIdentifier;
    audioUrl = resolved.audioUrl;

    const lookupTarget = audioUrl ?? httpUrl(episodeIdentifier);
    let transcript: string | null = null;
    let podscanError: string | null = null;

    if (lookupTarget) {
      const hit = await lookupPodscanTranscript(lookupTarget);
      if (hit.audioUrl && !audioUrl) audioUrl = hit.audioUrl;
      if (!episodeIdentifier && hit.episodeGuid) {
        episodeIdentifier = hit.episodeGuid;
      }
      if (hit.transcript) {
        transcript = hit.transcript;
        provider = "podscan";
      } else if (hit.error) {
        provider = "podscan";
        podscanError = hit.error;
      }
    }

    if (!transcript) {
      const fallback = activeTranscriptionProvider();
      if (line.format === "youtube" && !audioUrl && !fallback) {
        throw new Error(
          "YouTube line has no episode audio URL. Aircheck step 1 stores a transcript from a podcast enclosure or an existing Podscan transcript."
        );
      }
      if (fallback) {
        if (!audioUrl) {
          throw new Error(
            resolved.note ??
              "No episode audio URL to send to the transcription provider"
          );
        }
        provider = fallback;
        transcript = await transcribeWithProvider(audioUrl, fallback);
      } else if (podscanError) {
        throw new Error(podscanError);
      } else if (!lookupTarget) {
        throw new Error(
          resolved.note ??
            "No episode audio URL on the IO line or show RSS, and AIRCHECK_TRANSCRIPTION_PROVIDER is off"
        );
      } else {
        throw new Error(
          "Podscan returned no transcript and AIRCHECK_TRANSCRIPTION_PROVIDER is off"
        );
      }
    }

    const text = transcript.trim();
    if (!text) throw new Error("Transcript was empty");

    return await saveAircheck({
      io_line_item_id: ioLineItemId,
      episode_identifier: episodeIdentifier,
      audio_url: audioUrl,
      transcript_text: text,
      provider,
      status: "transcribed",
      error: null,
    });
  } catch (err) {
    const message = clip(err instanceof Error ? err.message : "Aircheck failed");
    try {
      return await saveAircheck({
        io_line_item_id: ioLineItemId,
        episode_identifier: episodeIdentifier,
        audio_url: audioUrl,
        transcript_text: null,
        provider,
        status: "failed",
        error: message,
      });
    } catch (saveErr) {
      const saveMessage = saveErr instanceof Error ? saveErr.message : "save failed";
      throw new Error(`${message} (also failed to store aircheck: ${saveMessage})`);
    }
  }
}
